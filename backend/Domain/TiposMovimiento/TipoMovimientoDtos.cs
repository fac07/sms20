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
