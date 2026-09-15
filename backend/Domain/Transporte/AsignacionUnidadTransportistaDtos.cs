namespace SmsBackend.Domain.Transporte;

/// <summary>
/// Proyección de lectura de una asignación. La fila con
/// <see cref="VigenteHasta"/> <c>null</c> es el transportista actual de la
/// unidad (G6); el resto es historial.
/// </summary>
public record AsignacionUnidadTransportistaDto(
    Guid Id,
    Guid UnidadId,
    Guid TransportistaId,
    DateTime VigenteDesde,
    DateTime? VigenteHasta,
    string UsuarioAsigna,
    string? MotivoCambio)
{
    public static AsignacionUnidadTransportistaDto FromEntity(AsignacionUnidadTransportista a) => new(
        a.Id, a.UnidadId, a.TransportistaId, a.VigenteDesde, a.VigenteHasta, a.UsuarioAsigna, a.MotivoCambio);
}

/// <summary>
/// Reasignar el transportista de una unidad: cierra la fila abierta (si
/// existe) e inserta esta como la nueva fila abierta, en un solo
/// <c>SaveChanges</c>.
/// </summary>
public record CrearAsignacionUnidadTransportistaRequest(
    Guid TransportistaId,
    string UsuarioAsigna,
    string? MotivoCambio);
