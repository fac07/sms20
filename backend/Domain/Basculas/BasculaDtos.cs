namespace SmsBackend.Domain.Basculas;

public record BasculaDto(
    Guid Id,
    string Codigo,
    string Nombre,
    Guid CentroId,
    string? CentroNombre,
    TipoConexion TipoConexion,
    string? Puerto,
    string? Ip,
    int? PuertoTcp,
    int? Velocidad,
    int? BitsDatos,
    string? ModoComunicacion,
    bool Activa,
    bool Aprovisionada,
    bool TieneCodigoVigente,
    bool PermiteIngresoManual,
    decimal? PesoMinimoManual,
    decimal? PesoMaximoManual,
    DateTime? UltimaConexion);

/// <summary>
/// Configuración central de ingreso manual para una báscula. La toca solo el
/// administrador — es config, no una transacción de pesaje.
/// </summary>
public record ConfigurarIngresoManualRequest(
    bool PermiteIngresoManual,
    decimal? PesoMinimoManual,
    decimal? PesoMaximoManual);

public record GuardarBasculaRequest(
    string Codigo,
    string Nombre,
    Guid CentroId,
    TipoConexion TipoConexion,
    string? Puerto,
    string? Ip,
    int? PuertoTcp,
    int? Velocidad,
    int? BitsDatos,
    string? ModoComunicacion);

public record CodigoAprovisionamientoDto(string Codigo, DateTime Expira);

public record AprovisionarBasculaRequest(string Codigo);

public record AprovisionamientoDto(
    Guid BasculaId,
    string BasculaCodigo,
    string BasculaNombre,
    Guid CentroId,
    TipoConexion TipoConexion,
    string? Puerto,
    string? Ip,
    int? PuertoTcp,
    int? Velocidad,
    int? BitsDatos,
    string? ModoComunicacion,
    bool PermiteIngresoManual,
    decimal? PesoMinimoManual,
    decimal? PesoMaximoManual,
    // Clave HMAC (Base64) del QR de transferencia, o null si el servidor no la
    // tiene configurada. Solo viaja en esta respuesta de un solo uso — nunca en
    // el endpoint anónimo de configuración del centro. Las terminales
    // aprovisionadas ANTES de este campo no la tienen (no hay re-fetch) y
    // siguen imprimiendo QR sin firma.
    string? ClaveQr);
