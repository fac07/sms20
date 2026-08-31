namespace SmsBackend.Domain.Boletas.Extensiones;

/// <summary>
/// Detalle de un envío de fruta dentro de una boleta — 1:N con Boleta, ya
/// que una boleta puede traer varios envíos. Gated por
/// TipoMovimiento.HabilitaDetalleFruta.
/// </summary>
public class BoletaDetalleFruta
{
    public Guid Id { get; set; }

    /// <summary>FK -> Boleta.</summary>
    public Guid BoletaId { get; set; }

    public int RacimosVerdes { get; set; }

    public int RacimosMaduros { get; set; }

    public int RacimosSobreMaduros { get; set; }

    public int RacimosPasados { get; set; }

    public int PedunculoLargo { get; set; }

    public decimal Sacos { get; set; }

    public decimal Jornales { get; set; }

    public decimal Hectareas { get; set; }
}
