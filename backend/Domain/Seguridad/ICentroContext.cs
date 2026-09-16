namespace SmsBackend.Domain.Seguridad;

/// <summary>
/// Puerto de alcance de Centro (design D6), resuelto desde los claims
/// <see cref="ClaimsSms20.Centro"/>/<see cref="ClaimsSms20.CentroAlcance"/>
/// del <see cref="System.Security.Claims.ClaimsPrincipal"/> vigente — el
/// mismo principal que <see cref="MockAuthenticationHandler"/> materializa
/// (PR1). Cubre dos escenarios que el filtro de lectura global de
/// <c>SmsDbContext</c> NO alcanza (design D6, "Two gaps"): escrituras que
/// reciben un <c>CentroId</c> ajeno en el body, y cualquier chequeo
/// explícito fuera de una query EF.
/// </summary>
public interface ICentroContext
{
    /// <summary>True para Administrador (alcance global, design D2) — sin restricción por Centro.</summary>
    bool EsGlobal { get; }

    /// <summary>Centros autorizados para el principal vigente. Vacío para Administrador (ver <see cref="EsGlobal"/>) y para un principal anónimo.</summary>
    IReadOnlyCollection<Guid> Permitidos { get; }

    /// <summary>
    /// Chequea un <paramref name="centroId"/> recibido en el body de una
    /// escritura (los filtros de lectura no ven el body). Mismo contrato que
    /// un Guard: <c>null</c> = autorizado, seguir; no-<c>null</c> = el
    /// <see cref="IResult"/> (403) a devolver tal cual.
    /// </summary>
    IResult? Autorizar(Guid centroId);
}
