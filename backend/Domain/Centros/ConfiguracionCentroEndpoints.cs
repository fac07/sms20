using Microsoft.EntityFrameworkCore;
using SmsBackend.Data;
using SmsBackend.Domain.Maestros;
using SmsBackend.Domain.Seguridad;

namespace SmsBackend.Domain.Centros;

public static class ConfiguracionCentroEndpoints
{
    public static RouteGroupBuilder MapCentros(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/centros").WithTags("Centros");

        // Configuración de transferencia del centro — GET lectura total,
        // siempre 200 para un centro válido (sin fila = nulls, ver DTO). La
        // terminal la baja en cada ciclo de config-sync para precargar
        // ubicacion en el formulario de pesaje.
        //
        // Sin gate de rol + IgnoreQueryFilters (corrección post-PR3/PR2):
        // config-sync.ts pega este GET sin Authorization header (identidad de
        // terminal, no de usuario humano — grep confirmado: 0 hits de
        // "Authorization" en frontend/electron). Con el gate de PR2, esto
        // devolvía 401 liso; incluso sacando el gate, el HasQueryFilter de
        // Centro (PR3, ConfiguracionCentro es ICentroScoped) filtraría la
        // fila a cero para un caller sin claims — no un 404 visible, sino un
        // 200 con defaults nulos aunque el centro sí tenga configuración
        // real, perdiendo la precarga en silencio. Mismo tratamiento
        // completo que ping/aprovisionar/basculas-{id} en PR3/PR5.
        group.MapGet("/{centroId:guid}/configuracion", async (Guid centroId, SmsDbContext db) =>
        {
            var esCentro = await db.Maestros.AsNoTracking().AnyAsync(m =>
                m.Id == centroId && m.TipoCatalogo == TipoCatalogo.Centro && m.Activo);
            if (!esCentro) return Results.NotFound();

            var config = await db.ConfiguracionesCentro.IgnoreQueryFilters().AsNoTracking()
                .FirstOrDefaultAsync(c => c.CentroId == centroId);

            return Results.Ok(ToDto(centroId, config));
        });

        // Upsert declarativo total — campo nulo limpia el default del rol.
        // Validación réplica de BasculaEndpoints.ValidarRequest: maestro
        // ACTIVO y del TipoCatalogo que espera el seeder de ubicacion
        // (sitio_*→Centro, almacen_*→Almacen), 400 con mensaje accionable.
        group.MapPut("/{centroId:guid}/configuracion", async (
            Guid centroId, GuardarConfiguracionCentroRequest request, SmsDbContext db) =>
        {
            var esCentro = await db.Maestros.AnyAsync(m =>
                m.Id == centroId && m.TipoCatalogo == TipoCatalogo.Centro && m.Activo);
            if (!esCentro)
            {
                return Results.BadRequest($"No existe el centro {centroId}, o está inactivo.");
            }

            foreach (var (rol, esperado, maestroId) in Defaults(request))
            {
                if (maestroId is not { } id) continue;
                // Guid.Empty llega como un "no elegido" del cliente — tratar
                // como null (limpia) en vez de un 400 que no se puede
                // distinguir de un valor real.
                if (id == Guid.Empty) continue;

                var ok = await db.Maestros.AsNoTracking().AnyAsync(m =>
                    m.Id == id && m.Activo && m.TipoCatalogo == esperado);
                if (!ok)
                {
                    return Results.BadRequest(
                        $"El default '{rol}' requiere un maestro activo de "
                        + $"TipoCatalogo={esperado} — {id} no lo es.");
                }
            }

            var config = await db.ConfiguracionesCentro
                .FirstOrDefaultAsync(c => c.CentroId == centroId);
            if (config is null)
            {
                config = new ConfiguracionCentro { CentroId = centroId };
                db.ConfiguracionesCentro.Add(config);
            }

            config.SitioOrigenDefaultId = Normalizar(request.SitioOrigenDefaultId);
            config.SitioDestinoDefaultId = Normalizar(request.SitioDestinoDefaultId);
            config.AlmacenOrigenDefaultId = Normalizar(request.AlmacenOrigenDefaultId);
            config.AlmacenDestinoDefaultId = Normalizar(request.AlmacenDestinoDefaultId);

            await db.SaveChangesAsync();

            return Results.Ok(ToDto(centroId, config));
        })
        .RequireAuthorization(Politicas.Administrador);

        return group;
    }

    /// <summary>Rol, catálogo esperado y valor pedido — los cuatro defaults en orden.</summary>
    private static IEnumerable<(string Rol, TipoCatalogo Esperado, Guid? Valor)> Defaults(
        GuardarConfiguracionCentroRequest request) =>
    [
        ("sitio_origen", TipoCatalogo.Centro, request.SitioOrigenDefaultId),
        ("sitio_destino", TipoCatalogo.Centro, request.SitioDestinoDefaultId),
        ("almacen_origen", TipoCatalogo.Almacen, request.AlmacenOrigenDefaultId),
        ("almacen_destino", TipoCatalogo.Almacen, request.AlmacenDestinoDefaultId),
    ];

    private static Guid? Normalizar(Guid? id) => id == Guid.Empty ? null : id;

    private static ConfiguracionCentroDto ToDto(Guid centroId, ConfiguracionCentro? config) =>
        new(
            centroId,
            config?.SitioOrigenDefaultId,
            config?.SitioDestinoDefaultId,
            config?.AlmacenOrigenDefaultId,
            config?.AlmacenDestinoDefaultId);
}
