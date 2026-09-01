using Microsoft.EntityFrameworkCore;
using SmsBackend.Data;

namespace SmsBackend.Domain.Maestros;

public static class MaestroEndpoints
{
    public static RouteGroupBuilder MapMaestros(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/maestros").WithTags("Maestros");

        group.MapGet("/", async (
            SmsDbContext db,
            TipoCatalogo? tipoCatalogo = null,
            EstadoMaestro? estado = null,
            bool incluirInactivos = false,
            DateTime? modificadoDesde = null) =>
        {
            var query = db.Maestros.AsNoTracking();

            if (tipoCatalogo is not null)
            {
                query = query.Where(m => m.TipoCatalogo == tipoCatalogo);
            }
            if (estado is not null)
            {
                query = query.Where(m => m.Estado == estado);
            }

            if (modificadoDesde is not null)
            {
                // Delta-sync (ver frontend/electron/maestros-sync.ts): el watermark
                // ya es el último valor visto, así que el filtro es estrictamente
                // mayor — no re-descargamos la fila que marcó el watermark.
                //
                // Acá SIEMPRE se incluyen inactivos, sin importar incluirInactivos:
                // una fila que se desactivó (Activo=false) después del watermark
                // tiene que llegar igual al caché local, o el combo offline la
                // seguiría mostrando para siempre. Una llamada de listado normal
                // (admin) no tiene ese problema — ahí sí importa el filtro.
                query = query.Where(m => m.FechaModificacion > modificadoDesde);
            }
            else if (!incluirInactivos)
            {
                query = query.Where(m => m.Activo);
            }

            var maestros = await query
                .OrderBy(m => m.TipoCatalogo)
                .ThenBy(m => m.Nombre)
                .Select(m => MaestroDto.FromEntity(m))
                .ToListAsync();

            return Results.Ok(maestros);
        });

        group.MapGet("/{id:guid}", async (Guid id, SmsDbContext db) =>
        {
            var maestro = await db.Maestros.AsNoTracking().FirstOrDefaultAsync(m => m.Id == id);
            return maestro is null ? Results.NotFound() : Results.Ok(MaestroDto.FromEntity(maestro));
        });

        // El admin crea directo como Oficial — el flujo de Provisional nace
        // en la báscula offline (todavía no implementado), no acá.
        group.MapPost("/", async (GuardarMaestroRequest request, SmsDbContext db) =>
        {
            var codigoEnUso = await db.Maestros
                .AnyAsync(m => m.TipoCatalogo == request.TipoCatalogo && m.Codigo == request.Codigo);
            if (codigoEnUso)
            {
                return Results.Conflict(
                    $"Ya existe un {request.TipoCatalogo} con Codigo '{request.Codigo}'.");
            }

            var maestro = new Maestro
            {
                Id = Guid.NewGuid(),
                TipoCatalogo = request.TipoCatalogo,
                Codigo = request.Codigo,
                Nombre = request.Nombre,
                DatosAdicionales = request.DatosAdicionales,
                Estado = EstadoMaestro.Oficial,
                FechaModificacion = DateTime.UtcNow,
                Activo = true,
            };

            db.Maestros.Add(maestro);
            await db.SaveChangesAsync();

            return Results.Created($"/api/maestros/{maestro.Id}", MaestroDto.FromEntity(maestro));
        });

        group.MapPut("/{id:guid}", async (Guid id, GuardarMaestroRequest request, SmsDbContext db) =>
        {
            var maestro = await db.Maestros.FirstOrDefaultAsync(m => m.Id == id);
            if (maestro is null)
            {
                return Results.NotFound();
            }

            var codigoEnUso = await db.Maestros.AnyAsync(m =>
                m.TipoCatalogo == request.TipoCatalogo && m.Codigo == request.Codigo && m.Id != id);
            if (codigoEnUso)
            {
                return Results.Conflict(
                    $"Ya existe otro {request.TipoCatalogo} con Codigo '{request.Codigo}'.");
            }

            maestro.TipoCatalogo = request.TipoCatalogo;
            maestro.Codigo = request.Codigo;
            maestro.Nombre = request.Nombre;
            maestro.DatosAdicionales = request.DatosAdicionales;
            maestro.FechaModificacion = DateTime.UtcNow;

            await db.SaveChangesAsync();

            return Results.Ok(MaestroDto.FromEntity(maestro));
        });

        // Soft-delete — mismo criterio que TipoMovimiento: nunca se borra, se desactiva.
        group.MapDelete("/{id:guid}", async (Guid id, SmsDbContext db) =>
        {
            var maestro = await db.Maestros.FirstOrDefaultAsync(m => m.Id == id);
            if (maestro is null)
            {
                return Results.NotFound();
            }

            maestro.Activo = false;
            maestro.FechaModificacion = DateTime.UtcNow;
            await db.SaveChangesAsync();

            return Results.NoContent();
        });

        // Aprobar: un provisional pasa a Oficial sin fusionarse con nada — se
        // distribuye tal cual a las básculas en el próximo sync.
        group.MapPost("/{id:guid}/aprobar", async (Guid id, SmsDbContext db) =>
        {
            var maestro = await db.Maestros.FirstOrDefaultAsync(m => m.Id == id);
            if (maestro is null)
            {
                return Results.NotFound();
            }
            if (maestro.Estado != EstadoMaestro.Provisional)
            {
                return Results.Conflict("Solo se pueden aprobar ítems en estado Provisional.");
            }

            maestro.Estado = EstadoMaestro.Oficial;
            maestro.FechaModificacion = DateTime.UtcNow;
            await db.SaveChangesAsync();

            return Results.Ok(MaestroDto.FromEntity(maestro));
        });

        // Fusionar: el provisional se descarta (Activo=false) y queda
        // apuntando al oficial vía FusionadoConId. La transferencia de
        // referencias de transacciones reales (Boleta.*Id → oficialId) queda
        // pendiente hasta que exista la entidad Boleta — no hay nada que
        // transferir todavía.
        group.MapPost("/{id:guid}/fusionar/{oficialId:guid}", async (Guid id, Guid oficialId, SmsDbContext db) =>
        {
            if (id == oficialId)
            {
                return Results.BadRequest("Un ítem no se puede fusionar consigo mismo.");
            }

            var provisional = await db.Maestros.FirstOrDefaultAsync(m => m.Id == id);
            if (provisional is null)
            {
                return Results.NotFound($"No existe el provisional {id}.");
            }
            if (provisional.Estado != EstadoMaestro.Provisional)
            {
                return Results.Conflict("Solo se pueden fusionar ítems en estado Provisional.");
            }

            var oficial = await db.Maestros.FirstOrDefaultAsync(m => m.Id == oficialId);
            if (oficial is null)
            {
                return Results.NotFound($"No existe el ítem oficial {oficialId}.");
            }
            if (oficial.TipoCatalogo != provisional.TipoCatalogo)
            {
                return Results.Conflict("El provisional y el oficial deben ser del mismo TipoCatalogo.");
            }

            provisional.FusionadoConId = oficial.Id;
            provisional.Activo = false;
            provisional.FechaModificacion = DateTime.UtcNow;
            await db.SaveChangesAsync();

            return Results.Ok(MaestroDto.FromEntity(provisional));
        });

        return group;
    }
}
