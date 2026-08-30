using Microsoft.EntityFrameworkCore;
using SmsBackend.Data;

namespace SmsBackend.Domain.TiposMovimiento;

public static class TipoMovimientoEndpoints
{
    public static RouteGroupBuilder MapTiposMovimiento(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/tipos-movimiento").WithTags("TiposMovimiento");

        group.MapGet("/", async (SmsDbContext db, bool incluirInactivos = false) =>
        {
            var query = db.TiposMovimiento.AsNoTracking();
            if (!incluirInactivos)
            {
                query = query.Where(t => t.Activo);
            }

            var tipos = await query
                .OrderBy(t => t.Nombre)
                .Select(t => TipoMovimientoDto.FromEntity(t))
                .ToListAsync();

            return Results.Ok(tipos);
        });

        group.MapGet("/{id:guid}", async (Guid id, SmsDbContext db) =>
        {
            var tipo = await db.TiposMovimiento.AsNoTracking()
                .FirstOrDefaultAsync(t => t.Id == id);

            return tipo is null
                ? Results.NotFound()
                : Results.Ok(TipoMovimientoDto.FromEntity(tipo));
        });

        group.MapPost("/", async (GuardarTipoMovimientoRequest request, SmsDbContext db) =>
        {
            if (await db.TiposMovimiento.AnyAsync(t => t.Codigo == request.Codigo))
            {
                return Results.Conflict($"Ya existe un TipoMovimiento con Codigo '{request.Codigo}'.");
            }

            var tipo = new TipoMovimiento
            {
                Id = Guid.NewGuid(),
                Codigo = request.Codigo,
                Nombre = request.Nombre,
                Direccion = request.Direccion,
                HabilitaCalidad = request.HabilitaCalidad,
                HabilitaMarchamos = request.HabilitaMarchamos,
                HabilitaQR = request.HabilitaQR,
                HabilitaDatosFinca = request.HabilitaDatosFinca,
                HabilitaDetalleFruta = request.HabilitaDetalleFruta,
                HabilitaCompostera = request.HabilitaCompostera,
                IntegracionD365 = request.IntegracionD365,
                FormatoBoletaId = request.FormatoBoletaId,
                Activo = true,
            };

            db.TiposMovimiento.Add(tipo);
            await db.SaveChangesAsync();

            return Results.Created($"/api/tipos-movimiento/{tipo.Id}", TipoMovimientoDto.FromEntity(tipo));
        });

        group.MapPut("/{id:guid}", async (Guid id, GuardarTipoMovimientoRequest request, SmsDbContext db) =>
        {
            var tipo = await db.TiposMovimiento.FirstOrDefaultAsync(t => t.Id == id);
            if (tipo is null)
            {
                return Results.NotFound();
            }

            var codigoEnUso = await db.TiposMovimiento
                .AnyAsync(t => t.Codigo == request.Codigo && t.Id != id);
            if (codigoEnUso)
            {
                return Results.Conflict($"Ya existe otro TipoMovimiento con Codigo '{request.Codigo}'.");
            }

            tipo.Codigo = request.Codigo;
            tipo.Nombre = request.Nombre;
            tipo.Direccion = request.Direccion;
            tipo.HabilitaCalidad = request.HabilitaCalidad;
            tipo.HabilitaMarchamos = request.HabilitaMarchamos;
            tipo.HabilitaQR = request.HabilitaQR;
            tipo.HabilitaDatosFinca = request.HabilitaDatosFinca;
            tipo.HabilitaDetalleFruta = request.HabilitaDetalleFruta;
            tipo.HabilitaCompostera = request.HabilitaCompostera;
            tipo.IntegracionD365 = request.IntegracionD365;
            tipo.FormatoBoletaId = request.FormatoBoletaId;

            await db.SaveChangesAsync();

            return Results.Ok(TipoMovimientoDto.FromEntity(tipo));
        });

        // Soft-delete — igual criterio que el resto del esquema (BoletaMarchamo.Activo,
        // Maestro.Activo): un TipoMovimiento nunca se borra, se desactiva. Boletas
        // ya creadas contra un tipo desactivado siguen siendo válidas.
        group.MapDelete("/{id:guid}", async (Guid id, SmsDbContext db) =>
        {
            var tipo = await db.TiposMovimiento.FirstOrDefaultAsync(t => t.Id == id);
            if (tipo is null)
            {
                return Results.NotFound();
            }

            tipo.Activo = false;
            await db.SaveChangesAsync();

            return Results.NoContent();
        });

        return group;
    }
}
