using Microsoft.EntityFrameworkCore;
using SmsBackend.Domain.Configuracion;
using SmsBackend.Domain.Maestros;

namespace SmsBackend.Data.Seeding;

/// <summary>
/// Siembra las 8 secciones estándar (design D4). Idempotente: inserta si falta,
/// NUNCA actualiza una fila existente — así respeta las ediciones que un admin
/// haya hecho a <c>Nombre</c>/<c>Orden</c>. Corre una vez al arrancar, después de
/// <c>MigrateAsync()</c>. Ante cualquier falla loguea y sigue, no tira la app.
///
/// El set de claves de sección + claves de campo reservadas se valida contra
/// <see cref="SeccionEstandar"/> (la misma tabla que lee el <c>GuardiaEstandar</c>)
/// al arrancar, para que el guardia y el seed no puedan divergir.
/// </summary>
public static class ConfiguracionSeeder
{
    private sealed record CampoDef(
        string Clave,
        string Etiqueta,
        TipoCampo TipoCampo,
        TipoCatalogo? TipoCatalogoRef,
        bool Requerido);

    private sealed record SeccionDef(
        string Clave,
        string Nombre,
        Cardinalidad Cardinalidad,
        bool Reportable,
        IReadOnlyList<CampoDef> Campos);

    /// <summary>
    /// Metadatos completos de las 8 secciones estándar, EXACTOS según la spec
    /// (tablas de campos por sección). <see cref="SeccionEstandar"/> solo guarda
    /// las claves; la forma completa (etiqueta/tipo/catálogo/requerido) vive acá
    /// y se asegura contra esa tabla en <see cref="CoincideConSeccionEstandar"/>.
    /// </summary>
    private static readonly IReadOnlyList<SeccionDef> Estandar = new[]
    {
        new SeccionDef("transporte", "Transporte", Cardinalidad.Unica, Reportable: true, new CampoDef[]
        {
            new("transportista", "Transportista", TipoCampo.ReferenciaMaestro, TipoCatalogo.Transportista, Requerido: true),
            new("piloto", "Piloto", TipoCampo.ReferenciaMaestro, TipoCatalogo.Piloto, Requerido: true),
            new("equipo", "Equipo / unidad", TipoCampo.ReferenciaMaestro, TipoCatalogo.Equipo, Requerido: true),
            new("placa", "Placa de la unidad", TipoCampo.Texto, null, Requerido: true),
            new("licencia", "Licencia del piloto", TipoCampo.Texto, null, Requerido: false),
        }),
        new SeccionDef("producto", "Producto", Cardinalidad.Unica, Reportable: true, new CampoDef[]
        {
            new("articulo_ax", "Artículo AX", TipoCampo.ReferenciaMaestro, TipoCatalogo.Producto, Requerido: true),
            new("cantidad", "Cantidad", TipoCampo.Decimal, null, Requerido: false),
            new("tercero", "Tercero (proveedor/cliente)", TipoCampo.ReferenciaMaestro, TipoCatalogo.Tercero, Requerido: true),
        }),
        new SeccionDef("ubicacion", "Ubicación", Cardinalidad.Unica, Reportable: true, new CampoDef[]
        {
            new("almacen_origen", "Almacén origen", TipoCampo.ReferenciaMaestro, TipoCatalogo.Almacen, Requerido: false),
            new("almacen_destino", "Almacén destino", TipoCampo.ReferenciaMaestro, TipoCatalogo.Almacen, Requerido: false),
            new("sitio_origen", "Sitio origen", TipoCampo.ReferenciaMaestro, TipoCatalogo.Centro, Requerido: false),
            new("sitio_destino", "Sitio destino", TipoCampo.ReferenciaMaestro, TipoCatalogo.Centro, Requerido: false),
            new("bodega_externa", "Bodega externa", TipoCampo.Texto, null, Requerido: false),
        }),
        new SeccionDef("calidad", "Calidad", Cardinalidad.Unica, Reportable: true, new CampoDef[]
        {
            new("acidez", "Acidez (%)", TipoCampo.Decimal, null, Requerido: false),
            new("luz", "Luz", TipoCampo.Decimal, null, Requerido: false),
            new("temperatura", "Temperatura (°C)", TipoCampo.Decimal, null, Requerido: false),
            new("dobi", "DOBI", TipoCampo.Decimal, null, Requerido: false),
            new("humedad", "Humedad (%)", TipoCampo.Decimal, null, Requerido: false),
            new("revision_qa", "Número de revisión QA", TipoCampo.Texto, null, Requerido: false),
        }),
        new SeccionDef("detalle_fruta", "Detalle de fruta", Cardinalidad.Repetible, Reportable: true, new CampoDef[]
        {
            new("finca", "Finca", TipoCampo.ReferenciaMaestro, TipoCatalogo.Finca, Requerido: true),
            new("lote", "Lote", TipoCampo.Texto, null, Requerido: false),
            new("numero_envio", "Número de envío", TipoCampo.Texto, null, Requerido: false),
            new("caporal", "Caporal", TipoCampo.Texto, null, Requerido: false),
            new("racimos_verdes", "Racimos verdes", TipoCampo.Entero, null, Requerido: false),
            new("racimos_maduros", "Racimos maduros", TipoCampo.Entero, null, Requerido: false),
            new("racimos_sobremaduros", "Racimos sobremaduros", TipoCampo.Entero, null, Requerido: false),
            new("racimos_pasados", "Racimos pasados", TipoCampo.Entero, null, Requerido: false),
            new("racimos_pedunculo_largo", "Racimos con pedúnculo largo", TipoCampo.Entero, null, Requerido: false),
            new("sacos", "Sacos", TipoCampo.Entero, null, Requerido: false),
            new("libras", "Libras", TipoCampo.Decimal, null, Requerido: false),
            new("jornales", "Jornales", TipoCampo.Decimal, null, Requerido: false),
            new("hectareas", "Hectáreas", TipoCampo.Decimal, null, Requerido: false),
            new("fecha_corte", "Fecha de corte", TipoCampo.Fecha, null, Requerido: false),
        }),
        new SeccionDef("marchamos", "Marchamos", Cardinalidad.Repetible, Reportable: true, new CampoDef[]
        {
            new("numero", "Número de marchamo", TipoCampo.Texto, null, Requerido: true),
            new("placa", "Placa", TipoCampo.Texto, null, Requerido: false),
            new("equipo", "Equipo", TipoCampo.ReferenciaMaestro, TipoCatalogo.Equipo, Requerido: false),
            new("activo", "Activo", TipoCampo.Booleano, null, Requerido: false),
            new("observaciones", "Observaciones", TipoCampo.Texto, null, Requerido: false),
        }),
        new SeccionDef("caracteristicas", "Características", Cardinalidad.Repetible, Reportable: false, new CampoDef[]
        {
            new("clave", "Característica", TipoCampo.Texto, null, Requerido: true),
            new("valor", "Valor", TipoCampo.Texto, null, Requerido: false),
            new("tipo_dato", "Tipo de dato", TipoCampo.Texto, null, Requerido: false),
        }),
        new SeccionDef("compostera", "Compostera", Cardinalidad.Unica, Reportable: true, new CampoDef[]
        {
            new("cui", "CUI", TipoCampo.Texto, null, Requerido: true),
            new("cama", "Cama", TipoCampo.ReferenciaMaestro, TipoCatalogo.Cama, Requerido: false),
            new("seccion", "Sección compostera", TipoCampo.ReferenciaMaestro, TipoCatalogo.SeccionCompostera, Requerido: false),
            new("ciclo", "Ciclo compostera", TipoCampo.ReferenciaMaestro, TipoCatalogo.CicloCompostera, Requerido: false),
            new("numero_viaje", "Número de viaje", TipoCampo.Texto, null, Requerido: false),
        }),
    };

    public static async Task SeedAsync(SmsDbContext db, ILogger logger, CancellationToken ct = default)
    {
        try
        {
            if (!await db.Database.CanConnectAsync(ct))
            {
                logger.LogWarning("ConfiguracionSeeder: sin conexión a la base; se omite el seeding.");
                return;
            }

            if ((await db.Database.GetPendingMigrationsAsync(ct)).Any())
            {
                logger.LogWarning("ConfiguracionSeeder: hay migraciones pendientes; se omite el seeding.");
                return;
            }

            if (!CoincideConSeccionEstandar(logger))
            {
                logger.LogError(
                    "ConfiguracionSeeder: abortado — la definición del seed no coincide con SeccionEstandar.");
                return;
            }

            var ahora = DateTime.UtcNow;
            int seccionesCreadas = 0, seccionesPresentes = 0, camposCreados = 0;

            for (var i = 0; i < Estandar.Count; i++)
            {
                var def = Estandar[i];

                var seccion = await db.Secciones.FirstOrDefaultAsync(s => s.Clave == def.Clave, ct);
                if (seccion is null)
                {
                    seccion = new Seccion
                    {
                        Id = Guid.NewGuid(),
                        Clave = def.Clave,
                        Nombre = def.Nombre,
                        Cardinalidad = def.Cardinalidad,
                        Reportable = def.Reportable,
                        Estandar = true,
                        Orden = i + 1,
                        Activa = true,
                    };
                    db.Secciones.Add(seccion);
                    seccionesCreadas++;
                    logger.LogInformation("ConfiguracionSeeder: creando sección estándar '{Clave}'.", def.Clave);
                }
                else
                {
                    seccionesPresentes++;
                    logger.LogInformation(
                        "ConfiguracionSeeder: sección '{Clave}' ya presente, se omite (no se actualiza).",
                        def.Clave);
                }

                var clavesExistentes = (await db.Campos
                        .Where(c => c.SeccionId == seccion.Id)
                        .Select(c => c.Clave)
                        .ToListAsync(ct))
                    .ToHashSet();

                for (var j = 0; j < def.Campos.Count; j++)
                {
                    var campoDef = def.Campos[j];
                    if (clavesExistentes.Contains(campoDef.Clave))
                    {
                        continue;
                    }

                    db.Campos.Add(new Campo
                    {
                        Id = Guid.NewGuid(),
                        SeccionId = seccion.Id,
                        Clave = campoDef.Clave,
                        Etiqueta = campoDef.Etiqueta,
                        TipoCampo = campoDef.TipoCampo,
                        TipoCatalogoRef = campoDef.TipoCatalogoRef,
                        Requerido = campoDef.Requerido,
                        Configuracion = null,
                        Orden = j + 1,
                        VigenteDesde = ahora,
                        VigenteHasta = null,
                    });
                    camposCreados++;
                }
            }

            if (seccionesCreadas > 0 || camposCreados > 0)
            {
                await db.SaveChangesAsync(ct);
            }

            logger.LogInformation(
                "ConfiguracionSeeder: {Creadas} secciones creadas, {Presentes} ya presentes, "
                + "{Campos} campos creados. Total esperado: {Total} secciones estándar.",
                seccionesCreadas, seccionesPresentes, camposCreados, Estandar.Count);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "ConfiguracionSeeder: el seeding falló; se omite y el arranque continúa.");
        }
    }

    /// <summary>
    /// Verifica que el set de claves de sección y de campo de este seed sea
    /// EXACTAMENTE el de <see cref="SeccionEstandar"/>. Si difieren, el guardia y
    /// el seed estarían desincronizados — se aborta el seeding y se loguea.
    /// </summary>
    private static bool CoincideConSeccionEstandar(ILogger logger)
    {
        var esperado = SeccionEstandar.ClavesReservadas;

        var clavesSeeder = Estandar.Select(s => s.Clave).OrderBy(c => c, StringComparer.Ordinal).ToList();
        var clavesEsperadas = esperado.Keys.OrderBy(c => c, StringComparer.Ordinal).ToList();

        if (!clavesSeeder.SequenceEqual(clavesEsperadas))
        {
            logger.LogError(
                "ConfiguracionSeeder: secciones del seed [{Seeder}] != SeccionEstandar [{Esperado}].",
                string.Join(", ", clavesSeeder), string.Join(", ", clavesEsperadas));
            return false;
        }

        foreach (var def in Estandar)
        {
            var camposSeeder = def.Campos.Select(c => c.Clave).OrderBy(c => c, StringComparer.Ordinal).ToList();
            var camposEsperados = esperado[def.Clave].OrderBy(c => c, StringComparer.Ordinal).ToList();

            if (!camposSeeder.SequenceEqual(camposEsperados))
            {
                logger.LogError(
                    "ConfiguracionSeeder: campos de '{Clave}' del seed [{Seeder}] != SeccionEstandar [{Esperado}].",
                    def.Clave, string.Join(", ", camposSeeder), string.Join(", ", camposEsperados));
                return false;
            }
        }

        return true;
    }
}
