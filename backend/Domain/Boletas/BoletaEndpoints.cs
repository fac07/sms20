using Microsoft.EntityFrameworkCore;
using SmsBackend.Data;
using SmsBackend.Domain.Maestros;

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
                EquipoId = request.EquipoId,
                TransportistaId = request.TransportistaId,
                PilotoId = request.PilotoId,
                TerceroId = request.TerceroId,
                ProductoId = request.ProductoId,
                AlmacenOrigenId = request.AlmacenOrigenId,
                AlmacenDestinoId = request.AlmacenDestinoId,
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

        return group;
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

        var errorMaestro =
            await ValidarMaestroActivo(request.EquipoId, "EquipoId", db)
            ?? await ValidarMaestroActivo(request.TransportistaId, "TransportistaId", db)
            ?? await ValidarMaestroActivo(request.PilotoId, "PilotoId", db)
            ?? await ValidarMaestroActivo(request.TerceroId, "TerceroId", db)
            ?? await ValidarMaestroActivo(request.ProductoId, "ProductoId", db)
            ?? await ValidarMaestroActivoOpcional(request.AlmacenOrigenId, "AlmacenOrigenId", db)
            ?? await ValidarMaestroActivoOpcional(request.AlmacenDestinoId, "AlmacenDestinoId", db);
        if (errorMaestro is not null) return errorMaestro;

        return null;
    }

    private static async Task<IResult?> ValidarMaestroActivo(Guid id, string campo, SmsDbContext db)
    {
        var existe = await db.Maestros.AsNoTracking().AnyAsync(m => m.Id == id && m.Activo);
        return existe ? null : Results.BadRequest($"No existe el maestro referenciado por {campo} ({id}), o está inactivo.");
    }

    private static async Task<IResult?> ValidarMaestroActivoOpcional(Guid? id, string campo, SmsDbContext db)
    {
        if (id is null) return null;
        return await ValidarMaestroActivo(id.Value, campo, db);
    }

    private static IQueryable<BoletaDto> Proyectar(IQueryable<Boleta> boletas, SmsDbContext db) =>
        from b in boletas
        join bas in db.Basculas.AsNoTracking() on b.BasculaId equals bas.Id into basculas
        from bascula in basculas.DefaultIfEmpty()
        join tm in db.TiposMovimiento.AsNoTracking() on b.TipoMovimientoId equals tm.Id into tiposMovimiento
        from tipoMovimiento in tiposMovimiento.DefaultIfEmpty()
        join eq in db.Maestros.AsNoTracking() on b.EquipoId equals eq.Id into equipos
        from equipo in equipos.DefaultIfEmpty()
        join tr in db.Maestros.AsNoTracking() on b.TransportistaId equals tr.Id into transportistas
        from transportista in transportistas.DefaultIfEmpty()
        join pi in db.Maestros.AsNoTracking() on b.PilotoId equals pi.Id into pilotos
        from piloto in pilotos.DefaultIfEmpty()
        join te in db.Maestros.AsNoTracking() on b.TerceroId equals te.Id into terceros
        from tercero in terceros.DefaultIfEmpty()
        join pr in db.Maestros.AsNoTracking() on b.ProductoId equals pr.Id into productos
        from producto in productos.DefaultIfEmpty()
        select new BoletaDto(
            b.Id, b.NumeroBoleta,
            b.BasculaId, bascula != null ? bascula.Codigo : null,
            b.TipoMovimientoId, tipoMovimiento != null ? tipoMovimiento.Nombre : null,
            b.Estado, b.EstadoSync,
            b.EquipoId, equipo != null ? equipo.Codigo : null,
            b.TransportistaId, transportista != null ? transportista.Codigo : null,
            b.PilotoId, piloto != null ? piloto.Codigo : null,
            b.TerceroId, tercero != null ? tercero.Codigo : null,
            b.ProductoId, producto != null ? producto.Codigo : null,
            b.AlmacenOrigenId, b.AlmacenDestinoId,
            b.PesoIngreso, b.PesoSalida, b.PesoNeto,
            b.OrigenPesoIngreso, b.OrigenPesoSalida,
            b.FechaHoraIngreso, b.FechaHoraSalida,
            b.UsuarioIngreso, b.UsuarioSalida, b.UsuarioAnula, b.UsuarioAutoriza, b.MotivoAnulacion,
            b.BoletaReemplazoId, b.BoletaOrigenId, b.BasculaSalidaId,
            b.RespuestaD365Id, b.CreadaOffline);
}
