namespace SmsBackend.Domain.Configuracion;

/// <summary>
/// Cuántas ocurrencias admite una <see cref="Seccion"/> dentro de una boleta.
/// <c>Unica</c> = a lo sumo la ocurrencia 0. <c>Repetible</c> = 0..N (marchamos,
/// detalle de fruta).
/// </summary>
public enum Cardinalidad
{
    Unica,
    Repetible,
}
