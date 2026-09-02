using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using SmsBackend.Data;
using SmsBackend.Domain.Basculas;

namespace SmsBackend.Domain.Boletas;

public static class BoletaEndpoints
{
    public static RouteGroupBuilder MapBoletas(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/boletas").WithTags("Boletas");

        group.MapGet("/", async (SmsDbContext db, EstadoBoleta? estado = null) =>
        {
            var query = db.Boletas.AsNoTracking();
            if (estado is not null)
            {
                query = query.Where(b => b.Estado == estado);
            }

            // El OrderBy va antes de proyectar a BoletaDto — EF Core no puede
            // traducir un OrderBy aplicado sobre el resultado de un Select
            // que ya construyó el record.
            var boletas = await Proyectar(query.OrderByDescending(b => b.FechaHoraIngreso), db)
                .ToListAsync();
            return Results.Ok(boletas);
        });

        group.MapGet("/{id:guid}", async (Guid id, SmsDbContext db) =>
        {
            var boleta = await Proyectar(db.Boletas.AsNoTracking().Where(b => b.Id == id), db)
                .FirstOrDefaultAsync();
            return boleta is null ? Results.NotFound() : Results.Ok(boleta);
        });

        // Ingreso — abre la boleta con el primer pesaje.
        group.MapPost("/", async (CrearBoletaRequest request, SmsDbContext db) =>
        {
            var error = await ValidarCreacion(request, db);
            if (error is not null) return error;

            var boleta = new Boleta
            {
                Id = Guid.NewGuid(),
                NumeroBoleta = request.NumeroBoleta,
                BasculaId = request.BasculaId,
                TipoMovimientoId = request.TipoMovimientoId,
                Estado = EstadoBoleta.EnTransito,
                // Sin capa offline todavía, este endpoint central es el
                // punto de entrada directo hasta que exista el flujo
                // SQLite/Outbox — no hay un paso "Local" real que
                // sincronizar, así que nace ya como sincronizada.
                EstadoSync = EstadoSyncBoleta.SincronizadoCentral,
                PesoIngreso = request.PesoIngreso,
                PesoSalida = null,
                PesoNeto = null,
                OrigenPesoIngreso = request.OrigenPesoIngreso,
                OrigenPesoSalida = null,
                FechaHoraIngreso = DateTime.UtcNow,
                FechaHoraSalida = null,
                UsuarioIngreso = request.UsuarioIngreso,
                UsuarioSalida = null,
                CreadaOffline = request.CreadaOffline,
            };

            db.Boletas.Add(boleta);
            await db.SaveChangesAsync();

            var dto = await Proyectar(db.Boletas.AsNoTracking().Where(b => b.Id == boleta.Id), db)
                .FirstAsync();
            return Results.Created($"/api/boletas/{boleta.Id}", dto);
        });

        // Salida — segundo pesaje, cierra la boleta y calcula el neto.
        group.MapPost("/{id:guid}/cerrar", async (Guid id, CerrarBoletaRequest request, SmsDbContext db) =>
        {
            var boleta = await db.Boletas.FirstOrDefaultAsync(b => b.Id == id);
            if (boleta is null) return Results.NotFound();
            if (boleta.Estado != EstadoBoleta.EnTransito)
            {
                return Results.Conflict("Solo se puede cerrar una boleta en estado EnTransito.");
            }

            boleta.PesoSalida = request.PesoSalida;
            boleta.OrigenPesoSalida = request.OrigenPesoSalida;
            boleta.UsuarioSalida = request.UsuarioSalida;
            boleta.BasculaSalidaId = request.BasculaSalidaId;
            boleta.FechaHoraSalida = DateTime.UtcNow;
            boleta.PesoNeto = Math.Abs(boleta.PesoIngreso - request.PesoSalida);
            boleta.Estado = EstadoBoleta.Cerrada;

            await db.SaveChangesAsync();

            var dto = await Proyectar(db.Boletas.AsNoTracking().Where(b => b.Id == id), db).FirstAsync();
            return Results.Ok(dto);
        });

        // Anulación — doble control (UsuarioAnula + UsuarioAutoriza), igual
        // que el legacy. Solo cambia Estado: los pesos de una boleta ya
        // cerrada quedan como registro histórico, no se borran.
        // TODO: BoletaReemplazoId (re-emisión enlazando la boleta nueva) queda
        // fuera de alcance acá — este endpoint no crea ni enlaza reemplazos.
        group.MapPost("/{id:guid}/anular", async (Guid id, AnularBoletaRequest request, SmsDbContext db) =>
        {
            var boleta = await db.Boletas.FirstOrDefaultAsync(b => b.Id == id);
            if (boleta is null) return Results.NotFound();
            if (boleta.Estado == EstadoBoleta.Anulada)
            {
                return Results.Conflict("La boleta ya está anulada.");
            }

            boleta.Estado = EstadoBoleta.Anulada;
            boleta.UsuarioAnula = request.UsuarioAnula;
            boleta.UsuarioAutoriza = request.UsuarioAutoriza;
            boleta.MotivoAnulacion = request.MotivoAnulacion;

            await db.SaveChangesAsync();

            var dto = await Proyectar(db.Boletas.AsNoTracking().Where(b => b.Id == id), db).FirstAsync();
            return Results.Ok(dto);
        });

        // Recepción del Outbox local (Electron/SQLite, ver diseño
        // #sincronizacion) — el dispatcher reenvía acá cada evento
        // Crear/Cerrar/Anular ya decidido offline. A diferencia de los
        // endpoints de arriba, este NO es el punto de entrada de una acción
        // nueva del operador, así que se comporta distinto en dos puntos:
        //   1. Sin enforcement de máquina de estados (el Conflict 409 que sí
        //      tiene /cerrar, p.ej.): la decisión ya se tomó localmente, este
        //      endpoint solo la replica.
        //   2. Idempotente: el dispatcher puede reintentar un evento que en
        //      realidad ya se aplicó pero cuya respuesta se perdió (blip de
        //      red) — aplicar el mismo evento dos veces no debe fallar ni
        //      duplicar datos.
        group.MapPost("/sync", async (SincronizarEventoRequest request, SmsDbContext db) =>
        {
            var bascula = await db.Basculas.AsNoTracking()
                .FirstOrDefaultAsync(b => b.Codigo == request.BasculaCodigo && b.Activa);
            if (bascula is null)
            {
                return Results.BadRequest(
                    $"No existe la báscula con Codigo '{request.BasculaCodigo}', o está inactiva.");
            }

            try
            {
                return await AplicarEventoSync(request, bascula, db);
            }
            catch (Exception ex) when (ex is KeyNotFoundException or FormatException or InvalidOperationException)
            {
                // Payload malformado (campo faltante, GUID/fecha/enum
                // inválido) — en uso real el payload siempre sale de
                // crearBoletaLocal/cerrarBoletaLocal/anularBoletaLocal, así
                // que esto no debería pasar; pero un evento corrupto no
                // debe tirar un 500 crudo, es un 400 claro y accionable.
                return Results.BadRequest($"Payload de sync inválido: {ex.Message}");
            }
        });

        return group;
    }

    private static async Task<IResult> AplicarEventoSync(
        SincronizarEventoRequest request, Bascula bascula, SmsDbContext db)
    {
            switch (request.Operacion)
            {
                case "Crear":
                {
                    var id = ObtenerGuid(request.Payload, "id");

                    // Idempotencia: si ya existe, este evento 'Crear' ya se
                    // aplicó antes (reintento tras una respuesta perdida) —
                    // no-op, se devuelve la boleta tal cual está.
                    if (await db.Boletas.AnyAsync(b => b.Id == id))
                    {
                        var existente = await Proyectar(db.Boletas.AsNoTracking().Where(b => b.Id == id), db)
                            .FirstAsync();
                        return Results.Ok(existente);
                    }

                    var numeroBoleta = request.Payload.GetProperty("numeroBoleta").GetString()!;
                    var tipoMovimientoId = ObtenerGuid(request.Payload, "tipoMovimientoId");
                    var pesoIngreso = request.Payload.GetProperty("pesoIngreso").GetDecimal();
                    var origenPesoIngreso = Enum.Parse<OrigenPeso>(
                        request.Payload.GetProperty("origenPesoIngreso").GetString()!);
                    var fechaHoraIngreso = request.Payload.GetProperty("fechaHoraIngreso").GetDateTime();
                    var usuarioIngreso = request.Payload.GetProperty("usuarioIngreso").GetString()!;
                    var creadaOffline = request.Payload.GetProperty("creadaOffline").GetBoolean();

                    // Defensivo: no debería pasar (el correlativo es único por
                    // báscula), pero no nos salteamos el chequeo solo porque
                    // el evento venga de un dispatcher de confianza.
                    var numeroEnUso = await db.Boletas.AnyAsync(b => b.NumeroBoleta == numeroBoleta && b.Id != id);
                    if (numeroEnUso)
                    {
                        return Results.Conflict($"Ya existe una boleta con NumeroBoleta '{numeroBoleta}'.");
                    }

                    var tipoMovimiento = await db.TiposMovimiento.AsNoTracking()
                        .FirstOrDefaultAsync(t => t.Id == tipoMovimientoId && t.Activo);
                    if (tipoMovimiento is null)
                    {
                        return Results.BadRequest($"No existe el tipo de movimiento {tipoMovimientoId}, o está inactivo.");
                    }

                    var boleta = new Boleta
                    {
                        // Preserva la identidad generada localmente — central
                        // y local se refieren a la MISMA fila desde acá en
                        // adelante.
                        Id = id,
                        NumeroBoleta = numeroBoleta,
                        BasculaId = bascula.Id,
                        TipoMovimientoId = tipoMovimientoId,
                        Estado = EstadoBoleta.EnTransito,
                        EstadoSync = EstadoSyncBoleta.SincronizadoCentral,
                        PesoIngreso = pesoIngreso,
                        PesoSalida = null,
                        PesoNeto = null,
                        OrigenPesoIngreso = origenPesoIngreso,
                        OrigenPesoSalida = null,
                        FechaHoraIngreso = fechaHoraIngreso,
                        FechaHoraSalida = null,
                        UsuarioIngreso = usuarioIngreso,
                        UsuarioSalida = null,
                        CreadaOffline = creadaOffline,
                    };

                    db.Boletas.Add(boleta);
                    await db.SaveChangesAsync();

                    var dto = await Proyectar(db.Boletas.AsNoTracking().Where(b => b.Id == id), db).FirstAsync();
                    return Results.Ok(dto);
                }

                case "Cerrar":
                {
                    var id = ObtenerGuid(request.Payload, "id");
                    var boleta = await db.Boletas.FirstOrDefaultAsync(b => b.Id == id);
                    if (boleta is null)
                    {
                        // No debería pasar (el dispatcher procesa en orden
                        // ascendente de Secuencia por boleta), pero un
                        // 'Cerrar' que llega antes de que su 'Crear' se haya
                        // sincronizado es un error real que hay que
                        // reportar, no tragarse en silencio.
                        return Results.NotFound($"No existe la boleta {id} — ¿llegó el evento 'Crear' antes?");
                    }

                    // Sin chequeo de máquina de estados (ver comentario del
                    // grupo /sync): pisa los mismos campos con los mismos
                    // valores si el evento se reintenta, así que reaplicar
                    // es naturalmente idempotente.
                    boleta.PesoSalida = request.Payload.GetProperty("pesoSalida").GetDecimal();
                    boleta.OrigenPesoSalida = Enum.Parse<OrigenPeso>(
                        request.Payload.GetProperty("origenPesoSalida").GetString()!);
                    boleta.FechaHoraSalida = request.Payload.GetProperty("fechaHoraSalida").GetDateTime();
                    boleta.UsuarioSalida = request.Payload.GetProperty("usuarioSalida").GetString();
                    // BasculaSalidaId es un concepto local (Id de OTRA
                    // instalación SQLite) que hoy nada en el renderer llega a
                    // setear — no existe todavía un "basculaSalidaCodigo"
                    // resoluble contra el catálogo central como sí lo hay
                    // para BasculaId. Queda sin resolver a propósito: siempre
                    // null en la práctica hasta que ese diseño exista.
                    boleta.BasculaSalidaId = null;
                    // El local ya calculó el neto — se confía en el valor,
                    // no se recalcula acá.
                    boleta.PesoNeto = request.Payload.GetProperty("pesoNeto").GetDecimal();
                    boleta.Estado = EstadoBoleta.Cerrada;

                    await db.SaveChangesAsync();

                    var dto = await Proyectar(db.Boletas.AsNoTracking().Where(b => b.Id == id), db).FirstAsync();
                    return Results.Ok(dto);
                }

                case "Anular":
                {
                    var id = ObtenerGuid(request.Payload, "id");
                    var boleta = await db.Boletas.FirstOrDefaultAsync(b => b.Id == id);
                    if (boleta is null)
                    {
                        return Results.NotFound($"No existe la boleta {id} — ¿llegó el evento 'Crear' antes?");
                    }

                    // Mismo razonamiento de idempotencia que en 'Cerrar'.
                    boleta.Estado = EstadoBoleta.Anulada;
                    boleta.UsuarioAnula = request.Payload.GetProperty("usuarioAnula").GetString();
                    boleta.UsuarioAutoriza = request.Payload.GetProperty("usuarioAutoriza").GetString();
                    boleta.MotivoAnulacion = request.Payload.GetProperty("motivoAnulacion").GetString();

                    await db.SaveChangesAsync();

                    var dto = await Proyectar(db.Boletas.AsNoTracking().Where(b => b.Id == id), db).FirstAsync();
                    return Results.Ok(dto);
                }

                default:
                    return Results.BadRequest($"Operación de sync desconocida: '{request.Operacion}'.");
            }
    }

    private static Guid ObtenerGuid(JsonElement payload, string campo) => payload.GetProperty(campo).GetGuid();

    private static async Task<IResult?> ValidarCreacion(CrearBoletaRequest request, SmsDbContext db)
    {
        var numeroEnUso = await db.Boletas.AnyAsync(b => b.NumeroBoleta == request.NumeroBoleta);
        if (numeroEnUso)
        {
            return Results.Conflict($"Ya existe una boleta con NumeroBoleta '{request.NumeroBoleta}'.");
        }

        var bascula = await db.Basculas.AsNoTracking()
            .FirstOrDefaultAsync(b => b.Id == request.BasculaId && b.Activa);
        if (bascula is null)
        {
            return Results.BadRequest($"No existe la báscula {request.BasculaId}, o está inactiva.");
        }

        var tipoMovimiento = await db.TiposMovimiento.AsNoTracking()
            .FirstOrDefaultAsync(t => t.Id == request.TipoMovimientoId && t.Activo);
        if (tipoMovimiento is null)
        {
            return Results.BadRequest($"No existe el tipo de movimiento {request.TipoMovimientoId}, o está inactivo.");
        }

        // El contexto de negocio (equipo/transportista/piloto/tercero/producto/
        // almacén) ya no vive en el Encabezado — su validación de referencia se
        // hará contra los valores de campos configurables en un WU posterior.
        return null;
    }

    private static IQueryable<BoletaDto> Proyectar(IQueryable<Boleta> boletas, SmsDbContext db) =>
        from b in boletas
        join bas in db.Basculas.AsNoTracking() on b.BasculaId equals bas.Id into basculas
        from bascula in basculas.DefaultIfEmpty()
        join tm in db.TiposMovimiento.AsNoTracking() on b.TipoMovimientoId equals tm.Id into tiposMovimiento
        from tipoMovimiento in tiposMovimiento.DefaultIfEmpty()
        select new BoletaDto(
            b.Id, b.NumeroBoleta,
            b.BasculaId, bascula != null ? bascula.Codigo : null,
            b.TipoMovimientoId, tipoMovimiento != null ? tipoMovimiento.Nombre : null,
            b.Estado, b.EstadoSync,
            b.PesoIngreso, b.PesoSalida, b.PesoNeto,
            b.OrigenPesoIngreso, b.OrigenPesoSalida,
            b.FechaHoraIngreso, b.FechaHoraSalida,
            b.UsuarioIngreso, b.UsuarioSalida, b.UsuarioAnula, b.UsuarioAutoriza, b.MotivoAnulacion,
            b.FechaHoraAnulacion,
            b.BoletaReemplazoId, b.BoletaOrigenId, b.BasculaSalidaId, b.PreIngresoId,
            b.RespuestaD365Id, b.CreadaOffline);
}
