using Microsoft.EntityFrameworkCore;
using SmsBackend.Data;
using SmsBackend.Domain.Boletas.Valores;
using SmsBackend.Domain.Configuracion;

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
                Prefijo = request.Prefijo,
                Direccion = request.Direccion,
                OperacionD365 = request.OperacionD365,
                GeneraQR = request.GeneraQR,
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
            tipo.Prefijo = request.Prefijo;
            tipo.Direccion = request.Direccion;
            tipo.OperacionD365 = request.OperacionD365;
            tipo.GeneraQR = request.GeneraQR;
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

        // --- Secciones asignadas al tipo de movimiento -----------------------

        group.MapGet("/{id:guid}/secciones", async (
            Guid id, SmsDbContext db, bool incluirHistoricas = false) =>
        {
            if (!await db.TiposMovimiento.AnyAsync(t => t.Id == id))
            {
                return Results.NotFound();
            }

            var query = db.TipoMovimientoSecciones.AsNoTracking()
                .Where(x => x.TipoMovimientoId == id);
            if (!incluirHistoricas)
            {
                query = query.Where(x => x.VigenteHasta == null);
            }

            var filas = await (
                from x in query
                join s in db.Secciones.AsNoTracking() on x.SeccionId equals s.Id
                orderby x.Orden, s.Clave
                select new TipoMovimientoSeccionDto(
                    x.SeccionId, s.Clave, s.Nombre, x.Requerida, x.Orden, x.VigenteDesde, x.VigenteHasta))
                .ToListAsync();

            return Results.Ok(filas);
        });

        // PUT declarativo del set de secciones. Desasignar = poner VigenteHasta,
        // nunca borrado físico (candado temporal del design D1). Un cambio de
        // Requerida/Orden cierra la fila vigente y abre una nueva versión.
        group.MapPut("/{id:guid}/secciones", async (
            Guid id, AsignacionSeccionRequest[] request, SmsDbContext db) =>
        {
            if (!await db.TiposMovimiento.AnyAsync(t => t.Id == id))
            {
                return Results.NotFound();
            }

            var deseadas = request
                .GroupBy(r => r.SeccionId)
                .ToDictionary(g => g.Key, g => g.Last());

            var seccionIds = deseadas.Keys.ToList();
            var existentes = await db.Secciones
                .Where(s => seccionIds.Contains(s.Id))
                .Select(s => s.Id)
                .ToListAsync();
            var faltantes = seccionIds.Except(existentes).ToList();
            if (faltantes.Count > 0)
            {
                return Results.BadRequest(
                    $"No existen las secciones: {string.Join(", ", faltantes)}.");
            }

            var abiertas = await db.TipoMovimientoSecciones
                .Where(x => x.TipoMovimientoId == id && x.VigenteHasta == null)
                .ToListAsync();

            var ahora = DateTime.UtcNow;

            foreach (var abierta in abiertas.Where(a => !deseadas.ContainsKey(a.SeccionId)))
            {
                abierta.VigenteHasta = ahora;
            }

            foreach (var (seccionId, deseada) in deseadas)
            {
                var abierta = abiertas.FirstOrDefault(a => a.SeccionId == seccionId);
                if (abierta is not null
                    && abierta.Requerida == deseada.Requerida
                    && abierta.Orden == deseada.Orden)
                {
                    continue;
                }

                if (abierta is not null)
                {
                    abierta.VigenteHasta = ahora;
                }

                db.TipoMovimientoSecciones.Add(new TipoMovimientoSeccion
                {
                    TipoMovimientoId = id,
                    SeccionId = seccionId,
                    VigenteDesde = ahora,
                    VigenteHasta = null,
                    Requerida = deseada.Requerida,
                    Orden = deseada.Orden,
                });
            }

            await db.SaveChangesAsync();

            var vigentes = await (
                from x in db.TipoMovimientoSecciones.AsNoTracking()
                where x.TipoMovimientoId == id && x.VigenteHasta == null
                join s in db.Secciones.AsNoTracking() on x.SeccionId equals s.Id
                orderby x.Orden, s.Clave
                select new TipoMovimientoSeccionDto(
                    x.SeccionId, s.Clave, s.Nombre, x.Requerida, x.Orden, x.VigenteDesde, x.VigenteHasta))
                .ToListAsync();

            return Results.Ok(vigentes);
        });

        // Formulario vigente ahora: el conjunto de campos que aplica a una boleta
        // creada en este instante, resuelto por el mismo motor que valida el cierre.
        group.MapGet("/{id:guid}/formulario", async (
            Guid id, MotorCampos motor, SmsDbContext db, CancellationToken ct) =>
        {
            if (!await db.TiposMovimiento.AnyAsync(t => t.Id == id, ct))
            {
                return Results.NotFound();
            }

            var campos = await motor.ResolverCamposAsync(id, DateTime.UtcNow, ct);
            return Results.Ok(campos);
        });

        return group;
    }
}
