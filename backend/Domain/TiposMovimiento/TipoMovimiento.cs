namespace SmsBackend.Domain.TiposMovimiento;

/// <summary>
/// Catálogo configurable que reemplaza las pantallas fijas por transacción del
/// sistema legacy. Agregar un tipo de movimiento nuevo es una fila acá.
///
/// Esta clase es solo el catálogo. La validación de que una Boleta respete lo
/// que su TipoMovimiento habilita vive en una capa aparte (el "motor" en
/// sentido estricto), que se agrega junto con la entidad Boleta.
/// </summary>
public class TipoMovimiento
{
    public Guid Id { get; set; }

    public string Codigo { get; set; } = string.Empty;

    public string Nombre { get; set; } = string.Empty;

    public DireccionMovimiento Direccion { get; set; }

    public bool HabilitaCalidad { get; set; }

    public bool HabilitaMarchamos { get; set; }

    public bool HabilitaQR { get; set; }

    public bool HabilitaDatosFinca { get; set; }

    public bool HabilitaDetalleFruta { get; set; }

    public bool HabilitaCompostera { get; set; }

    /// <summary>Si está apagado, la boleta nunca entra al OutboxD365.</summary>
    public bool IntegracionD365 { get; set; }

    /// <summary>
    /// FK lógica hacia PlantillaImpresion — esa tabla todavía no existe en el
    /// esquema, así que por ahora es un Guid suelto sin FK física.
    /// </summary>
    public Guid? FormatoBoletaId { get; set; }

    public bool Activo { get; set; } = true;
}
