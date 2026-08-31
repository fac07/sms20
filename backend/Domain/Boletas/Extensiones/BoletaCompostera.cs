namespace SmsBackend.Domain.Boletas.Extensiones;

/// <summary>
/// Datos de compostera — 1:1 con Boleta, gated por
/// TipoMovimiento.HabilitaCompostera.
/// </summary>
public class BoletaCompostera
{
    public Guid Id { get; set; }

    /// <summary>FK -> Boleta. Único — a lo sumo una fila de compostera por boleta.</summary>
    public Guid BoletaId { get; set; }

    public string CUI { get; set; } = string.Empty;

    /// <summary>FK -> Maestro (TipoCatalogo=Cama).</summary>
    public Guid CamaId { get; set; }

    /// <summary>
    /// FK -> Maestro (TipoCatalogo=SeccionCompostera). Provisorio — no
    /// estaba documentado en el diseño original, se agregó como catálogo
    /// nuevo a la espera de que el cliente confirme la descripción real.
    /// </summary>
    public Guid SeccionId { get; set; }

    /// <summary>FK -> Maestro (TipoCatalogo=CicloCompostera).</summary>
    public Guid CicloId { get; set; }
}
