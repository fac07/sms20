namespace SmsBackend.Domain.Maestros;

public record MaestroDto(
    Guid Id,
    TipoCatalogo TipoCatalogo,
    string Codigo,
    string Nombre,
    string? DatosAdicionales,
    EstadoMaestro Estado,
    Guid? FusionadoConId,
    DateTime FechaModificacion,
    bool Activo)
{
    public static MaestroDto FromEntity(Maestro m) => new(
        m.Id, m.TipoCatalogo, m.Codigo, m.Nombre, m.DatosAdicionales,
        m.Estado, m.FusionadoConId, m.FechaModificacion, m.Activo);
}

public record GuardarMaestroRequest(
    TipoCatalogo TipoCatalogo,
    string Codigo,
    string Nombre,
    string? DatosAdicionales);

/// <summary>
/// Cuerpo obligatorio de <c>POST /api/maestros/{id}/aprobar</c>. El admin
/// confirma (o edita) el <see cref="Codigo"/> oficial sugerido por
/// <c>GET /api/maestros/siguiente-codigo</c> y, opcionalmente, corrige el
/// <see cref="Nombre"/>. El <c>PROV-…</c> coinado offline se reemplaza acá por
/// el código real.
/// </summary>
public record AprobarMaestroRequest(string Codigo, string? Nombre);

/// <summary>
/// Respuesta de <c>GET /api/maestros/siguiente-codigo?tipoCatalogo=X</c>.
/// <see cref="CodigoSugerido"/> es solo orientativo: sale de
/// <c>max(run de dígitos final)+1</c> sobre los códigos Oficial activos del
/// tipo, zero-padded al ancho más grande observado. No se persiste; la
/// unicidad la garantiza el índice <c>(TipoCatalogo, Codigo)</c> más el 409 de
/// <c>/aprobar</c>.
/// </summary>
public record SiguienteCodigoResponse(string CodigoSugerido);

/// <summary>
/// Definición completa de un maestro provisional coinado offline en una báscula.
/// Viaja dentro de <see cref="SincronizarMaestroRequest"/> cuando el dispatcher
/// del Outbox local reenvía el evento <c>MaestroProvisional</c>/<c>Crear</c>.
/// <see cref="Id"/> es el Guid estable generado por el cliente — la ingesta es
/// idempotente por ese valor.
/// </summary>
public record MaestroProvisionalPayload(
    Guid Id,
    TipoCatalogo TipoCatalogo,
    string Codigo,
    string Nombre,
    string? DatosAdicionales,
    DateTime FechaCreacion);

/// <summary>
/// Evento del Outbox local que el dispatcher reenvía a
/// <c>POST /api/maestros/sync</c>. Misma forma que
/// <c>SincronizarEventoRequest</c> de boletas: <c>basculaCodigo</c> +
/// <c>operacion</c> + <c>payload</c>. Hoy la única operación es <c>"Crear"</c>.
/// </summary>
public record SincronizarMaestroRequest(
    string BasculaCodigo,
    string Operacion,
    MaestroProvisionalPayload Payload);

/// <summary>
/// Heartbeat que el dispatcher del Outbox local manda a
/// <c>POST /api/maestros/incidencias-sync</c> cuando un evento
/// <c>MaestroProvisional</c> lleva 5+ intentos fallidos de sync. Es best-effort:
/// si falla no bloquea el despacho. Idempotente por <c>(BasculaCodigo, EntidadId)</c>.
/// </summary>
public record ReportarIncidenciaSyncRequest(
    string BasculaCodigo,
    Guid EntidadId,
    string? TipoCatalogo,
    string? Nombre,
    int Intentos,
    string? UltimoError);

/// <summary>
/// Entrada del store en memoria de incidencias de sync (<see cref="IncidenciasSyncStore"/>).
/// <see cref="UltimoError"/> se expone verbatim al panel del admin (decisión de
/// producto 9, panel interno sin auth). <see cref="Visto"/> es el instante del
/// último reporte — la entrada expira 1h después.
/// </summary>
public record IncidenciaSync(
    string BasculaCodigo,
    Guid EntidadId,
    string? TipoCatalogo,
    string? Nombre,
    int Intentos,
    string? UltimoError,
    DateTimeOffset Visto);
