using Microsoft.EntityFrameworkCore;
using SmsBackend.Data;
using SmsBackend.Domain.Boletas;

namespace SmsBackend.Domain.Reportes;

public sealed record ReporteDiarioDto(DateOnly Fecha, int CantidadBoletas, decimal PesoNetoTotal);

public static class ReporteDiarioEndpoints
{
    public static RouteGroupBuilder MapReporteDiario(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/reportes").WithTags("Reportes");

        group.MapGet("/diario", async (
            Guid tipoMovimientoId,
            DateOnly desde,
            DateOnly hasta,
            SmsDbContext db,
            CancellationToken ct) =>
        {
            if (tipoMovimientoId == Guid.Empty)
            {
                return Results.BadRequest("tipoMovimientoId es requerido.");
            }

            if (desde > hasta)
            {
                return Results.BadRequest("desde no puede ser posterior a hasta.");
            }

            var inicio = desde.ToDateTime(TimeOnly.MinValue);
            var fin = hasta.ToDateTime(TimeOnly.MaxValue);

            var filas = await db.Boletas
                .AsNoTracking()
                .Where(b =>
                    b.TipoMovimientoId == tipoMovimientoId
                    && b.Estado == EstadoBoleta.Cerrada
                    && b.FechaHoraSalida != null
                    && b.FechaHoraSalida >= inicio
                    && b.FechaHoraSalida <= fin)
                .GroupBy(b => b.FechaHoraSalida!.Value.Date)
                .Select(g => new
                {
                    Fecha = g.Key,
                    CantidadBoletas = g.Count(),
                    PesoNetoTotal = g.Sum(b => b.PesoNeto ?? 0m),
                })
                .OrderBy(f => f.Fecha)
                .ToListAsync(ct);

            return Results.Ok(filas.Select(f => new ReporteDiarioDto(
                DateOnly.FromDateTime(f.Fecha), f.CantidadBoletas, f.PesoNetoTotal)));
        });

        return group;
    }
}
