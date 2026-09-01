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
    bool TieneCodigoVigente);

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
    string? ModoComunicacion);
