namespace SmsBackend.Domain.Boletas;

/// <summary>
/// La boleta de báscula — modelo de doble pesaje. El primer paso (ingreso)
/// crea la fila con Estado=EnTransito; el segundo paso (cierre) completa
/// PesoSalida/PesoNeto y pasa a Cerrada. Esta es la copia central de la
/// entidad; el flujo offline completo (creación en SQLite vía Electron y el
/// Outbox de sincronización) todavía no existe — por ahora este backend es
/// el punto de entrada directo, igual que se hizo incrementalmente con
/// TipoMovimiento/Maestro/Bascula.
/// </summary>
public class Boleta
{
    public Guid Id { get; set; }

    /// <summary>
    /// Correlativo legible — lo genera la capa local (Electron/SQLite, scope
    /// "Correlativo" del esquema) que todavía no existe. Por ahora el caller
    /// lo provee.
    /// </summary>
    public string NumeroBoleta { get; set; } = string.Empty;

    /// <summary>FK -> Bascula donde se hizo el pesaje de ingreso.</summary>
    public Guid BasculaId { get; set; }

    /// <summary>FK -> TipoMovimiento — determina qué campos aplican y si integra a D365.</summary>
    public Guid TipoMovimientoId { get; set; }

    public EstadoBoleta Estado { get; set; }

    public EstadoSyncBoleta EstadoSync { get; set; }

    /// <summary>FK -> Maestro (TipoCatalogo=Equipo).</summary>
    public Guid EquipoId { get; set; }

    /// <summary>FK -> Maestro (TipoCatalogo=Transportista).</summary>
    public Guid TransportistaId { get; set; }

    /// <summary>FK -> Maestro (TipoCatalogo=Piloto).</summary>
    public Guid PilotoId { get; set; }

    /// <summary>FK -> Maestro — proveedor o cliente, según Direccion del TipoMovimiento.</summary>
    public Guid TerceroId { get; set; }

    /// <summary>FK -> Maestro (TipoCatalogo=Producto).</summary>
    public Guid ProductoId { get; set; }

    /// <summary>FK -> Maestro (TipoCatalogo=Almacen), solo aplica en algunas direcciones.</summary>
    public Guid? AlmacenOrigenId { get; set; }

    /// <summary>FK -> Maestro (TipoCatalogo=Almacen), solo aplica en algunas direcciones.</summary>
    public Guid? AlmacenDestinoId { get; set; }

    /// <summary>Peso real, sin el escalado x10000 que usa el legacy.</summary>
    public decimal PesoIngreso { get; set; }

    /// <summary>Null hasta el cierre.</summary>
    public decimal? PesoSalida { get; set; }

    /// <summary>Null hasta el cierre — calculado como abs(PesoIngreso - PesoSalida).</summary>
    public decimal? PesoNeto { get; set; }

    public OrigenPeso OrigenPesoIngreso { get; set; }

    /// <summary>Null hasta el cierre.</summary>
    public OrigenPeso? OrigenPesoSalida { get; set; }

    public DateTime FechaHoraIngreso { get; set; }

    /// <summary>Null mientras la boleta está en tránsito.</summary>
    public DateTime? FechaHoraSalida { get; set; }

    /// <summary>
    /// VARCHAR plano, sin FK — UPN de Entra ID (ej. jperez@naturaceites.com),
    /// copiado en el momento de la transacción. Mismo criterio que el legacy
    /// clsBoleta.cs con Usuario_ID_Ingreso/Usuario_Nombre_Ingreso. El backend
    /// no valida el formato del string.
    /// </summary>
    public string UsuarioIngreso { get; set; } = string.Empty;

    public string? UsuarioSalida { get; set; }

    public string? UsuarioAnula { get; set; }

    /// <summary>Doble control en la anulación — igual que el legacy.</summary>
    public string? UsuarioAutoriza { get; set; }

    public string? MotivoAnulacion { get; set; }

    /// <summary>Self-FK, sin navigation property. Apunta a la boleta que reemplaza a esta.</summary>
    public Guid? BoletaReemplazoId { get; set; }

    /// <summary>Self-FK, sin navigation property. Solo se usa en recepción de transferencia.</summary>
    public Guid? BoletaOrigenId { get; set; }

    /// <summary>FK -> Bascula, solo si el pesaje de salida se hizo en una báscula física distinta a la de ingreso.</summary>
    public Guid? BasculaSalidaId { get; set; }

    public string? RespuestaD365Id { get; set; }

    public bool CreadaOffline { get; set; }

    /// <summary>Rowversion de SQL Server — concurrency token.</summary>
    public byte[]? RowVersion { get; set; }
}
