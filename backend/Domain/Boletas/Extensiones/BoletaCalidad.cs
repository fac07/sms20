namespace SmsBackend.Domain.Boletas.Extensiones;

/// <summary>
/// Datos de calidad del ingreso — 1:1 con Boleta, gated por
/// TipoMovimiento.HabilitaCalidad. Los cuatro valores numéricos son
/// lecturas/porcentajes, no pesos, por eso no reutilizan decimal(12,2).
/// </summary>
public class BoletaCalidad
{
    public Guid Id { get; set; }

    /// <summary>FK -> Boleta. Único — a lo sumo una fila de calidad por boleta.</summary>
    public Guid BoletaId { get; set; }

    public decimal? Acidez { get; set; }

    public decimal? Luz { get; set; }

    public decimal? DOBI { get; set; }

    public decimal? Humedad { get; set; }

    public decimal? Temperatura { get; set; }

    public string? NumeroRevisionQA { get; set; }
}
