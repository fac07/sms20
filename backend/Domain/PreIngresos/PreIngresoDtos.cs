namespace SmsBackend.Domain.PreIngresos;

/// <summary>
/// Proyección de lectura de un pre-ingreso. La consumen el listado admin, el
/// detalle y el delta-sync central→terminal.
/// </summary>
public record PreIngresoDto(
    Guid Id,
    Guid CentroId,
    Guid? PilotoId,
    Guid? TransportistaId,
    Guid? EquipoId,
    Guid? RegionId,
    Guid? FincaId,
    string NumeroEnvio,
    decimal PesoEnviado,
    int? Racimos,
    int? Sacos,
    EstadoPreIngreso Estado,
    Guid? BoletaId,
    string UsuarioCreacion,
    string? UsuarioCancela,
    string? MotivoCancelacion,
    DateTime FechaCreacion,
    DateTime FechaModificacion)
{
    public static PreIngresoDto FromEntity(PreIngreso p) => new(
        p.Id, p.CentroId, p.PilotoId, p.TransportistaId, p.EquipoId, p.RegionId, p.FincaId,
        p.NumeroEnvio, p.PesoEnviado, p.Racimos, p.Sacos, p.Estado, p.BoletaId,
        p.UsuarioCreacion, p.UsuarioCancela, p.MotivoCancelacion,
        p.FechaCreacion, p.FechaModificacion);
}

/// <summary>
/// Alta de un pre-ingreso. <see cref="CentroId"/> es obligatorio (400 si falta
/// o no existe); <c>Estado</c> se fuerza server-side a <c>Pendiente</c>.
/// </summary>
public record CrearPreIngresoRequest(
    Guid CentroId,
    string NumeroEnvio,
    decimal PesoEnviado,
    Guid? PilotoId = null,
    Guid? TransportistaId = null,
    Guid? EquipoId = null,
    Guid? RegionId = null,
    Guid? FincaId = null,
    int? Racimos = null,
    int? Sacos = null,
    string UsuarioCreacion = "");

/// <summary>
/// Edición de un pre-ingreso. Solo se acepta mientras <c>Estado=Pendiente</c>
/// (409 en cualquier otro estado). Cada edición avanza <c>FechaModificacion</c>.
/// </summary>
public record EditarPreIngresoRequest(
    Guid CentroId,
    string NumeroEnvio,
    decimal PesoEnviado,
    Guid? PilotoId = null,
    Guid? TransportistaId = null,
    Guid? EquipoId = null,
    Guid? RegionId = null,
    Guid? FincaId = null,
    int? Racimos = null,
    int? Sacos = null);

/// <summary>
/// Cancelación de un pre-ingreso — doble campo de auditoría. Solo desde
/// <c>Pendiente</c> (409 si ya está <c>Vinculado</c> o <c>Cancelado</c>).
/// </summary>
public record CancelarPreIngresoRequest(
    string UsuarioCancela,
    string? MotivoCancelacion);
