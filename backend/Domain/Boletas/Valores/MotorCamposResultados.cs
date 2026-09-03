using SmsBackend.Domain.Configuracion;
using SmsBackend.Domain.Maestros;

namespace SmsBackend.Domain.Boletas.Valores;

/// <summary>
/// Un campo que aplica a una boleta, resuelto como función pura de
/// <c>(TipoMovimientoId, asOf)</c> — sin tabla de snapshot. Trae ya resueltos
/// la cardinalidad de la sección y si la sección es requerida para ese tipo de
/// movimiento, para que el motor no vuelva a la BD por cada chequeo.
/// </summary>
public sealed record CampoAplicable(
    Guid CampoId,
    Guid SeccionId,
    string SeccionClave,
    string CampoClave,
    string Etiqueta,
    TipoCampo TipoCampo,
    TipoCatalogo? TipoCatalogoRef,
    bool Requerido,
    Cardinalidad Cardinalidad,
    bool SeccionRequerida,
    string? Configuracion);

/// <summary>
/// Error de validación por campo/ocurrencia. El motor devuelve una lista de
/// estos (resultado de dominio); los endpoints deciden el shape HTTP.
/// </summary>
public sealed record ErrorCampo(
    string SeccionClave,
    string CampoClave,
    int Ocurrencia,
    string Mensaje);
