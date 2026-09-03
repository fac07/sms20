namespace SmsBackend.Domain.Configuracion;

/// <summary>
/// Puente temporal: qué secciones aplican a un TipoMovimiento y desde cuándo.
/// Desasignar una sección se hace poniendo <see cref="VigenteHasta"/>, nunca con
/// borrado físico, para que el set de campos de una boleta ya creada no cambie
/// retroactivamente (desviación aprobada del Esquema v7 §03, que usaba PK de dos
/// columnas y borrado físico).
/// </summary>
public class TipoMovimientoSeccion : IFechaModificable
{
    public Guid TipoMovimientoId { get; set; }

    public Guid SeccionId { get; set; }

    public DateTime VigenteDesde { get; set; }

    /// <summary><c>null</c> = asignación vigente.</summary>
    public DateTime? VigenteHasta { get; set; }

    public bool Requerida { get; set; }

    public int Orden { get; set; }

    /// <summary>Marca de agua para el sync incremental hacia las básculas.</summary>
    public DateTime FechaModificacion { get; set; } = DateTime.UtcNow;
}
