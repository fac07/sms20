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
}
