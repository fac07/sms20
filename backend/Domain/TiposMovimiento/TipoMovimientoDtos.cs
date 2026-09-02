namespace SmsBackend.Domain.TiposMovimiento;

public record TipoMovimientoDto(
    Guid Id,
    string Codigo,
    string Nombre,
    string Prefijo,
    DireccionMovimiento Direccion,
    OperacionD365? OperacionD365,
    bool GeneraQR,
    Guid? FormatoBoletaId,
    bool Activo)
{
    public static TipoMovimientoDto FromEntity(TipoMovimiento t) => new(
        t.Id, t.Codigo, t.Nombre, t.Prefijo, t.Direccion,
        t.OperacionD365, t.GeneraQR, t.FormatoBoletaId, t.Activo);
}

public record GuardarTipoMovimientoRequest(
    string Codigo,
    string Nombre,
    string Prefijo,
    DireccionMovimiento Direccion,
    OperacionD365? OperacionD365,
    bool GeneraQR,
    Guid? FormatoBoletaId);

/// <summary>Una asignación sección→tipo de movimiento, vigente o histórica.</summary>
public record TipoMovimientoSeccionDto(
    Guid SeccionId,
    string SeccionClave,
    string SeccionNombre,
    bool Requerida,
    int Orden,
    DateTime VigenteDesde,
    DateTime? VigenteHasta);

/// <summary>
/// Entrada del set deseado de secciones para un tipo de movimiento. El PUT es
/// declarativo: las que no aparecen se desasignan poniendo <c>VigenteHasta</c>
/// (nunca borrado físico), y los cambios de <c>Requerida</c>/<c>Orden</c> abren
/// una versión nueva para no alterar retroactivamente boletas ya creadas.
/// </summary>
public record AsignacionSeccionRequest(
    Guid SeccionId,
    bool Requerida,
    int Orden);
