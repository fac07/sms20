using Microsoft.EntityFrameworkCore;
using SmsBackend.Data;
using SmsBackend.Domain.Seguridad;

namespace SmsBackend.Domain.Transporte;

public static class VinculoPilotoTransportistaEndpoints
{
    public static RouteGroupBuilder MapVinculosPilotoTransportista(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/vinculos-piloto-transportista").WithTags("VinculosPilotoTransportista");

        // Listado admin Y delta-sync del terminal en un solo endpoint — mismo
        // criterio D3/MaestroEndpoints.cs:50-66 y PreIngresoEndpoints.cs:39-42:
        //   - ?transportistaId= siempre scopea (el selector offline filtra por
        //     el transportista elegido).
        //   - ?modificadoDesde= activa el modo delta: predicado estrictamente
        //     mayor al watermark, e INCLUYE inactivos siempre — un vínculo
        //     que se desactivó después del watermark tiene que llegar igual a
        //     cada báscula, o el combo local lo seguiría ofreciendo para
        //     siempre.
        // Sync central→terminal: la báscula todavía no tiene identidad humana.
        group.MapGet("/", async (
            SmsDbContext db,
            Guid? transportistaId = null,
            DateTime? modificadoDesde = null) =>
        {
            var query = db.VinculosPilotoTransportista.AsNoTracking();

            if (transportistaId is not null)
            {
                query = query.Where(v => v.TransportistaId == transportistaId);
            }

            if (modificadoDesde is not null)
            {
                query = query.Where(v => v.FechaModificacion > modificadoDesde);
            }
            else
            {
                query = query.Where(v => v.Activo);
            }

            var vinculos = await query
                .OrderBy(v => v.FechaModificacion)
                .Select(v => VinculoPilotoTransportistaDto.FromEntity(v))
                .ToListAsync();

            return Results.Ok(vinculos);
        });

        group.MapGet("/{id:guid}", async (Guid id, SmsDbContext db) =>
        {
            var vinculo = await db.VinculosPilotoTransportista.AsNoTracking().FirstOrDefaultAsync(v => v.Id == id);
            return vinculo is null
                ? Results.NotFound()
                : Results.Ok(VinculoPilotoTransportistaDto.FromEntity(vinculo));
        }).RequireAuthorization(Politicas.Operador);

        // Alta — 409 si ya existe una fila para el par (PilotoId,
        // TransportistaId), sin importar su Activo: el par nunca tiene dos
        // filas. Reactivar un par desactivado es la acción explícita
        // /reactivar, nunca un upsert implícito acá.
        group.MapPost("/", async (CrearVinculoPilotoTransportistaRequest request, SmsDbContext db) =>
        {
            if (request.PilotoId == Guid.Empty || request.TransportistaId == Guid.Empty)
            {
                return Results.BadRequest("PilotoId y TransportistaId son obligatorios.");
            }

            var existe = await db.VinculosPilotoTransportista.AnyAsync(v =>
                v.PilotoId == request.PilotoId && v.TransportistaId == request.TransportistaId);
            if (existe)
            {
                return Results.Conflict(
                    $"Ya existe un vínculo entre el piloto {request.PilotoId} y el transportista {request.TransportistaId}.");
            }

            var vinculo = new VinculoPilotoTransportista
            {
                Id = Guid.NewGuid(),
                PilotoId = request.PilotoId,
                TransportistaId = request.TransportistaId,
                Activo = true,
                UsuarioCreacion = request.UsuarioCreacion,
                FechaCreacion = DateTime.UtcNow,
                // FechaModificacion la sella SmsDbContext.SaveChanges (IFechaModificable).
            };

            db.VinculosPilotoTransportista.Add(vinculo);
            await db.SaveChangesAsync();

            return Results.Created(
                $"/api/vinculos-piloto-transportista/{vinculo.Id}",
                VinculoPilotoTransportistaDto.FromEntity(vinculo));
        }).RequireAuthorization(Politicas.Administrador);

        // Soft-delete — nunca se borra en duro, misma convención que
        // Maestro/PreIngreso (auditoría de vínculos pasados).
        group.MapPost("/{id:guid}/desactivar", async (Guid id, SmsDbContext db) =>
        {
            var vinculo = await db.VinculosPilotoTransportista.FirstOrDefaultAsync(v => v.Id == id);
            if (vinculo is null)
            {
                return Results.NotFound();
            }

            vinculo.Activo = false;
            await db.SaveChangesAsync();

            return Results.Ok(VinculoPilotoTransportistaDto.FromEntity(vinculo));
        }).RequireAuthorization(Politicas.Administrador);

        // Reactivar un par previamente desactivado — acción explícita y
        // separada del alta (que siempre 409 si la fila del par ya existe,
        // esté activa o no).
        group.MapPost("/{id:guid}/reactivar", async (Guid id, SmsDbContext db) =>
        {
            var vinculo = await db.VinculosPilotoTransportista.FirstOrDefaultAsync(v => v.Id == id);
            if (vinculo is null)
            {
                return Results.NotFound();
            }

            vinculo.Activo = true;
            await db.SaveChangesAsync();

            return Results.Ok(VinculoPilotoTransportistaDto.FromEntity(vinculo));
        }).RequireAuthorization(Politicas.Administrador);

        return group;
    }
}
