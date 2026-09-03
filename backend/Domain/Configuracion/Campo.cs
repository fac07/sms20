using SmsBackend.Domain.Maestros;

namespace SmsBackend.Domain.Configuracion;

/// <summary>
/// Campo configurable dentro de una <see cref="Seccion"/>. Versionado: cambiar el
/// tipo o las reglas crea una fila NUEVA (nuevo <see cref="Id"/>, MISMA
/// <see cref="Clave"/>) y se le pone <see cref="VigenteHasta"/> a la anterior.
/// Nunca se muta TipoCampo/Clave/TipoCatalogoRef en su lugar, por eso el par
/// (clave de sección, clave de campo) NO identifica un Campo — solo el Id.
/// </summary>
public class Campo : IFechaModificable
{
    /// <summary>Generado en central, se replica verbatim al cache SQLite de la báscula.</summary>
    public Guid Id { get; set; }

    public Guid SeccionId { get; set; }

    /// <summary>Estable dentro de la sección. Una versión nueva REUSA la clave.</summary>
    public string Clave { get; set; } = string.Empty;

    public string Etiqueta { get; set; } = string.Empty;

    public TipoCampo TipoCampo { get; set; }

    /// <summary>Solo se setea cuando <see cref="TipoCampo"/> == <see cref="TipoCampo.ReferenciaMaestro"/>.</summary>
    public TipoCatalogo? TipoCatalogoRef { get; set; }

    public bool Requerido { get; set; }

    /// <summary>
    /// Config libre de UI (min/max, decimales, unidad, opciones de Lista, regex)
    /// como JSON crudo. No se reporta ni se filtra — se parsea a
    /// <see cref="ConfiguracionCampo"/> en código.
    /// </summary>
    public string? Configuracion { get; set; }

    public int Orden { get; set; }

    public DateTime VigenteDesde { get; set; }

    /// <summary><c>null</c> = versión vigente.</summary>
    public DateTime? VigenteHasta { get; set; }

    /// <summary>Marca de agua para el sync incremental hacia las básculas.</summary>
    public DateTime FechaModificacion { get; set; } = DateTime.UtcNow;
}
