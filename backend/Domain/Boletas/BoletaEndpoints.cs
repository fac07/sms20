using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using SmsBackend.Data;
using SmsBackend.Domain.Basculas;
using SmsBackend.Domain.Boletas.Valores;

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
        group.MapPost("/", async (CrearBoletaRequest request, MotorCampos motor, SmsDbContext db, CancellationToken ct) =>
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

            var valores = request.Valores ?? Array.Empty<ValorCampoDto>();

            // El conjunto de campos aplicable se resuelve as-of FechaHoraIngreso;
            // un CampoId fuera de ese conjunto o un valor que viola su tipo/config
            // aborta la creación con la lista de errores por campo.
            var errores = await motor.ValidarValoresAsync(
                boleta.TipoMovimientoId, boleta.FechaHoraIngreso, valores, ct);
            if (errores.Count > 0)
            {
                return Results.BadRequest(errores);
            }

            db.Boletas.Add(boleta);
            await AgregarValoresAsync(db, boleta.Id, valores, ct);
            // Encabezado + filas BoletaValorCampo en un solo SaveChanges.
            await db.SaveChangesAsync(ct);

            var dto = await Proyectar(db.Boletas.AsNoTracking().Where(b => b.Id == boleta.Id), db)
                .FirstAsync(ct);
            return Results.Created($"/api/boletas/{boleta.Id}", dto);
        });

        // Salida — segundo pesaje, cierra la boleta y calcula el neto.
        group.MapPost("/{id:guid}/cerrar", async (
            Guid id, CerrarBoletaRequest request, MotorCampos motor, SmsDbContext db, CancellationToken ct) =>
        {
            var boleta = await db.Boletas.FirstOrDefaultAsync(b => b.Id == id, ct);
            if (boleta is null) return Results.NotFound();
            if (boleta.Estado != EstadoBoleta.EnTransito)
            {
                return Results.Conflict("Solo se puede cerrar una boleta en estado EnTransito.");
            }

            // Bloqueo duro (sin bypass): el motor valida contra el conjunto de
            // campos resuelto a asOf = FechaHoraIngreso. Si hay errores la boleta
            // se queda EnTransito.
            var errores = await motor.ValidarCierreAsync(boleta, ct);
            if (errores.Count > 0)
            {
                return Results.UnprocessableEntity(errores);
            }

            boleta.PesoSalida = request.PesoSalida;
            boleta.OrigenPesoSalida = request.OrigenPesoSalida;
            boleta.UsuarioSalida = request.UsuarioSalida;
            boleta.BasculaSalidaId = request.BasculaSalidaId;
            boleta.FechaHoraSalida = DateTime.UtcNow;
            boleta.PesoNeto = Math.Abs(boleta.PesoIngreso - request.PesoSalida);
            boleta.Estado = EstadoBoleta.Cerrada;

            await db.SaveChangesAsync(ct);

            var dto = await Proyectar(db.Boletas.AsNoTracking().Where(b => b.Id == id), db).FirstAsync(ct);
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
            boleta.FechaHoraAnulacion = DateTime.UtcNow;

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
        group.MapPost("/sync", async (
            SincronizarEventoRequest request, MotorCampos motor, SmsDbContext db, CancellationToken ct) =>
        {
            var bascula = await db.Basculas.AsNoTracking()
                .FirstOrDefaultAsync(b => b.Codigo == request.BasculaCodigo && b.Activa, ct);
            if (bascula is null)
            {
                return Results.BadRequest(
                    $"No existe la báscula con Codigo '{request.BasculaCodigo}', o está inactiva.");
            }

            try
            {
                return await AplicarEventoSync(request, bascula, motor, db, ct);
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
        SincronizarEventoRequest request, Bascula bascula, MotorCampos motor, SmsDbContext db, CancellationToken ct)
    {
            switch (request.Operacion)
            {
                case "Crear":
                {
                    var id = ObtenerGuid(request.Payload, "id");

                    // Idempotencia: si ya existe, este evento 'Crear' ya se
                    // aplicó antes (reintento tras una respuesta perdida) —
                    // no-op, se devuelve la boleta tal cual está.
                    if (await db.Boletas.AnyAsync(b => b.Id == id, ct))
                    {
                        var existente = await Proyectar(db.Boletas.AsNoTracking().Where(b => b.Id == id), db)
                            .FirstAsync(ct);
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
                    var numeroEnUso = await db.Boletas.AnyAsync(b => b.NumeroBoleta == numeroBoleta && b.Id != id, ct);
                    if (numeroEnUso)
                    {
                        return Results.Conflict($"Ya existe una boleta con NumeroBoleta '{numeroBoleta}'.");
                    }

                    var tipoMovimiento = await db.TiposMovimiento.AsNoTracking()
                        .FirstOrDefaultAsync(t => t.Id == tipoMovimientoId && t.Activo, ct);
                    if (tipoMovimiento is null)
                    {
                        return Results.BadRequest($"No existe el tipo de movimiento {tipoMovimientoId}, o está inactivo.");
                    }

                    // Los valores llegan keyed por campoId — NO se re-resuelve la
                    // clave: un cache de báscula viejo conserva su CampoId
                    // original y así debe quedar almacenado (candado
                    // as-of-creation).
                    var valores = LeerValores(request.Payload);
                    var errores = await motor.ValidarValoresAsync(tipoMovimientoId, fechaHoraIngreso, valores, ct);
                    if (errores.Count > 0)
                    {
                        return Results.UnprocessableEntity(errores);
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
                    await AgregarValoresAsync(db, boleta.Id, valores, ct);
                    await db.SaveChangesAsync(ct);

                    var dto = await Proyectar(db.Boletas.AsNoTracking().Where(b => b.Id == id), db).FirstAsync(ct);
                    return Results.Ok(dto);
                }

                case "Cerrar":
                {
                    var id = ObtenerGuid(request.Payload, "id");
                    var boleta = await db.Boletas.FirstOrDefaultAsync(b => b.Id == id, ct);
                    if (boleta is null)
                    {
                        // No debería pasar (el dispatcher procesa en orden
                        // ascendente de Secuencia por boleta), pero un
                        // 'Cerrar' que llega antes de que su 'Crear' se haya
                        // sincronizado es un error real que hay que
                        // reportar, no tragarse en silencio.
                        return Results.NotFound($"No existe la boleta {id} — ¿llegó el evento 'Crear' antes?");
                    }

                    // El grupo /sync se saltea la máquina de estados, pero la
                    // integridad de campos requeridos es una invariante de
                    // datos, no de orden de flujo: se corre el motor igual. Si
                    // falla -> 422 y EstadoSync = ErrorCentral para que el
                    // dispatcher marque el evento fallido y un admin vea el
                    // drift del cache, en vez de reintentar para siempre o
                    // aceptar en silencio una boleta cerrada inválida.
                    var errores = await motor.ValidarCierreAsync(boleta, ct);
                    if (errores.Count > 0)
                    {
                        boleta.EstadoSync = EstadoSyncBoleta.ErrorCentral;
                        await db.SaveChangesAsync(ct);
                        return Results.UnprocessableEntity(errores);
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

                    await db.SaveChangesAsync(ct);

                    var dto = await Proyectar(db.Boletas.AsNoTracking().Where(b => b.Id == id), db).FirstAsync(ct);
                    return Results.Ok(dto);
                }

                case "Anular":
                {
                    var id = ObtenerGuid(request.Payload, "id");
                    var boleta = await db.Boletas.FirstOrDefaultAsync(b => b.Id == id, ct);
                    if (boleta is null)
                    {
                        return Results.NotFound($"No existe la boleta {id} — ¿llegó el evento 'Crear' antes?");
                    }

                    // Mismo razonamiento de idempotencia que en 'Cerrar'.
                    boleta.Estado = EstadoBoleta.Anulada;
                    boleta.UsuarioAnula = request.Payload.GetProperty("usuarioAnula").GetString();
                    boleta.UsuarioAutoriza = request.Payload.GetProperty("usuarioAutoriza").GetString();
                    boleta.MotivoAnulacion = request.Payload.GetProperty("motivoAnulacion").GetString();
                    boleta.FechaHoraAnulacion =
                        LeerFechaHora(request.Payload, "fechaHoraAnulacion") ?? DateTime.UtcNow;

                    await db.SaveChangesAsync(ct);

                    var dto = await Proyectar(db.Boletas.AsNoTracking().Where(b => b.Id == id), db).FirstAsync(ct);
                    return Results.Ok(dto);
                }

                default:
                    return Results.BadRequest($"Operación de sync desconocida: '{request.Operacion}'.");
            }
    }

    private static Guid ObtenerGuid(JsonElement payload, string campo) => payload.GetProperty(campo).GetGuid();

    /// <summary>
    /// Convierte el arreglo <c>valores</c> del payload crudo de sync en la
    /// representación única <see cref="ValorCampoDto"/> keyed por
    /// (<c>campoId</c>, <c>ocurrencia</c>). Un payload sin <c>valores</c> o con
    /// un <c>valores</c> vacío produce una lista vacía.
    /// </summary>
    private static IReadOnlyList<ValorCampoDto> LeerValores(JsonElement payload)
    {
        if (!payload.TryGetProperty("valores", out var arreglo) || arreglo.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<ValorCampoDto>();
        }

        var lista = new List<ValorCampoDto>();
        foreach (var elemento in arreglo.EnumerateArray())
        {
            lista.Add(new ValorCampoDto(
                elemento.GetProperty("campoId").GetGuid(),
                elemento.GetProperty("ocurrencia").GetInt32(),
                LeerTexto(elemento, "valorTexto"),
                LeerDecimal(elemento, "valorNumero"),
                LeerFechaHora(elemento, "valorFecha"),
                LeerBooleano(elemento, "valorBooleano"),
                LeerGuidNullable(elemento, "valorMaestroId")));
        }

        return lista;
    }

    private static string? LeerTexto(JsonElement el, string prop) =>
        el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static decimal? LeerDecimal(JsonElement el, string prop) =>
        el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDecimal() : null;

    private static DateTime? LeerFechaHora(JsonElement el, string prop) =>
        el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String ? v.GetDateTime() : null;

    private static bool? LeerBooleano(JsonElement el, string prop) =>
        el.TryGetProperty(prop, out var v) && v.ValueKind is JsonValueKind.True or JsonValueKind.False
            ? v.GetBoolean()
            : null;

    private static Guid? LeerGuidNullable(JsonElement el, string prop) =>
        el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String ? v.GetGuid() : null;

    /// <summary>
    /// Agrega las filas <see cref="BoletaValorCampo"/> al ChangeTracker (sin
    /// SaveChanges). <c>SeccionId</c> se resuelve server-side desde
    /// <see cref="SmsBackend.Domain.Configuracion.Campo.SeccionId"/> — nunca se
    /// acepta del cliente. Se asume que los valores ya pasaron
    /// <see cref="MotorCampos.ValidarValoresAsync"/>, así que cada CampoId
    /// existe en el conjunto vigente.
    /// </summary>
    private static async Task AgregarValoresAsync(
        SmsDbContext db, Guid boletaId, IReadOnlyList<ValorCampoDto> valores, CancellationToken ct)
    {
        if (valores.Count == 0) return;

        var campoIds = valores.Select(v => v.CampoId).Distinct().ToList();
        var seccionPorCampo = await db.Campos
            .Where(c => campoIds.Contains(c.Id))
            .Select(c => new { c.Id, c.SeccionId })
            .ToDictionaryAsync(c => c.Id, c => c.SeccionId, ct);

        foreach (var v in valores)
        {
            db.BoletaValores.Add(new BoletaValorCampo
            {
                BoletaId = boletaId,
                CampoId = v.CampoId,
                Ocurrencia = v.Ocurrencia,
                SeccionId = seccionPorCampo[v.CampoId],
                ValorTexto = v.ValorTexto,
                ValorNumero = v.ValorNumero,
                ValorFecha = v.ValorFecha,
                ValorBooleano = v.ValorBooleano,
                ValorMaestroId = v.ValorMaestroId,
            });
        }
    }

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
        // almacén) viaja en request.Valores y lo valida MotorCampos contra el
        // conjunto de campos vigente al crear la boleta.
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
            b.RespuestaD365Id, b.CreadaOffline,
            // Valores capturados: se unen por el CampoId ALMACENADO (sin filtro
            // VigenteHasta) para que un Campo retirado siga resolviendo. El join
            // a Maestro es un subquery escalar por columna (ReferenciaMaestro).
            (from v in db.BoletaValores.AsNoTracking()
             where v.BoletaId == b.Id
             join c in db.Campos.AsNoTracking() on v.CampoId equals c.Id
             join s in db.Secciones.AsNoTracking() on c.SeccionId equals s.Id
             orderby s.Orden, c.Orden, v.Ocurrencia
             select new ValorCampoLeidoDto(
                 v.CampoId,
                 s.Clave,
                 s.Nombre,
                 c.Clave,
                 c.Etiqueta,
                 c.TipoCampo,
                 v.Ocurrencia,
                 v.ValorTexto,
                 v.ValorNumero,
                 v.ValorFecha,
                 v.ValorBooleano,
                 v.ValorMaestroId,
                 db.Maestros.Where(m => m.Id == v.ValorMaestroId).Select(m => m.Codigo).FirstOrDefault(),
                 db.Maestros.Where(m => m.Id == v.ValorMaestroId).Select(m => m.Nombre).FirstOrDefault()))
            .ToList());
}
