using SmsBackend.Domain.Configuracion;

namespace SmsBackend.Domain.PreIngresos;

/// <summary>
/// Cola de transporte: logística registra una unidad que va camino a la
/// báscula, y el operador la enlaza con la boleta real durante el pesaje. Es
/// una entidad central-autoritativa con su propia máquina de estados
/// (<see cref="EstadoPreIngreso"/>); se distribuye a cada báscula del centro
/// por un delta-sync dedicado (<c>?modificadoDesde=</c>), igual que
/// <c>Maestro</c>.
///
/// Las seis referencias a <c>Maestro</c> (centro, piloto, transportista,
/// equipo, región, finca) son <b>lógicas</b> — sin navigation property, sin
/// relación EF — igual que <c>Bascula.CentroId</c>. Solo
/// <see cref="BoletaId"/> es una FK real (design D3): el lado canónico del
/// enlace 1:1 es el pre-ingreso, que es el que posee el ciclo de vida.
/// </summary>
public class PreIngreso : IFechaModificable
{
    public Guid Id { get; set; }

    /// <summary>FK lógica hacia Maestro (TipoCatalogo = Centro). Obligatoria — scopea el delta-sync.</summary>
    public Guid CentroId { get; set; }

    /// <summary>FK lógica hacia Maestro (TipoCatalogo = Piloto).</summary>
    public Guid? PilotoId { get; set; }

    /// <summary>FK lógica hacia Maestro (TipoCatalogo = Transportista).</summary>
    public Guid? TransportistaId { get; set; }

    /// <summary>FK lógica hacia Maestro (TipoCatalogo = Equipo).</summary>
    public Guid? EquipoId { get; set; }

    /// <summary>FK lógica hacia Maestro (TipoCatalogo = Región).</summary>
    public Guid? RegionId { get; set; }

    /// <summary>FK lógica hacia Maestro (TipoCatalogo = Finca).</summary>
    public Guid? FincaId { get; set; }

    /// <summary>Número de envío declarado por logística — índice no único (solo filtro).</summary>
    public string NumeroEnvio { get; set; } = string.Empty;

    /// <summary>Peso declarado en kg — misma unidad/tipo que <c>Boleta.PesoIngreso</c>.</summary>
    public decimal PesoEnviado { get; set; }

    public int? Racimos { get; set; }

    public int? Sacos { get; set; }

    public EstadoPreIngreso Estado { get; set; }

    /// <summary>
    /// FK real hacia Boleta (<c>Restrict</c>), nullable. La setea la ingesta de
    /// boletas de slice 2 cuando el pre-ingreso pasa a <c>Vinculado</c>.
    /// </summary>
    public Guid? BoletaId { get; set; }

    /// <summary>UPN de quien creó el registro — VARCHAR plano, sin FK.</summary>
    public string UsuarioCreacion { get; set; } = string.Empty;

    public string? UsuarioCancela { get; set; }

    public string? MotivoCancelacion { get; set; }

    public DateTime FechaCreacion { get; set; }

    /// <summary>
    /// Marca de agua del delta-sync central→terminal. La sella
    /// <c>SmsDbContext.SaveChanges</c> en cada alta o edición; solo la rama de
    /// <c>ExecuteUpdate</c> de la ingesta de boletas (slice 2) la fija a mano.
    /// </summary>
    public DateTime FechaModificacion { get; set; }
}
