namespace SmsBackend.Domain.TiposMovimiento;

public record TipoMovimientoDto(
    Guid Id,
    string Codigo,
    string Nombre,
    DireccionMovimiento Direccion,
    bool HabilitaCalidad,
    bool HabilitaMarchamos,
    bool HabilitaQR,
    bool HabilitaDatosFinca,
    bool HabilitaDetalleFruta,
    bool HabilitaCompostera,
    bool IntegracionD365,
    Guid? FormatoBoletaId,
    bool Activo)
{
    public static TipoMovimientoDto FromEntity(TipoMovimiento t) => new(
        t.Id, t.Codigo, t.Nombre, t.Direccion,
        t.HabilitaCalidad, t.HabilitaMarchamos, t.HabilitaQR,
        t.HabilitaDatosFinca, t.HabilitaDetalleFruta, t.HabilitaCompostera,
        t.IntegracionD365, t.FormatoBoletaId, t.Activo);
}

public record GuardarTipoMovimientoRequest(
    string Codigo,
    string Nombre,
    DireccionMovimiento Direccion,
    bool HabilitaCalidad,
    bool HabilitaMarchamos,
    bool HabilitaQR,
    bool HabilitaDatosFinca,
    bool HabilitaDetalleFruta,
    bool HabilitaCompostera,
    bool IntegracionD365,
    Guid? FormatoBoletaId);
