namespace SmsBackend.Domain.Boletas.Extensiones;

/// <summary>
/// Detalle de fruta del ingreso — 1:1 con Boleta, gated por
/// TipoMovimiento.HabilitaDetalleFruta. Corrección post-verificación contra
/// el legacy (NAT_Basculas/Datos/clsBoletaEnviosDetalleFruta.cs y el .bacpac
/// de producción): originalmente se modeló 1:N, pero Racimos_*/Pedunculo_Largo
/// viven directamente en NAT_BSC_Boleta — una sola fila de valores por
/// boleta, no una lista repetible. Se eliminaron además tres campos mal
/// ubicados: Sacos pertenece al proceso separado de Envío/maquila de fruta
/// (NAT_BSC_Envio_Det), no a Ingreso; Jornales no existe en ningún lado del
/// esquema legacy (se inventó); Hectáreas es dato maestro de mas_Lote
/// (catálogo de parcelas), consultado por lookup, nunca tipeado por el
/// operador — se difiere hasta que exista un catálogo de Lote en este
/// sistema.
/// </summary>
public class BoletaDetalleFruta
{
    public Guid Id { get; set; }

    /// <summary>FK -> Boleta. Único — a lo sumo una fila de detalle de fruta por boleta.</summary>
    public Guid BoletaId { get; set; }

    public int RacimosVerdes { get; set; }

    public int RacimosMaduros { get; set; }

    public int RacimosSobreMaduros { get; set; }

    public int RacimosPasados { get; set; }

    public int PedunculoLargo { get; set; }
}
