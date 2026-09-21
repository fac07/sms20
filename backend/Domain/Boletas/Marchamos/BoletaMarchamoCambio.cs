namespace SmsBackend.Domain.Boletas.Marchamos;

public enum AccionMarchamo
{
    Agregar,
    Rectificar,
    Desactivar,
    Reactivar,
}

/// <summary>Historial inmutable de correcciones de marchamos en central.</summary>
public sealed class BoletaMarchamoCambio
{
    public Guid Id { get; set; }
    public Guid BoletaId { get; set; }
    public int Ocurrencia { get; set; }
    public AccionMarchamo Accion { get; set; }
    public string? ValorAnterior { get; set; }
    public string ValorNuevo { get; set; } = string.Empty;
    public string Observacion { get; set; } = string.Empty;
    public string Usuario { get; set; } = string.Empty;
    public DateTime Fecha { get; set; }
}
