namespace SmsBackend.Domain.Boletas;

/// <summary>
/// Marca de revisión para el admin sobre el enlace boleta↔pre-ingreso
/// (design D4). Es nullable en la boleta y la ausencia es el caso normal
/// (enlace limpio, o boleta pesada sin pre-ingreso). Fijarla NUNCA cambia la
/// validez, los pesos ni el estado de la boleta — es puramente informativa.
/// Se persiste como string (<c>nvarchar(30)</c>) vía <c>HasConversion</c>, el
/// mismo precedente que <see cref="MotivoPesoManual"/>.
/// </summary>
public enum MarcaPreIngreso
{
    /// <summary>
    /// El <c>preIngresoId</c> declarado offline no se pudo honrar: otra boleta
    /// del mismo centro ya lo tenía atado (perdedor de la carrera), o el
    /// pre-ingreso no existe en central. La boleta queda válida y SIN enlace
    /// (<c>PreIngresoId = null</c>) para no violar el índice único filtrado.
    /// </summary>
    VinculoRechazado,

    /// <summary>
    /// El pre-ingreso fue cancelado por logística (antes o después del enlace
    /// offline). La boleta CONSERVA el <c>PreIngresoId</c> — una revisión sin
    /// puntero a lo cancelado no es accionable (decisión de producto #4).
    /// </summary>
    PreIngresoCancelado,
}
