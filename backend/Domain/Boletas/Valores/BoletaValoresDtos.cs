using SmsBackend.Domain.Configuracion;

namespace SmsBackend.Domain.Boletas.Valores;

/// <summary>
/// Representación ÚNICA de un valor capturado, compartida por <c>POST /api/boletas</c>
/// (crear tipado), la rama "Crear" de <c>/api/boletas/sync</c> y el write path de
/// <see cref="BoletaValorCampo"/>. Keyed por <see cref="CampoId"/> + <see cref="Ocurrencia"/>,
/// NUNCA por el par (clave de sección, clave de campo): el versionado reutiliza la
/// clave, así que re-resolver por clave en central rompería el candado
/// as-of-creation cuando el cache offline de una báscula está viejo.
/// </summary>
public record ValorCampoDto(
    Guid CampoId,
    int Ocurrencia,
    string? ValorTexto,
    decimal? ValorNumero,
    DateTime? ValorFecha,
    bool? ValorBooleano,
    Guid? ValorMaestroId);

/// <summary>
/// Proyección de lectura para <c>BoletaDto.Valores</c>. Agrega claves, el nombre
/// legible de la sección y la etiqueta del campo (para humanos y D365) además del
/// <see cref="CampoId"/> estable.
/// </summary>
public record ValorCampoLeidoDto(
    Guid CampoId,
    string SeccionClave,
    string SeccionNombre,
    string CampoClave,
    string Etiqueta,
    TipoCampo TipoCampo,
    int Ocurrencia,
    string? ValorTexto,
    decimal? ValorNumero,
    DateTime? ValorFecha,
    bool? ValorBooleano,
    Guid? ValorMaestroId,
    string? ValorMaestroCodigo,
    string? ValorMaestroNombre);
