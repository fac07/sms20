namespace SmsBackend.Domain.Boletas.Extensiones;

/// <summary>
/// Característica de equipo asociada a la boleta — mismo concepto que
/// mas_Caracteristica_Equipo + NAT_BSC_Caracteristicas del legacy: el
/// operador elige de un catálogo predefinido (Maestro, TipoCatalogo =
/// CaracteristicaEquipo), no tipea libre. 1:N con Boleta.
///
/// El legacy también guarda una Placa por fila (una boleta puede llevar
/// varios equipos/placas vía NAT_BSC_Placas_Equipos, algo que Boleta.EquipoId
/// no soporta hoy — es un solo FK). Ese gap queda anotado aparte, fuera de
/// alcance acá; mientras tanto la característica queda implícitamente
/// asociada al único EquipoId de la boleta.
/// </summary>
public class BoletaCaracteristica
{
    public Guid Id { get; set; }

    /// <summary>FK -> Boleta.</summary>
    public Guid BoletaId { get; set; }

    /// <summary>FK -> Maestro (TipoCatalogo = CaracteristicaEquipo).</summary>
    public Guid CaracteristicaId { get; set; }

    public decimal Cantidad { get; set; }
}
