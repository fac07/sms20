namespace SmsBackend.Domain.Boletas.Marchamos;

public sealed record BoletaMarchamoDto(
    int Ocurrencia,
    string Numero,
    string? Placa,
    Guid? EquipoId,
    bool Activo,
    string? Observaciones);

public sealed record BoletaMarchamosResponse(
    string RowVersion,
    IReadOnlyList<BoletaMarchamoDto> Marchamos);

public sealed record AgregarBoletaMarchamoRequest(
    string Numero,
    string? Placa,
    Guid? EquipoId,
    bool Activo,
    string? Observaciones,
    string ObservacionCambio,
    string RowVersion);

public sealed record RectificarBoletaMarchamoRequest(
    string Numero,
    bool Activo,
    string? Observaciones,
    string ObservacionCambio,
    string RowVersion);
