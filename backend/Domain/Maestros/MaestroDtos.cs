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
