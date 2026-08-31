namespace SmsBackend.Domain.Boletas;

public record BoletaDto(
    Guid Id,
    string NumeroBoleta,
    Guid BasculaId,
    string? BasculaCodigo,
    Guid TipoMovimientoId,
    string? TipoMovimientoNombre,
    EstadoBoleta Estado,
    EstadoSyncBoleta EstadoSync,
    Guid EquipoId,
    string? EquipoCodigo,
    Guid TransportistaId,
    string? TransportistaCodigo,
    Guid PilotoId,
    string? PilotoCodigo,
    Guid TerceroId,
    string? TerceroCodigo,
    Guid ProductoId,
    string? ProductoCodigo,
    Guid? AlmacenOrigenId,
    Guid? AlmacenDestinoId,
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
    Guid? BoletaReemplazoId,
    Guid? BoletaOrigenId,
    Guid? BasculaSalidaId,
    string? RespuestaD365Id,
    bool CreadaOffline);

/// <summary>Datos del primer pesaje — abre la boleta.</summary>
public record CrearBoletaRequest(
    string NumeroBoleta,
    Guid BasculaId,
    Guid TipoMovimientoId,
    Guid EquipoId,
    Guid TransportistaId,
    Guid PilotoId,
    Guid TerceroId,
    Guid ProductoId,
    Guid? AlmacenOrigenId,
    Guid? AlmacenDestinoId,
    decimal PesoIngreso,
    OrigenPeso OrigenPesoIngreso,
    string UsuarioIngreso,
    bool CreadaOffline);

/// <summary>Datos del segundo pesaje — cierra la boleta.</summary>
public record CerrarBoletaRequest(
    decimal PesoSalida,
    OrigenPeso OrigenPesoSalida,
    string UsuarioSalida,
    Guid? BasculaSalidaId);

/// <summary>Doble control — no se anula sin UsuarioAnula y UsuarioAutoriza.</summary>
public record AnularBoletaRequest(
    string UsuarioAnula,
    string UsuarioAutoriza,
    string MotivoAnulacion);
