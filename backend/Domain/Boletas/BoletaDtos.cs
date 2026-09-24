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
    // Huella del trasiego — solo la ORIGINAL (Trasegada) la trae. Comparte
    // BoletaReemplazoId con la re-emisión; Estado desambigua cuál mecanismo
    // produjo el reemplazo.
    string? UsuarioTrasiego,
    DateTime? FechaHoraTrasiego,
    string? MotivoTrasiego,
    Guid? BoletaReemplazoId,
    Guid? BoletaOrigenId,
    MarcaBoletaOrigen? MarcaBoletaOrigen,
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
/// Trasiego de una boleta anulada — convierte sus datos a un tipo de
/// movimiento DISTINTO (p.ej. de Transferencia a Salida de Materia Prima y
/// Graneles). Evidencia:
///  - Manual: "Trasiego: Convertir los datos de una transacción o boleta a
///    una nueva ... también acá los pesos no son modificables, solo los
///    datos permitidos por Auditoría." Solo activa sobre una boleta ANULADA,
///    igual que RE-Emisión.
///  - Legacy NAT_Basculas: el método "real" <c>clsBoletaTrasiego.Boleta_Trasiego()</c>
///    es código muerto (comentado en el único call site,
///    <c>frmTrasiego.btnTrasegar_Click</c>). Lo que sí corre: el operador
///    elige usuario-autoriza + motivo + tipo destino (2 opciones fijas en el
///    diálogo legacy) y eso abre el formulario de alta del destino
///    PRE-LLENADO desde la boleta original — el mismo mecanismo
///    "BoletaEmision" que usa re-emisión. Trasiego es, en la práctica,
///    "re-emisión hacia un tipo distinto".
/// Acá: la nueva nace Cerrada con pesos/fechas/usuarios copiados de la
/// original (igual que <see cref="ReemitirBoletaRequest"/>); el correlativo,
/// el tipo de movimiento destino y los valores son lo editable. Sin
/// <see cref="Valores"/> explícitos, se auto-mapean por (SeccionClave,
/// CampoClave, TipoCampo) desde el conjunto de la original al del destino —
/// ver <c>MapearValoresPorClave</c>. A diferencia de re-emisión, el destino
/// NO hereda el TipoMovimiento de la original: <see cref="TipoMovimientoDestinoId"/>
/// es obligatorio y debe ser una dirección distinta de Transferencia (el
/// espejo exacto de la regla que /reemitir aplica sobre el ORIGEN). El
/// destino puede requerir MÁS campos de los que trajo la original — esos
/// quedan sin llenar hasta que <see cref="Valores"/> los provea (el
/// "algunos puntos por llenar" del manual). <see cref="UsuarioAutoriza"/> y
/// <see cref="MotivoTrasiego"/> quedan como huella en la original
/// (<c>BoletaReemplazoId</c> — mismo campo unidireccional que re-emisión).
/// </summary>
public record TrasegarBoletaRequest(
    Guid TipoMovimientoDestinoId,
    string NumeroBoleta,
    string UsuarioAutoriza,
    string MotivoTrasiego,
    IReadOnlyList<ValorCampoDto>? Valores = null);

/// <summary>
/// Evento del Outbox local (Electron/SQLite) que el dispatcher reenvía al
/// backend central. El payload viaja como snapshot JSON crudo — no un DTO
/// tipado — porque es exactamente lo que ya escribió db.ts al momento del
/// evento (BoletaLocal), y esto mantiene el endpoint desacoplado de la forma
/// exacta y evolutiva de esa tabla local.
/// </summary>
public record SincronizarEventoRequest(string BasculaCodigo, string Operacion, System.Text.Json.JsonElement Payload);
