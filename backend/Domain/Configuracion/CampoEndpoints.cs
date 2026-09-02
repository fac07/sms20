using Microsoft.EntityFrameworkCore;
using SmsBackend.Data;

namespace SmsBackend.Domain.Configuracion;

public static class CampoEndpoints
{
    public static RouteGroupBuilder MapCampos(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/campos").WithTags("Campos");

        group.MapGet("/", async (SmsDbContext db, Guid? seccionId = null, bool incluirHistoricos = false) =>
        {
            var query = db.Campos.AsNoTracking();

            if (seccionId is not null)
            {
                query = query.Where(c => c.SeccionId == seccionId);
            }

            if (!incluirHistoricos)
            {
                query = query.Where(c => c.VigenteHasta == null);
            }

            var campos = await query
                .OrderBy(c => c.SeccionId)
                .ThenBy(c => c.Orden)
                .ThenBy(c => c.Clave)
                .Select(c => CampoDto.FromEntity(c))
                .ToListAsync();

            return Results.Ok(campos);
        });

        group.MapGet("/{id:guid}", async (Guid id, SmsDbContext db) =>
        {
            var campo = await db.Campos.AsNoTracking().FirstOrDefaultAsync(c => c.Id == id);
            return campo is null ? Results.NotFound() : Results.Ok(CampoDto.FromEntity(campo));
        });

        group.MapPost("/", async (CrearCampoRequest request, SmsDbContext db) =>
        {
            if (!ClaveConfigurable.EsValida(request.Clave))
            {
                return Results.BadRequest($"Clave inválida: debe ser {ClaveConfigurable.Formato}.");
            }

            var seccion = await db.Secciones.FirstOrDefaultAsync(s => s.Id == request.SeccionId);
            if (seccion is null)
            {
                return Results.BadRequest($"No existe la sección {request.SeccionId}.");
            }

            var bloqueo = GuardiaEstandar.ParaCrearCampo(seccion, request.Clave);
            if (bloqueo is not null)
            {
                return bloqueo;
            }

            var error = ValidacionCampo.Validar(
                request.TipoCampo, request.TipoCatalogoRef, request.Configuracion);
            if (error is not null)
            {
                return Results.BadRequest(error);
            }

            var claveVigenteEnUso = await db.Campos.AnyAsync(c =>
                c.SeccionId == request.SeccionId && c.Clave == request.Clave && c.VigenteHasta == null);
            if (claveVigenteEnUso)
            {
                return Results.Conflict(
                    $"Ya existe un campo vigente con clave '{request.Clave}' en esa sección.");
            }

            var campo = new Campo
            {
                Id = Guid.NewGuid(),
                SeccionId = request.SeccionId,
                Clave = request.Clave,
                Etiqueta = request.Etiqueta,
                TipoCampo = request.TipoCampo,
                TipoCatalogoRef = request.TipoCatalogoRef,
                Requerido = request.Requerido,
                Configuracion = request.Configuracion,
                Orden = request.Orden,
                VigenteDesde = DateTime.UtcNow,
                VigenteHasta = null,
            };

            db.Campos.Add(campo);
            await db.SaveChangesAsync();

            return Results.Created($"/api/campos/{campo.Id}", CampoDto.FromEntity(campo));
        });

        group.MapPut("/{id:guid}", async (Guid id, ActualizarCampoRequest request, SmsDbContext db) =>
        {
            var campo = await db.Campos.FirstOrDefaultAsync(c => c.Id == id);
            if (campo is null)
            {
                return Results.NotFound();
            }

            var seccion = await db.Secciones.FirstAsync(s => s.Id == campo.SeccionId);

            var bloqueo = GuardiaEstandar.ParaActualizarCampo(campo, seccion, request.Requerido);
            if (bloqueo is not null)
            {
                return bloqueo;
            }

            // El tipo no cambia en su lugar: se valida la config contra el tipo existente.
            var error = ValidacionCampo.Validar(
                campo.TipoCampo, campo.TipoCatalogoRef, request.Configuracion);
            if (error is not null)
            {
                return Results.BadRequest(error);
            }

            campo.Etiqueta = request.Etiqueta;
            campo.Requerido = request.Requerido;
            campo.Configuracion = request.Configuracion;
            campo.Orden = request.Orden;

            await db.SaveChangesAsync();

            return Results.Ok(CampoDto.FromEntity(campo));
        });

        // Versionado: nuevo Id, MISMA clave, cierra la versión anterior. Única vía
        // para cambiar TipoCampo / TipoCatalogoRef.
        group.MapPost("/{id:guid}/nueva-version", async (
            Guid id, NuevaVersionCampoRequest request, SmsDbContext db) =>
        {
            var actual = await db.Campos.FirstOrDefaultAsync(c => c.Id == id);
            if (actual is null)
            {
                return Results.NotFound();
            }

            if (actual.VigenteHasta is not null)
            {
                return Results.Conflict(
                    "Ese campo ya no es la versión vigente; versioná la fila abierta de esa clave.");
            }

            var seccion = await db.Secciones.FirstAsync(s => s.Id == actual.SeccionId);

            var bloqueo = GuardiaEstandar.ParaNuevaVersionCampo(actual, seccion);
            if (bloqueo is not null)
            {
                return bloqueo;
            }

            var error = ValidacionCampo.Validar(
                request.TipoCampo, request.TipoCatalogoRef, request.Configuracion);
            if (error is not null)
            {
                return Results.BadRequest(error);
            }

            var ahora = DateTime.UtcNow;
            actual.VigenteHasta = ahora;

            var nueva = new Campo
            {
                Id = Guid.NewGuid(),
                SeccionId = actual.SeccionId,
                Clave = actual.Clave,
                Etiqueta = request.Etiqueta,
                TipoCampo = request.TipoCampo,
                TipoCatalogoRef = request.TipoCatalogoRef,
                Requerido = request.Requerido,
                Configuracion = request.Configuracion,
                Orden = request.Orden,
                VigenteDesde = ahora,
                VigenteHasta = null,
            };

            db.Campos.Add(nueva);
            await db.SaveChangesAsync();

            return Results.Created($"/api/campos/{nueva.Id}", CampoDto.FromEntity(nueva));
        });

        group.MapDelete("/{id:guid}", async (Guid id, SmsDbContext db) =>
        {
            var campo = await db.Campos.FirstOrDefaultAsync(c => c.Id == id);
            if (campo is null)
            {
                return Results.NotFound();
            }

            var seccion = await db.Secciones.FirstAsync(s => s.Id == campo.SeccionId);

            var bloqueo = GuardiaEstandar.ParaEliminarCampo(campo, seccion);
            if (bloqueo is not null)
            {
                return bloqueo;
            }

            if (await db.BoletaValores.AnyAsync(v => v.CampoId == id))
            {
                return Results.Conflict(
                    "El campo ya tiene valores capturados en boletas; cerralo con una versión nueva en vez de borrarlo.");
            }

            db.Campos.Remove(campo);
            await db.SaveChangesAsync();

            return Results.NoContent();
        });

        return group;
    }
}
