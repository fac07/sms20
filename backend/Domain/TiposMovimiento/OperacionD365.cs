namespace SmsBackend.Domain.TiposMovimiento;

/// <summary>
/// Operación de Dynamics 365 que produce un TipoMovimiento cuando integra.
/// <c>null</c> en TipoMovimiento.OperacionD365 significa que ese tipo nunca
/// genera un evento D365 (reemplaza al bool legacy IntegracionD365).
/// </summary>
public enum OperacionD365
{
    IngresoFruta,
    TransferenciaCreacion,
    TransferenciaRecepcion,
    RecepcionOC,
    SalidaOV,
}
