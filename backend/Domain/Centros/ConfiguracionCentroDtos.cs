namespace SmsBackend.Domain.Centros;

/// <summary>
/// Estado de la config de transferencia de un Centro. GET la devuelve SIEMPRE
/// (200) para un centro válido: sin fila de configuración = los cuatro
/// defaults nulos. Así el config-sync de la terminal puede distinguir "sin
/// default" (guardar nulls, el formulario abre limpio) de "no existe el
/// centro" (404, saltear este tick), y un borrado del admin (PUT con nulls)
/// viaja igual que un alta.
/// </summary>
public record ConfiguracionCentroDto(
    Guid CentroId,
    Guid? SitioOrigenDefaultId,
    Guid? SitioDestinoDefaultId,
    Guid? AlmacenOrigenDefaultId,
    Guid? AlmacenDestinoDefaultId);

/// <summary>
/// Upsert completo de la config (PUT). Campo nulo = "sin default para ese
/// rol" — no "dejarlo como estaba": el PUT es un reemplazo total y
/// declarativo, mismo posture que <c>PUT /{id}/ingreso-manual</c> de
/// básculas.
/// </summary>
public record GuardarConfiguracionCentroRequest(
    Guid? SitioOrigenDefaultId,
    Guid? SitioDestinoDefaultId,
    Guid? AlmacenOrigenDefaultId,
    Guid? AlmacenDestinoDefaultId);
