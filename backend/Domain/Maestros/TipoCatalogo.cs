namespace SmsBackend.Domain.Maestros;

public enum TipoCatalogo
{
    Piloto,
    Transportista,
    Equipo,
    Producto,
    Tercero,
    Finca,
    Almacen,
    Centro,
    Region,

    /// <summary>
    /// Catálogos nuevos para la sección Compostera de Boleta — confirmar
    /// contra NAT_mas_Cama/NAT_mas_Ciclo_Compostera del legacy antes de
    /// cerrar el nombre definitivo.
    /// </summary>
    Cama,

    /// <summary>Ver comentario de <see cref="Cama"/>.</summary>
    CicloCompostera,

    /// <summary>
    /// Provisorio — no estaba documentado en el diseño original (solo Cama y
    /// CicloCompostera). Pendiente de confirmar la descripción real con el
    /// cliente; si cambia el nombre o la forma, se ajusta acá sin migración
    /// (columna VARCHAR vía HasConversion&lt;string&gt;()).
    /// </summary>
    SeccionCompostera,

    /// <summary>Catálogo de características de equipo — mismo concepto que mas_Caracteristica_Equipo del legacy (Codigo, Nombre, Activo). El operador elige de acá al cargar Características en una boleta, no tipea libre.</summary>
    CaracteristicaEquipo,

    /// <summary>
    /// Vehículo de transporte (camión/unidad) — NO confundir con
    /// <c>ConfiguracionCampo.Unidad</c> (la unidad de medida, ej. "kg"):
    /// mismo nombre, conceptos y namespaces distintos y sin relación.
    /// </summary>
    Unidad,

    /// <summary>Tipo de unidad de transporte (ej. tractomula, camión rígido).</summary>
    TipoUnidad,

    /// <summary>Tipo de equipo (distinto de <see cref="Equipo"/>, que es la instancia).</summary>
    TipoEquipo,

    /// <summary>Bodega externa — reemplaza el campo de texto libre <c>ubicacion.bodega_externa</c>.</summary>
    BodegaExterna,

    /// <summary>Tanque de almacenamiento.</summary>
    Tanque,

    /// <summary>
    /// Lote de cosecha. <c>Codigo</c> es compuesto —
    /// <c>{FincaCodigo}-{LoteCodigo}</c> (diseño D5) — porque la numeración de
    /// lote se repite entre fincas y el índice único (TipoCatalogo, Codigo)
    /// es global, no por finca. <c>Nombre</c> lleva la etiqueta humana y
    /// <c>DatosAdicionales.fincaCodigo</c> queda como referencia de display.
    /// </summary>
    Lote,

    /// <summary>
    /// Ciclo de cosecha — independiente de <see cref="CicloCompostera"/> (no
    /// se reutiliza ese miembro: son conceptos de negocio distintos y el
    /// enum persiste como string, así que renombrar rompería filas ya
    /// guardadas y el Campo seedeado <c>compostera.ciclo</c>).
    /// </summary>
    CicloCosecha,

    /// <summary>Sección de finca.</summary>
    SeccionFinca,
}
