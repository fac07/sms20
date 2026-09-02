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

    /// <summary>Prefijo corto del correlativo (REC, ENV, TRF, OC, OV) — distinto de Codigo, que es el código de catálogo completo.</summary>
    public string Prefijo { get; set; } = string.Empty;

    public DireccionMovimiento Direccion { get; set; }

    /// <summary>
    /// Operación de Dynamics 365 que produce este tipo de movimiento al
    /// integrar. <c>null</c> significa que la boleta nunca entra al OutboxD365
    /// (reemplaza al bool legacy IntegracionD365, que equivale a
    /// <c>OperacionD365 != null</c>).
    /// </summary>
    public OperacionD365? OperacionD365 { get; set; }

    /// <summary>Si está encendido, el cierre de la boleta genera un código QR.</summary>
    public bool GeneraQR { get; set; }

    /// <summary>
    /// FK lógica hacia PlantillaImpresion — esa tabla todavía no existe en el
    /// esquema, así que por ahora es un Guid suelto sin FK física.
    /// </summary>
    public Guid? FormatoBoletaId { get; set; }

    public bool Activo { get; set; } = true;
}
