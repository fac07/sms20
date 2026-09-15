namespace SmsBackend.Domain.Reportes;

/// <summary>
/// Una fila del consolidado báscula×día para
/// <c>GET /api/reportes/resumen-basculas</c>. Fecha = día calendario UTC de
/// cierre (<c>FechaHoraSalida</c>) — mismo campo de ventana que el legacy
/// (<c>Boleta.Fecha_Hora_Registro_Salida_Bascula</c>,
/// frmResumenDiarioBasculas.cs:237). Solo boletas Cerrada: el neto recién
/// existe al cerrar, Anuladas se excluyen por spec, EnTransito no tiene neto
/// y Reemitida duplicaría el pesaje que ya reemplazó.
/// </summary>
public record ResumenBasculaDiaDto(
    Guid BasculaId,
    string BasculaNombre,
    DateOnly Fecha,
    int CantidadBoletas,
    decimal PesoNetoTotal);
