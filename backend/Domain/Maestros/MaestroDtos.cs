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
