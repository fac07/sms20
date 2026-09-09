namespace SmsBackend.Domain.PreIngresos;

/// <summary>
/// Máquina de estados de la cola de transporte (design D4). Transiciones
/// permitidas: <c>Pendiente → Vinculado</c> (solo por la ingesta de boletas,
/// slice 2) y <c>Pendiente → Cancelado</c> (admin). <c>Vinculado</c> y
/// <c>Cancelado</c> son terminales en v1.
/// </summary>
public enum EstadoPreIngreso
{
    Pendiente,
    Vinculado,
    Cancelado,
}
