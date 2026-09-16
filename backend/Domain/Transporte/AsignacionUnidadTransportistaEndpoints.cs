using Microsoft.EntityFrameworkCore;
using SmsBackend.Data;
using SmsBackend.Domain.Seguridad;

namespace SmsBackend.Domain.Transporte;

public static class AsignacionUnidadTransportistaEndpoints
{
    public static RouteGroupBuilder MapAsignacionesUnidadTransportista(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/transporte/unidades/{unidadId:guid}/asignaciones")
            .WithTags("AsignacionesUnidadTransportista");

        // Reasignar (design D4): cierra la fila abierta de esta unidad (si
        // existe) y crea la nueva fila abierta, en UN solo SaveChanges. Sin
        // fila abierta previa (unidad nueva) simplemente inserta — no hay
        // nada que cerrar. Ambas filas comparten el mismo instante
        // (VigenteHasta de la vieja == VigenteDesde de la nueva), igual que
        // el versionado de Campo (CampoEndpoints.cs:176).
        group.MapPost("/", async (Guid unidadId, CrearAsignacionUnidadTransportistaRequest request, SmsDbContext db) =>
        {
            if (request.TransportistaId == Guid.Empty)
            {
                return Results.BadRequest("TransportistaId es obligatorio.");
            }

            if (string.IsNullOrWhiteSpace(request.UsuarioAsigna))
            {
                return Results.BadRequest("UsuarioAsigna es obligatorio.");
            }

            var abierta = await db.Set<AsignacionUnidadTransportista>()
                .FirstOrDefaultAsync(a => a.UnidadId == unidadId && a.VigenteHasta == null);

            var ahora = DateTime.UtcNow;

            if (abierta is not null)
            {
                abierta.VigenteHasta = ahora;
            }

            var nueva = new AsignacionUnidadTransportista
            {
                Id = Guid.NewGuid(),
                UnidadId = unidadId,
                TransportistaId = request.TransportistaId,
                VigenteDesde = ahora,
                VigenteHasta = null,
                UsuarioAsigna = request.UsuarioAsigna,
                MotivoCambio = request.MotivoCambio,
            };

            db.Set<AsignacionUnidadTransportista>().Add(nueva);
            await db.SaveChangesAsync();

            return Results.Created(
                $"/api/transporte/unidades/{unidadId}/asignaciones/{nueva.Id}",
                AsignacionUnidadTransportistaDto.FromEntity(nueva));
        }).RequireAuthorization(Politicas.Administrador);

        // Historial completo de la unidad, más reciente primero. La primera
        // fila (VigenteHasta == null, si existe) es el transportista actual
        // (G6) — no hay un endpoint separado para "el actual" porque
        // duplicaría esta misma consulta.
        group.MapGet("/", async (Guid unidadId, SmsDbContext db) =>
        {
            var historial = await db.Set<AsignacionUnidadTransportista>()
                .AsNoTracking()
                .Where(a => a.UnidadId == unidadId)
                .OrderByDescending(a => a.VigenteDesde)
                .Select(a => AsignacionUnidadTransportistaDto.FromEntity(a))
                .ToListAsync();

            return Results.Ok(historial);
        }).RequireAuthorization(Politicas.Operador);

        // Deliberadamente sin PUT ni DELETE (design D4): ninguna fila de esta
        // tabla se reescribe ni se borra jamás. La única escritura
        // post-inserción es sellar VigenteHasta arriba, en el propio POST.

        return group;
    }
}
