using Microsoft.EntityFrameworkCore;
using SmsBackend.Data;
using SmsBackend.Domain.Boletas;

namespace SmsBackend.Domain.Reportes;

public static class ResumenBasculasEndpoints
{
    public static RouteGroupBuilder MapReportes(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/reportes").WithTags("Reportes");

        // Resumen diario por báscula — solo lectura, sin paginación: el
        // cardinal de filas es básculas × días del rango, acotado por el
        // propio rango. Los días sin actividad de una báscula simplemente no
        // aparecen (el frontend muestra huecos, no ceros fabricados).
        // Fechas del query = días calendario UTC, inclusivos en ambos
        // extremos. El repo todavía no modela la zona horaria de planta —
        // ver ResumenBasculaDiaDto: si operaciones pide día local, es un
        // parámetro de offset en una tarea futura, no un cambio de schema.
        group.MapGet("/resumen-basculas", async (
            DateOnly? desde, DateOnly? hasta, SmsDbContext db, CancellationToken ct) =>
        {
            if (desde is null || hasta is null)
            {
                return Results.BadRequest("desde y hasta son obligatorios (YYYY-MM-DD).");
            }
            if (hasta < desde)
            {
                return Results.BadRequest("hasta no puede ser anterior a desde.");
            }

            var desdeUtc = desde.Value.ToDateTime(TimeOnly.MinValue);
            var hastaUtcExclusivo = hasta.Value.ToDateTime(TimeOnly.MinValue).AddDays(1);

            var grupos = await db.Boletas.AsNoTracking()
                .Where(b => b.Estado == EstadoBoleta.Cerrada
                    && b.FechaHoraSalida != null
                    && b.FechaHoraSalida >= desdeUtc
                    && b.FechaHoraSalida < hastaUtcExclusivo)
                .GroupBy(b => new { b.BasculaId, Dia = b.FechaHoraSalida!.Value.Date })
                .Select(g => new
                {
                    g.Key.BasculaId,
                    g.Key.Dia,
                    CantidadBoletas = g.Count(),
                    PesoNetoTotal = g.Sum(b => b.PesoNeto ?? 0m),
                })
                .ToListAsync(ct);

            if (grupos.Count == 0)
            {
                return Results.Ok(new List<ResumenBasculaDiaDto>());
            }

            var basculaIds = grupos.Select(g => g.BasculaId).Distinct().ToList();
            var nombres = await db.Basculas.AsNoTracking()
                .Where(b => basculaIds.Contains(b.Id))
                .ToDictionaryAsync(b => b.Id, b => b.Nombre, ct);

            var filas = grupos
                .Select(g => new ResumenBasculaDiaDto(
                    g.BasculaId,
                    nombres.TryGetValue(g.BasculaId, out var nombre) ? nombre : "(báscula eliminada)",
                    DateOnly.FromDateTime(g.Dia),
                    g.CantidadBoletas,
                    g.PesoNetoTotal))
                .OrderBy(f => f.BasculaNombre, StringComparer.Ordinal)
                .ThenBy(f => f.Fecha)
                .ToList();

            return Results.Ok(filas);
        });

        return group;
    }
}
