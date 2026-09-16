using Microsoft.AspNetCore.Http;

namespace SmsBackend.Domain.Seguridad;

/// <summary>
/// Implementación de <see cref="ICentroContext"/> vía
/// <see cref="IHttpContextAccessor"/> (scoped, igual ciclo de vida que
/// <c>SmsDbContext</c> — design D6/"Technical Approach"). Se eligió el
/// accessor en vez de inyectar <see cref="System.Security.Claims.ClaimsPrincipal"/>
/// directamente porque <c>SmsDbContext.OnModelCreating</c> arma los
/// <c>HasQueryFilter</c> una sola vez al construir el modelo, pero cada
/// request tiene un principal distinto — el accessor difiere la lectura del
/// principal hasta que <see cref="EsGlobal"/>/<see cref="Permitidos"/> se
/// evalúan de verdad, dentro de la traducción de cada query.
///
/// Sin <see cref="IHttpContextAccessor.HttpContext"/> (fuera de un request
/// HTTP, p.ej. el seeder en el arranque) o sin principal autenticado, se
/// falla cerrado: <see cref="EsGlobal"/> es <c>false</c> y
/// <see cref="Permitidos"/> está vacío — ningún Centro pasa. Los 4
/// endpoints de dispositivo/sync que corren sin principal humano bypasean
/// esto explícitamente con <c>.IgnoreQueryFilters()</c> (design D6, "device
/// endpoints"), nunca relajando este fallback.
/// </summary>
public sealed class CentroContext(IHttpContextAccessor httpContextAccessor) : ICentroContext
{
    public bool EsGlobal =>
        httpContextAccessor.HttpContext?.User.FindFirst(ClaimsSms20.CentroAlcance)?.Value
            == ClaimsSms20.AlcanceGlobal;

    public IReadOnlyCollection<Guid> Permitidos =>
        httpContextAccessor.HttpContext?.User.FindAll(ClaimsSms20.Centro)
            .Select(c => Guid.Parse(c.Value))
            .ToArray()
        ?? Array.Empty<Guid>();

    public IResult? Autorizar(Guid centroId) =>
        EsGlobal || Permitidos.Contains(centroId)
            ? null
            : Results.StatusCode(StatusCodes.Status403Forbidden);
}
