namespace SmsBackend.Domain.Maestros;

/// <summary>
/// Catálogo genérico: pilotos, transportistas, equipos, productos, terceros,
/// fincas, almacenes y centros son todos filas de esta misma tabla,
/// distinguidos por <see cref="TipoCatalogo"/>. Cubre también el flujo de
/// ítems provisionales (sección 3.9 de la propuesta) — la cola de
/// validación es simplemente `WHERE Estado = Provisional`, sin tabla aparte.
/// </summary>
public class Maestro
{
    public Guid Id { get; set; }

    public TipoCatalogo TipoCatalogo { get; set; }

    public string Codigo { get; set; } = string.Empty;

    public string Nombre { get; set; } = string.Empty;

    /// <summary>
    /// Licencia de piloto, hectáreas de finca, capacidad de equipo — la forma
    /// varía por TipoCatalogo y no se agrega/filtra en reportes, por eso JSON
    /// en vez de columnas fijas. Texto crudo, sin tipar en el modelo EF.
    /// </summary>
    public string? DatosAdicionales { get; set; }

    public EstadoMaestro Estado { get; set; } = EstadoMaestro.Oficial;

    /// <summary>Self-FK. Se llena cuando el admin fusiona este provisional con un ítem oficial.</summary>
    public Guid? FusionadoConId { get; set; }

    /// <summary>Marca de agua para el sync incremental hacia las básculas.</summary>
    public DateTime FechaModificacion { get; set; } = DateTime.UtcNow;

    public bool Activo { get; set; } = true;
}
