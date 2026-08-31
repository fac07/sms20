using Microsoft.EntityFrameworkCore;
using SmsBackend.Data;
using SmsBackend.Domain.TiposMovimiento;

namespace SmsBackend.Domain.Boletas.Extensiones;

/// <summary>
/// Las 4 extensiones de Boleta (Calidad, DetalleFruta, Caracteristica,
/// Compostera). Acá vive el "motor" que el doc comment de TipoMovimiento
/// dejaba pendiente: antes de escribir en Calidad/DetalleFruta/Compostera se
/// valida que el TipoMovimiento de la boleta tenga el Habilita* correspondiente
/// en true. Caracteristica es el escape hatch genérico y no tiene Habilita*
/// que validar — siempre está disponible.
/// </summary>
public static class BoletaExtensionesEndpoints
{
    public static void MapBoletaExtensiones(this IEndpointRouteBuilder app)
    {
        MapCalidad(app);
        MapDetalleFruta(app);
        MapCaracteristicas(app);
        MapCompostera(app);
    }

    private static void MapCalidad(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/boletas/{boletaId:guid}/calidad").WithTags("BoletaCalidad");

        group.MapGet("/", async (Guid boletaId, SmsDbContext db) =>
        {
            if (!await ExisteBoleta(boletaId, db))
            {
                return Results.NotFound($"No existe la boleta {boletaId}.");
            }

            var fila = await db.BoletaCalidades.AsNoTracking()
                .FirstOrDefaultAsync(c => c.BoletaId == boletaId);
            return fila is null ? Results.NotFound() : Results.Ok(ADto(fila));
        });

        // Upsert — a lo sumo una fila de Calidad por boleta.
        group.MapPut("/", async (Guid boletaId, GuardarBoletaCalidadRequest request, SmsDbContext db) =>
        {
            var error = await ValidarGate(boletaId, tm => tm.HabilitaCalidad, "Calidad", db);
            if (error is not null) return error;

            var fila = await db.BoletaCalidades.FirstOrDefaultAsync(c => c.BoletaId == boletaId);
            if (fila is null)
            {
                fila = new BoletaCalidad { Id = Guid.NewGuid(), BoletaId = boletaId };
                db.BoletaCalidades.Add(fila);
            }

            fila.Acidez = request.Acidez;
            fila.DOBI = request.DOBI;
            fila.Humedad = request.Humedad;
            fila.Temperatura = request.Temperatura;
            fila.NumeroRevisionQA = request.NumeroRevisionQA;

            await db.SaveChangesAsync();

            return Results.Ok(ADto(fila));
        });
    }

    private static void MapCompostera(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/boletas/{boletaId:guid}/compostera").WithTags("BoletaCompostera");

        group.MapGet("/", async (Guid boletaId, SmsDbContext db) =>
        {
            if (!await ExisteBoleta(boletaId, db))
            {
                return Results.NotFound($"No existe la boleta {boletaId}.");
            }

            var fila = await db.BoletaComposteras.AsNoTracking()
                .FirstOrDefaultAsync(c => c.BoletaId == boletaId);
            return fila is null ? Results.NotFound() : Results.Ok(ADto(fila));
        });

        // Upsert — a lo sumo una fila de Compostera por boleta.
        group.MapPut("/", async (Guid boletaId, GuardarBoletaComposteraRequest request, SmsDbContext db) =>
        {
            var error = await ValidarGate(boletaId, tm => tm.HabilitaCompostera, "Compostera", db);
            if (error is not null) return error;

            var fila = await db.BoletaComposteras.FirstOrDefaultAsync(c => c.BoletaId == boletaId);
            if (fila is null)
            {
                fila = new BoletaCompostera { Id = Guid.NewGuid(), BoletaId = boletaId };
                db.BoletaComposteras.Add(fila);
            }

            fila.CUI = request.CUI;
            fila.CamaId = request.CamaId;
            fila.SeccionId = request.SeccionId;
            fila.CicloId = request.CicloId;

            await db.SaveChangesAsync();

            return Results.Ok(ADto(fila));
        });
    }

    private static void MapDetalleFruta(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/boletas/{boletaId:guid}/detalle-fruta").WithTags("BoletaDetalleFruta");

        group.MapGet("/", async (Guid boletaId, SmsDbContext db) =>
        {
            if (!await ExisteBoleta(boletaId, db))
            {
                return Results.NotFound($"No existe la boleta {boletaId}.");
            }

            var filas = await db.BoletaDetalleFrutas.AsNoTracking()
                .Where(d => d.BoletaId == boletaId)
                .Select(d => ADto(d))
                .ToListAsync();
            return Results.Ok(filas);
        });

        group.MapPost("/", async (Guid boletaId, GuardarBoletaDetalleFrutaRequest request, SmsDbContext db) =>
        {
            var error = await ValidarGate(boletaId, tm => tm.HabilitaDetalleFruta, "DetalleFruta", db);
            if (error is not null) return error;

            var fila = new BoletaDetalleFruta
            {
                Id = Guid.NewGuid(),
                BoletaId = boletaId,
                RacimosVerdes = request.RacimosVerdes,
                RacimosMaduros = request.RacimosMaduros,
                RacimosSobreMaduros = request.RacimosSobreMaduros,
                RacimosPasados = request.RacimosPasados,
                PedunculoLargo = request.PedunculoLargo,
                Sacos = request.Sacos,
                Jornales = request.Jornales,
                Hectareas = request.Hectareas,
            };

            db.BoletaDetalleFrutas.Add(fila);
            await db.SaveChangesAsync();

            return Results.Created($"/api/boletas/{boletaId}/detalle-fruta/{fila.Id}", ADto(fila));
        });

        // Hard delete acá está bien — a diferencia de Maestro/TipoMovimiento/
        // Bascula/Boleta, un detalle de fruta cargado por error antes de
        // cerrar la boleta no necesita rastro de auditoría propio; la boleta
        // en sí ya lo tiene.
        group.MapDelete("/{id:guid}", async (Guid boletaId, Guid id, SmsDbContext db) =>
        {
            var fila = await db.BoletaDetalleFrutas
                .FirstOrDefaultAsync(d => d.Id == id && d.BoletaId == boletaId);
            if (fila is null) return Results.NotFound();

            db.BoletaDetalleFrutas.Remove(fila);
            await db.SaveChangesAsync();

            return Results.NoContent();
        });
    }

    private static void MapCaracteristicas(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/boletas/{boletaId:guid}/caracteristicas").WithTags("BoletaCaracteristica");

        group.MapGet("/", async (Guid boletaId, SmsDbContext db) =>
        {
            if (!await ExisteBoleta(boletaId, db))
            {
                return Results.NotFound($"No existe la boleta {boletaId}.");
            }

            var filas = await db.BoletaCaracteristicas.AsNoTracking()
                .Where(c => c.BoletaId == boletaId)
                .Select(c => ADto(c))
                .ToListAsync();
            return Results.Ok(filas);
        });

        // Ungated — Caracteristica es el escape hatch genérico, no tiene
        // Habilita* que validar.
        group.MapPost("/", async (Guid boletaId, GuardarBoletaCaracteristicaRequest request, SmsDbContext db) =>
        {
            if (!await ExisteBoleta(boletaId, db))
            {
                return Results.NotFound($"No existe la boleta {boletaId}.");
            }

            var fila = new BoletaCaracteristica
            {
                Id = Guid.NewGuid(),
                BoletaId = boletaId,
                Clave = request.Clave,
                Valor = request.Valor,
                TipoDato = request.TipoDato,
            };

            db.BoletaCaracteristicas.Add(fila);
            await db.SaveChangesAsync();

            return Results.Created($"/api/boletas/{boletaId}/caracteristicas/{fila.Id}", ADto(fila));
        });

        group.MapDelete("/{id:guid}", async (Guid boletaId, Guid id, SmsDbContext db) =>
        {
            var fila = await db.BoletaCaracteristicas
                .FirstOrDefaultAsync(c => c.Id == id && c.BoletaId == boletaId);
            if (fila is null) return Results.NotFound();

            db.BoletaCaracteristicas.Remove(fila);
            await db.SaveChangesAsync();

            return Results.NoContent();
        });
    }

    /// <summary>
    /// El "motor": confirma que la Boleta exista y que su TipoMovimiento
    /// tenga habilitada la sección que se quiere escribir. Reusado por los 3
    /// grupos de endpoints gateados (Calidad, DetalleFruta, Compostera).
    /// </summary>
    private static async Task<IResult?> ValidarGate(
        Guid boletaId, Func<TipoMovimiento, bool> habilitada, string nombreSeccion, SmsDbContext db)
    {
        var boleta = await db.Boletas.AsNoTracking().FirstOrDefaultAsync(b => b.Id == boletaId);
        if (boleta is null)
        {
            return Results.NotFound($"No existe la boleta {boletaId}.");
        }

        var tipoMovimiento = await db.TiposMovimiento.AsNoTracking()
            .FirstOrDefaultAsync(t => t.Id == boleta.TipoMovimientoId);
        if (tipoMovimiento is null || !habilitada(tipoMovimiento))
        {
            return Results.BadRequest($"Este TipoMovimiento no tiene habilitada la sección {nombreSeccion}.");
        }

        return null;
    }

    private static Task<bool> ExisteBoleta(Guid boletaId, SmsDbContext db) =>
        db.Boletas.AsNoTracking().AnyAsync(b => b.Id == boletaId);

    private static BoletaCalidadDto ADto(BoletaCalidad c) => new(
        c.Id, c.BoletaId, c.Acidez, c.DOBI, c.Humedad, c.Temperatura, c.NumeroRevisionQA);

    private static BoletaDetalleFrutaDto ADto(BoletaDetalleFruta d) => new(
        d.Id, d.BoletaId, d.RacimosVerdes, d.RacimosMaduros, d.RacimosSobreMaduros,
        d.RacimosPasados, d.PedunculoLargo, d.Sacos, d.Jornales, d.Hectareas);

    private static BoletaCaracteristicaDto ADto(BoletaCaracteristica c) => new(
        c.Id, c.BoletaId, c.Clave, c.Valor, c.TipoDato);

    private static BoletaComposteraDto ADto(BoletaCompostera c) => new(
        c.Id, c.BoletaId, c.CUI, c.CamaId, c.SeccionId, c.CicloId);
}
