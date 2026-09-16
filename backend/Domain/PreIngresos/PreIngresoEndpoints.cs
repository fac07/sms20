using Microsoft.EntityFrameworkCore;
using SmsBackend.Data;
using SmsBackend.Domain.Maestros;
using SmsBackend.Domain.Seguridad;
using SmsBackend.Domain.Transporte;

namespace SmsBackend.Domain.PreIngresos;

public static class PreIngresoEndpoints
{
    public static RouteGroupBuilder MapPreIngresos(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/preingresos").WithTags("PreIngresos");

        // Listado admin Y delta-sync del terminal en un solo endpoint.
        // El terminal no tiene usuario humano: este GET queda intencionalmente
        // sin RequireAuthorization, igual que los endpoints device/sync de PR3.
        //   - ?centroId= siempre scopea (el delta del terminal filtra por su centro).
        //   - ?modificadoDesde= activa el modo delta: predicado estrictamente
        //     mayor al watermark e IGNORA ?estado= — una fila que pasó a
        //     Vinculado/Cancelado tiene que llegar igual a cada báscula o el
        //     registro nunca sale de las otras colas (design D5, mismo criterio
        //     que incluirInactivos en MaestroEndpoints).
        group.MapGet("/", async (
            SmsDbContext db,
            Guid? centroId = null,
            EstadoPreIngreso? estado = null,
            string? numeroEnvio = null,
            DateTime? modificadoDesde = null) =>
        {
            // Sin claims humanos el filtro global de Centro falla cerrado; el
            // terminal lo omite y queda acotado por centroId + watermark delta.
            var query = db.PreIngresos.IgnoreQueryFilters().AsNoTracking();

            if (centroId is not null)
            {
                query = query.Where(p => p.CentroId == centroId);
            }

            if (!string.IsNullOrWhiteSpace(numeroEnvio))
            {
                query = query.Where(p => p.NumeroEnvio.Contains(numeroEnvio));
            }

            if (modificadoDesde is not null)
            {
                query = query.Where(p => p.FechaModificacion > modificadoDesde);
            }
            else if (estado is not null)
            {
                query = query.Where(p => p.Estado == estado);
            }

            // La consulta operativa es una cola FIFO; el delta conserva el
            // orden de su watermark para no mezclar ambos contratos.
            var consultaOrdenada = modificadoDesde is null
                ? query.OrderBy(p => p.FechaCreacion).ThenBy(p => p.Id)
                : query.OrderBy(p => p.FechaModificacion).ThenBy(p => p.Id);

            var preingresos = await consultaOrdenada
                .Select(p => PreIngresoDto.FromEntity(p))
                .ToListAsync();

            return Results.Ok(preingresos);
        });

        group.MapGet("/{id:guid}", async (Guid id, SmsDbContext db) =>
        {
            var preingreso = await db.PreIngresos.AsNoTracking().FirstOrDefaultAsync(p => p.Id == id);
            return preingreso is null ? Results.NotFound() : Results.Ok(PreIngresoDto.FromEntity(preingreso));
        }).RequireAuthorization(Politicas.Operador);

        group.MapPost("/", async (CrearPreIngresoRequest request, SmsDbContext db, CancellationToken ct) =>
        {
            var error = await ValidarCentro(request.CentroId, db);
            if (error is not null) return error;

            var errorVinculo = await ValidarVinculo(request.PilotoId, request.TransportistaId, db, ct);
            if (errorVinculo is not null) return errorVinculo;

            var preingreso = new PreIngreso
            {
                Id = Guid.NewGuid(),
                CentroId = request.CentroId,
                PilotoId = request.PilotoId,
                TransportistaId = request.TransportistaId,
                EquipoId = request.EquipoId,
                RegionId = request.RegionId,
                FincaId = request.FincaId,
                NumeroEnvio = request.NumeroEnvio,
                PesoEnviado = request.PesoEnviado,
                Racimos = request.Racimos,
                Sacos = request.Sacos,
                Observaciones = request.Observaciones,
                // Estado forzado server-side — una báscula nunca puede acuñar
                // un Vinculado ni un Cancelado por esta vía.
                Estado = EstadoPreIngreso.Pendiente,
                UsuarioCreacion = request.UsuarioCreacion,
                FechaCreacion = DateTime.UtcNow,
                // FechaModificacion la sella SmsDbContext.SaveChanges (IFechaModificable).
            };

            db.PreIngresos.Add(preingreso);
            await db.SaveChangesAsync();

            return Results.Created(
                $"/api/preingresos/{preingreso.Id}", PreIngresoDto.FromEntity(preingreso));
        }).RequireAuthorization(Politicas.Administrador);

        group.MapPut("/{id:guid}", async (Guid id, EditarPreIngresoRequest request, SmsDbContext db, CancellationToken ct) =>
        {
            var preingreso = await db.PreIngresos.FirstOrDefaultAsync(p => p.Id == id);
            if (preingreso is null) return Results.NotFound();

            if (preingreso.Estado != EstadoPreIngreso.Pendiente)
            {
                return Results.Conflict(
                    $"Solo se puede editar un pre-ingreso en estado Pendiente (actual: {preingreso.Estado}).");
            }

            var error = await ValidarCentro(request.CentroId, db);
            if (error is not null) return error;

            var errorVinculo = await ValidarVinculo(request.PilotoId, request.TransportistaId, db, ct);
            if (errorVinculo is not null) return errorVinculo;

            preingreso.CentroId = request.CentroId;
            preingreso.PilotoId = request.PilotoId;
            preingreso.TransportistaId = request.TransportistaId;
            preingreso.EquipoId = request.EquipoId;
            preingreso.RegionId = request.RegionId;
            preingreso.FincaId = request.FincaId;
            preingreso.NumeroEnvio = request.NumeroEnvio;
            preingreso.PesoEnviado = request.PesoEnviado;
            preingreso.Racimos = request.Racimos;
            preingreso.Sacos = request.Sacos;
            preingreso.Observaciones = request.Observaciones;
            // FechaModificacion la avanza el sellador de SmsDbContext.

            await db.SaveChangesAsync();

            return Results.Ok(PreIngresoDto.FromEntity(preingreso));
        }).RequireAuthorization(Politicas.Administrador);

        // Las observaciones son una anotación operativa, no una transición de
        // estado. Por eso se editan mediante un subrecurso independiente aun
        // cuando el pre-ingreso ya está Vinculado o Cancelado.
        group.MapPut("/{id:guid}/observaciones", async (
            Guid id, EditarObservacionesPreIngresoRequest request, SmsDbContext db) =>
        {
            var preingreso = await db.PreIngresos.FirstOrDefaultAsync(p => p.Id == id);
            if (preingreso is null) return Results.NotFound();

            preingreso.Observaciones = request.Observaciones;
            await db.SaveChangesAsync();

            return Results.Ok(PreIngresoDto.FromEntity(preingreso));
        }).RequireAuthorization(Politicas.Administrador);

        // Cancelación admin — solo desde Pendiente. Vinculado es terminal
        // (design D4): un pre-ingreso ya enlazado no se cancela por estado, la
        // cancelación-tras-vínculo se resuelve con una marca en la boleta
        // (slice 2), no acá.
        group.MapPost("/{id:guid}/cancelar", async (
            Guid id, CancelarPreIngresoRequest request, SmsDbContext db) =>
        {
            var preingreso = await db.PreIngresos.FirstOrDefaultAsync(p => p.Id == id);
            if (preingreso is null) return Results.NotFound();

            if (preingreso.Estado != EstadoPreIngreso.Pendiente)
            {
                return Results.Conflict(
                    $"Solo se puede cancelar un pre-ingreso en estado Pendiente (actual: {preingreso.Estado}).");
            }

            preingreso.Estado = EstadoPreIngreso.Cancelado;
            preingreso.UsuarioCancela = request.UsuarioCancela;
            preingreso.MotivoCancelacion = request.MotivoCancelacion;
            // FechaModificacion la avanza el sellador — así el Cancelado se
            // propaga a las básculas en el próximo delta.

            await db.SaveChangesAsync();

            return Results.Ok(PreIngresoDto.FromEntity(preingreso));
        }).RequireAuthorization(Politicas.Administrador);

        // Sin DELETE — soft-state vía Cancelado, igual que la convención de
        // Maestro / Bascula / TipoMovimiento (nunca se borra en duro).

        return group;
    }

    private static async Task<IResult?> ValidarCentro(Guid centroId, SmsDbContext db)
    {
        if (centroId == Guid.Empty)
        {
            return Results.BadRequest("CentroId es obligatorio.");
        }

        var centro = await db.Maestros.AsNoTracking()
            .FirstOrDefaultAsync(m => m.Id == centroId && m.Activo);
        if (centro is null)
        {
            return Results.BadRequest($"No existe el centro {centroId}, o está inactivo.");
        }
        if (centro.TipoCatalogo != TipoCatalogo.Centro)
        {
            return Results.BadRequest($"El maestro {centroId} no es de TipoCatalogo=Centro.");
        }

        return null;
    }

    /// <summary>
    /// Guardia del par piloto+transportista (design D2) — solo corre cuando
    /// AMBOS campos vienen provistos: un formulario que todavía tiene solo
    /// uno de los dos seleccionados no dispara este chequeo (spec "Only
    /// transportista chosen so far").
    /// </summary>
    private static Task<IResult?> ValidarVinculo(
        Guid? pilotoId, Guid? transportistaId, SmsDbContext db, CancellationToken ct) =>
        pilotoId is Guid piloto && transportistaId is Guid transportista
            ? GuardiaVinculoTransporte.ValidarAsync(db, piloto, transportista, ct)
            : Task.FromResult<IResult?>(null);
}
