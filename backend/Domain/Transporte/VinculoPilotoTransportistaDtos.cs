namespace SmsBackend.Domain.Transporte;

/// <summary>
/// Proyección de lectura de un vínculo. La consumen el listado admin, el
/// detalle y el delta-sync central→terminal.
/// </summary>
public record VinculoPilotoTransportistaDto(
    Guid Id,
    Guid PilotoId,
    Guid TransportistaId,
    bool Activo,
    string UsuarioCreacion,
    DateTime FechaCreacion,
    DateTime FechaModificacion)
{
    public static VinculoPilotoTransportistaDto FromEntity(VinculoPilotoTransportista v) => new(
        v.Id, v.PilotoId, v.TransportistaId, v.Activo,
        v.UsuarioCreacion, v.FechaCreacion, v.FechaModificacion);
}

/// <summary>
/// Alta de un vínculo. 409 si ya existe una fila para el par
/// (<see cref="PilotoId"/>, <see cref="TransportistaId"/>), sin importar su
/// <c>Activo</c> — reactivar un par desactivado usa
/// <c>POST /{id}/reactivar</c>, no una nueva alta.
/// </summary>
public record CrearVinculoPilotoTransportistaRequest(
    Guid PilotoId,
    Guid TransportistaId,
    string UsuarioCreacion);
