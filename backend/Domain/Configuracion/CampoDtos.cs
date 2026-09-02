using SmsBackend.Domain.Maestros;

namespace SmsBackend.Domain.Configuracion;

public record CampoDto(
    Guid Id,
    Guid SeccionId,
    string Clave,
    string Etiqueta,
    TipoCampo TipoCampo,
    TipoCatalogo? TipoCatalogoRef,
    bool Requerido,
    string? Configuracion,
    int Orden,
    DateTime VigenteDesde,
    DateTime? VigenteHasta)
{
    public static CampoDto FromEntity(Campo c) => new(
        c.Id, c.SeccionId, c.Clave, c.Etiqueta, c.TipoCampo, c.TipoCatalogoRef,
        c.Requerido, c.Configuracion, c.Orden, c.VigenteDesde, c.VigenteHasta);
}

/// <summary>
/// Alta de un campo. Nace como versión vigente (<c>VigenteHasta = null</c>) desde
/// el instante de creación.
/// </summary>
public record CrearCampoRequest(
    Guid SeccionId,
    string Clave,
    string Etiqueta,
    TipoCampo TipoCampo,
    TipoCatalogo? TipoCatalogoRef,
    bool Requerido,
    string? Configuracion,
    int Orden);

/// <summary>
/// Edición en su lugar — solo lo que NO cambia la identidad ni las reglas de
/// tipado: <see cref="Campo.Clave"/>, <see cref="Campo.TipoCampo"/> y
/// <see cref="Campo.TipoCatalogoRef"/> solo se tocan creando una versión nueva.
/// </summary>
public record ActualizarCampoRequest(
    string Etiqueta,
    bool Requerido,
    string? Configuracion,
    int Orden);

/// <summary>
/// Versiona el campo: acuña un <see cref="Campo.Id"/> nuevo con la MISMA
/// <see cref="Campo.Clave"/> y le pone <see cref="Campo.VigenteHasta"/> a la fila
/// anterior. Es la única vía para cambiar tipo o catálogo de referencia.
/// </summary>
public record NuevaVersionCampoRequest(
    string Etiqueta,
    TipoCampo TipoCampo,
    TipoCatalogo? TipoCatalogoRef,
    bool Requerido,
    string? Configuracion,
    int Orden);
