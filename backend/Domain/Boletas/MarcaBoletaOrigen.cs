namespace SmsBackend.Domain.Boletas;

/// <summary>
/// Marca no bloqueante para revisar el vínculo lógico con la boleta de origen.
/// La recepción siempre se conserva aunque el origen aún no exista o ya tenga
/// otra recepción activa.
/// </summary>
public enum MarcaBoletaOrigen
{
    OrigenNoResuelto,
    RecepcionDuplicada,
}
