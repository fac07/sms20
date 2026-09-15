namespace SmsBackend.Domain.Seguridad;

/// <summary>
/// Asociación Usuario-Centro (design D1, spec autorizacion-roles "Role-Dependent
/// Centro Scoping"): la cardinalidad depende del <see cref="Seguridad.Rol"/> —
/// Operador exactamente una fila (Centro fijo), Supervisor N filas (Centros
/// asignados), Administrador CERO filas (alcance global, sin restricción de
/// Centro). El alcance efectivo se materializa en claims en PR1 (0.6/0.7); el
/// filtrado real por Centro llega en PR3.
/// </summary>
public class UsuarioCentro
{
    public Guid UsuarioId { get; set; }

    /// <summary>
    /// FK lógica hacia Maestro (TipoCatalogo = Centro), sin relación EF —
    /// misma convención que <c>Bascula.CentroId</c>/<c>PreIngreso.CentroId</c>.
    /// </summary>
    public Guid CentroId { get; set; }
}
