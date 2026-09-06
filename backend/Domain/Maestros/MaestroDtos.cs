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
