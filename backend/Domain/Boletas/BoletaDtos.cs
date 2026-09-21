using SmsBackend.Domain.Boletas.Valores;
using SmsBackend.Domain.PreIngresos;

namespace SmsBackend.Domain.Boletas;

public record BoletaDto(
    Guid Id,
    string NumeroBoleta,
    Guid BasculaId,
    string? BasculaCodigo,
    string? CentroCodigo,
    Guid TipoMovimientoId,
    string? TipoMovimientoNombre,
    bool GeneraQR,
    EstadoBoleta Estado,
    EstadoSyncBoleta EstadoSync,
    decimal PesoIngreso,
    decimal? PesoSalida,
    decimal? PesoNeto,
    OrigenPeso OrigenPesoIngreso,
    OrigenPeso? OrigenPesoSalida,
    DateTime FechaHoraIngreso,
    DateTime? FechaHoraSalida,
    string UsuarioIngreso,
    string? UsuarioSalida,
    string? UsuarioAnula,
    string? UsuarioAutoriza,
    string? MotivoAnulacion,
    DateTime? FechaHoraAnulacion,
    // Huella de la re-emisión — solo la ORIGINAL (Reemitida) la trae.
    string? UsuarioReemision,
    DateTime? FechaHoraReemision,
    Guid? BoletaReemplazoId,
    Guid? BoletaOrigenId,
    Guid? BasculaSalidaId,
    Guid? PreIngresoId,
    // Datos del pre-ingreso enlazado, resueltos por un left join en Proyectar —
    // null cuando la boleta no tiene enlace (o el enlace fue rechazado).
    string? PreIngresoNumeroEnvio,
    EstadoPreIngreso? PreIngresoEstado,
    string? RespuestaD365Id,
    bool CreadaOffline,
    MotivoPesoManual? MotivoPesoManual,
    string? MotivoPesoManualDetalle,
    // Marca de revisión del enlace al pre-ingreso — ver MarcaPreIngreso.
    MarcaPreIngreso? MarcaPreIngreso,
    // Marca de revisión del par piloto+transportista — ver MarcaVinculoTransporte.
    MarcaVinculoTransporte? MarcaVinculoTransporte,
    // Auditoría de reimpresión (mejora sobre el legacy sin huella) — 0/null
    // hasta el primer POST /{id}/reimprimir.
    int CantidadReimpresiones,
    string? UltimaReimpresionUsuario,
    DateTime? UltimaReimpresionFecha,
    IReadOnlyList<ValorCampoLeidoDto> Valores);

/// <summary>
/// Datos del primer pesaje — abre la boleta. El contexto de negocio
/// (transporte, producto, ubicación, calidad, ...) viaja en <see cref="Valores"/>
/// como una lista de valores de campos configurables keyed por
/// (<c>CampoId</c>, <c>Ocurrencia</c>) — la misma representación que consume la
/// rama "Crear" de <c>/api/boletas/sync</c>.
/// </summary>
public record CrearBoletaRequest(
    string NumeroBoleta,
    Guid BasculaId,
    Guid TipoMovimientoId,
    decimal PesoIngreso,
    OrigenPeso OrigenPesoIngreso,
    string UsuarioIngreso,
    bool CreadaOffline,
    IReadOnlyList<ValorCampoDto>? Valores = null,
    // Motivo del catálogo, como string crudo para poder devolver 422 (no 400)
    // ante un valor fuera de catálogo. Obligatorio cuando OrigenPesoIngreso = Manual.
    string? MotivoPesoManual = null,
    string? MotivoPesoManualDetalle = null,
    // Enlace opcional a la cola de transporte — paridad con la rama "Crear" de
    // /api/boletas/sync. Se resuelve con la misma lógica de carrera central.
    Guid? PreIngresoId = null);

/// <summary>Datos del segundo pesaje — cierra la boleta.</summary>
public record CerrarBoletaRequest(
    decimal PesoSalida,
    OrigenPeso OrigenPesoSalida,
    string UsuarioSalida,
    Guid? BasculaSalidaId,
    string? MotivoPesoManual = null,
    string? MotivoPesoManualDetalle = null);

/// <summary>Doble control — no se anula sin UsuarioAnula y UsuarioAutoriza.</summary>
public record AnularBoletaRequest(
    string UsuarioAnula,
    string UsuarioAutoriza,
    string MotivoAnulacion);

/// <summary>
/// Registro de una reimpresión en el mostrador. El <c>Usuario</c> es un UPN
/// plano (string) — el mismo patrón que <see cref="AnularBoletaRequest"/> y
/// legacy <c>clsBoleta</c>: el backend no valida el formato, solo lo guarda
/// como rastro de quién imprimió por última vez.
/// </summary>
public record ReimprimirBoletaRequest(string Usuario);

/// <summary>
/// Re-emisión de una boleta anulada — COPIA CONGELADA con correlativo nuevo.
/// Báscula, tipo de movimiento, pesos, orígenes, fechas y usuarios NO se
/// piden: se copian de la anulada (los pesos y la fecha de emisión no son
/// modificables). Si <see cref="Valores"/> es null se copian los valores
/// almacenados en la original; si viene, reemplaza el conjunto completo (los
/// datos que Auditoría permite corregir: calidad, números de documento, etc.).
/// <see cref="UsuarioReemision"/> queda como huella en la original. El vínculo
/// es unidireccional (<c>BoletaReemplazoId</c> en la original) —
/// <c>BoletaOrigenId</c> queda reservado para recepción de transferencia.
/// </summary>
public record ReemitirBoletaRequest(
    string NumeroBoleta,
    string UsuarioReemision,
    IReadOnlyList<ValorCampoDto>? Valores = null);

/// <summary>
/// Evento del Outbox local (Electron/SQLite) que el dispatcher reenvía al
/// backend central. El payload viaja como snapshot JSON crudo — no un DTO
/// tipado — porque es exactamente lo que ya escribió db.ts al momento del
/// evento (BoletaLocal), y esto mantiene el endpoint desacoplado de la forma
/// exacta y evolutiva de esa tabla local.
/// </summary>
public record SincronizarEventoRequest(string BasculaCodigo, string Operacion, System.Text.Json.JsonElement Payload);
