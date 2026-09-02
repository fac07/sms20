using Microsoft.EntityFrameworkCore;
using SmsBackend.Data;

namespace SmsBackend.Domain.Configuracion;

public static class SeccionEndpoints
{
    public static RouteGroupBuilder MapSecciones(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/secciones").WithTags("Secciones");

        group.MapGet("/", async (SmsDbContext db, bool incluirInactivas = false) =>
        {
            var query = db.Secciones.AsNoTracking();
            if (!incluirInactivas)
            {
                query = query.Where(s => s.Activa);
            }

            var secciones = await query
                .OrderBy(s => s.Orden)
                .ThenBy(s => s.Clave)
                .Select(s => SeccionDto.FromEntity(s))
                .ToListAsync();

            return Results.Ok(secciones);
        });

        group.MapGet("/{id:guid}", async (Guid id, SmsDbContext db) =>
        {
            var seccion = await db.Secciones.AsNoTracking().FirstOrDefaultAsync(s => s.Id == id);
            return seccion is null ? Results.NotFound() : Results.Ok(SeccionDto.FromEntity(seccion));
        });

        group.MapPost("/", async (CrearSeccionRequest request, SmsDbContext db) =>
        {
            if (!ClaveConfigurable.EsValida(request.Clave))
            {
                return Results.BadRequest($"Clave inválida: debe ser {ClaveConfigurable.Formato}.");
            }

            if (await db.Secciones.AnyAsync(s => s.Clave == request.Clave))
            {
                return Results.Conflict($"Ya existe una sección con clave '{request.Clave}'.");
            }

            var seccion = new Seccion
            {
                Id = Guid.NewGuid(),
                Clave = request.Clave,
                Nombre = request.Nombre,
                Cardinalidad = request.Cardinalidad,
                Reportable = request.Reportable,
                Estandar = false,
                Orden = request.Orden,
                Activa = true,
            };

            db.Secciones.Add(seccion);
            await db.SaveChangesAsync();

            return Results.Created($"/api/secciones/{seccion.Id}", SeccionDto.FromEntity(seccion));
        });

        group.MapPut("/{id:guid}", async (Guid id, ActualizarSeccionRequest request, SmsDbContext db) =>
        {
            var seccion = await db.Secciones.FirstOrDefaultAsync(s => s.Id == id);
            if (seccion is null)
            {
                return Results.NotFound();
            }

            if (!ClaveConfigurable.EsValida(request.Clave))
            {
                return Results.BadRequest($"Clave inválida: debe ser {ClaveConfigurable.Formato}.");
            }

            // El candado estándar corre ANTES de mutar nada.
            var bloqueo = GuardiaEstandar.ParaActualizarSeccion(seccion, request.Clave, request.Activa);
            if (bloqueo is not null)
            {
                return bloqueo;
            }

            var claveEnUso = await db.Secciones
                .AnyAsync(s => s.Clave == request.Clave && s.Id != id);
            if (claveEnUso)
            {
                return Results.Conflict($"Ya existe otra sección con clave '{request.Clave}'.");
            }

            seccion.Clave = request.Clave;
            seccion.Nombre = request.Nombre;
            seccion.Cardinalidad = request.Cardinalidad;
            seccion.Reportable = request.Reportable;
            seccion.Orden = request.Orden;
            seccion.Activa = request.Activa;

            await db.SaveChangesAsync();

            return Results.Ok(SeccionDto.FromEntity(seccion));
        });

        group.MapDelete("/{id:guid}", async (Guid id, SmsDbContext db) =>
        {
            var seccion = await db.Secciones.FirstOrDefaultAsync(s => s.Id == id);
            if (seccion is null)
            {
                return Results.NotFound();
            }

            var bloqueo = GuardiaEstandar.ParaEliminarSeccion(seccion);
            if (bloqueo is not null)
            {
                return bloqueo;
            }

            if (await db.Campos.AnyAsync(c => c.SeccionId == id))
            {
                return Results.Conflict(
                    "La sección tiene campos definidos; primero versioná o quitá esos campos.");
            }

            db.Secciones.Remove(seccion);
            await db.SaveChangesAsync();

            return Results.NoContent();
        });

        return group;
    }
}
