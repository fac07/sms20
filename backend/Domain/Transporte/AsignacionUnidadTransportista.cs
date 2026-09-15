namespace SmsBackend.Domain.Transporte;

/// <summary>
/// Asignación temporal de transportista a una Unidad (design D4). El
/// transportista ACTUAL de una unidad no es un campo crudo en <c>Maestro</c>
/// — es la fila abierta (<c>VigenteHasta == null</c>) de esta tabla; las
/// filas cerradas son el historial de reasignaciones. Misma convención
/// temporal que <c>Campo</c> y <c>TipoMovimientoSeccion</c>
/// (CampoConfiguration.cs, TipoMovimientoSeccionConfiguration.cs).
///
/// Append-only, precisamente: ninguna fila se reescribe una vez insertada —
/// quién, cuándo, a qué transportista y por qué quedan fijos para siempre. La
/// ÚNICA escritura post-inserción es sellar <c>VigenteHasta</c> en la fila
/// superada al reasignar (igual que CampoEndpoints.cs:176). El transportista
/// anterior no se duplica como columna: es, por definición, la fila cerrada
/// inmediatamente anterior.
///
/// <see cref="UnidadId"/> y <see cref="TransportistaId"/> son FKs lógicas
/// hacia <c>Maestro</c> (TipoCatalogo Unidad/Transportista) — sin navigation
/// property ni FK real en SQL Server, mismo criterio que
/// <c>VinculoPilotoTransportista</c> (design D1) y las referencias de
/// <c>PreIngreso</c>.
///
/// No se sincroniza a las básculas (design D4): nada en el flujo de pesaje
/// lee el transportista de una unidad — el terminal captura
/// <c>equipo</c>/<c>placa</c> como campos independientes.
/// </summary>
public class AsignacionUnidadTransportista
{
    public Guid Id { get; set; }

    /// <summary>FK lógica hacia Maestro (TipoCatalogo = Unidad).</summary>
    public Guid UnidadId { get; set; }

    /// <summary>FK lógica hacia Maestro (TipoCatalogo = Transportista).</summary>
    public Guid TransportistaId { get; set; }

    public DateTime VigenteDesde { get; set; }

    /// <summary>
    /// <c>null</c> = fila abierta = transportista actual de la unidad (G6).
    /// No-null = fila cerrada = historial.
    /// </summary>
    public DateTime? VigenteHasta { get; set; }

    /// <summary>
    /// UPN de quien hizo la asignación — cadena plana sin validar ni FK, sin
    /// sistema de auth, misma convención que
    /// <c>PreIngreso.UsuarioCreacion</c>/<c>Boleta.UsuarioAnula</c>.
    /// </summary>
    public string UsuarioAsigna { get; set; } = string.Empty;

    public string? MotivoCambio { get; set; }
}
