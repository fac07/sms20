namespace SmsBackend.Domain.Boletas.Extensiones;

public record BoletaCalidadDto(
    Guid Id,
    Guid BoletaId,
    decimal? Acidez,
    decimal? Luz,
    decimal? DOBI,
    decimal? Humedad,
    decimal? Temperatura,
    string? NumeroRevisionQA);

public record GuardarBoletaCalidadRequest(
    decimal? Acidez,
    decimal? Luz,
    decimal? DOBI,
    decimal? Humedad,
    decimal? Temperatura,
    string? NumeroRevisionQA);

public record BoletaDetalleFrutaDto(
    Guid Id,
    Guid BoletaId,
    int RacimosVerdes,
    int RacimosMaduros,
    int RacimosSobreMaduros,
    int RacimosPasados,
    int PedunculoLargo);

public record GuardarBoletaDetalleFrutaRequest(
    int RacimosVerdes,
    int RacimosMaduros,
    int RacimosSobreMaduros,
    int RacimosPasados,
    int PedunculoLargo);

public record BoletaCaracteristicaDto(
    Guid Id,
    Guid BoletaId,
    Guid CaracteristicaId,
    string? CaracteristicaCodigo,
    string? CaracteristicaNombre,
    decimal Cantidad);

public record GuardarBoletaCaracteristicaRequest(
    Guid CaracteristicaId,
    decimal Cantidad);

public record BoletaComposteraDto(
    Guid Id,
    Guid BoletaId,
    string CUI,
    Guid CamaId,
    Guid SeccionId,
    Guid CicloId);

public record GuardarBoletaComposteraRequest(
    string CUI,
    Guid CamaId,
    Guid SeccionId,
    Guid CicloId);
