namespace SmsBackend.Domain.Configuracion;

/// <summary>
/// Tipo de dato de un <see cref="Campo"/> configurable. Determina qué columna
/// tipada de BoletaValorCampo se usa al capturar el valor y qué chequeos aplica
/// el motor al cerrar la boleta.
/// </summary>
public enum TipoCampo
{
    Texto,
    Entero,
    Decimal,
    Fecha,
    FechaHora,
    Booleano,
    Lista,

    /// <summary>Referencia a una fila de Maestro acotada por Campo.TipoCatalogoRef.</summary>
    ReferenciaMaestro,
}
