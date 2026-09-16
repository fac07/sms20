using SmsBackend.Domain.Seguridad;

namespace SmsBackend.Domain.Centros;

/// <summary>
/// Config de rutas de transferencia por Centro (planta física), espejo del
/// <c>NAT_BSC_Configuraciones</c> del legacy (clsConfiguracionCentro.cs:1421):
/// defaults de Sitio/Almacén que las pantallas de traspaso precargaban para
/// ahorrar tipeo y errores de digitación. En SMS 2.0 esos campos ya son la
/// sección EAV <c>ubicacion</c> de la Boleta — esta entidad guarda SOLO el
/// default por defecto de precarga, no reemplaza la captura.
///
/// <para>1:1 con la fila <c>Maestro</c> de <c>TipoCatalogo=Centro</c>:
/// <see cref="CentroId"/> es PK y FK lógica a la vez — sin FK real en SQL
/// Server ni navigation property, misma convención que
/// <c>Bascula.CentroId</c> y los vínculos de transporte. Las cuatro columnas
/// de default son FKs lógicas a Maestro con el TipoCatalogo que exige el
/// seeder de <c>ubicacion</c> (ConfiguracionSeeder.cs:60-65):
/// sitio_*→Centro, almacen_*→Almacen. Nulas = sin default para ese rol.</para>
///
/// <para>Sin historial ni versionado: es config administrativa (la administra
/// el staff central, hoy por API). El legado tenía además variantes
/// "BE" (<c>Sitio_Destino_Envios_BE</c>, <c>Almacen_Origen_Recepcion_BE</c>)
/// que <c>ubicacion</c> no modela todavía — quedan fuera a propósito.</para>
/// </summary>
public class ConfiguracionCentro : ICentroScoped
{
    /// <summary>PK = FK lógica hacia Maestro (TipoCatalogo = Centro).</summary>
    public Guid CentroId { get; set; }

    /// <summary>Default para <c>ubicacion.sitio_origen</c> (FK lógica a Maestro/Centro).</summary>
    public Guid? SitioOrigenDefaultId { get; set; }

    /// <summary>Default para <c>ubicacion.sitio_destino</c> (FK lógica a Maestro/Centro).</summary>
    public Guid? SitioDestinoDefaultId { get; set; }

    /// <summary>Default para <c>ubicacion.almacen_origen</c> (FK lógica a Maestro/Almacen).</summary>
    public Guid? AlmacenOrigenDefaultId { get; set; }

    /// <summary>Default para <c>ubicacion.almacen_destino</c> (FK lógica a Maestro/Almacen).</summary>
    public Guid? AlmacenDestinoDefaultId { get; set; }
}
