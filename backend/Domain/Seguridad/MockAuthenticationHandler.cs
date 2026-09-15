using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace SmsBackend.Domain.Seguridad;

/// <summary>Opciones del scheme mock — vacío hoy, existe para que el swap a un scheme real no cambie la forma del registro.</summary>
public sealed class MockAuthenticationOptions : AuthenticationSchemeOptions
{
    /// <summary>Nombre del scheme registrado en <c>Program.cs</c>.</summary>
    public const string SchemeName = "Sms20Mock";
}

/// <summary>
/// Traduce <c>Authorization: Bearer &lt;token&gt;</c> en un <see cref="System.Security.Claims.ClaimsPrincipal"/>
/// vía <see cref="IProveedorIdentidad"/> (design "Technical Approach"). Es el
/// ÚNICO lugar del pipeline que sabe que el token es opaco y vive en
/// <see cref="SesionMock"/> — el swap a Entra ID reemplaza este handler por
/// uno JWT Bearer estándar, sin tocar políticas ni endpoints.
///
/// Registrado en <c>Program.cs</c> en este PR (0.8); todavía sin
/// <c>UseAuthentication()</c>/<c>UseAuthorization()</c> en el pipeline HTTP —
/// eso y el primer endpoint gateado llegan en PR2 (Phase 1).
/// </summary>
public sealed class MockAuthenticationHandler(
    IOptionsMonitor<MockAuthenticationOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    IProveedorIdentidad proveedor)
    : AuthenticationHandler<MockAuthenticationOptions>(options, logger, encoder)
{
    private const string EsquemaBearer = "Bearer ";

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Headers.TryGetValue("Authorization", out var valores))
        {
            return AuthenticateResult.NoResult();
        }

        var encabezado = valores.ToString();
        if (!encabezado.StartsWith(EsquemaBearer, StringComparison.OrdinalIgnoreCase))
        {
            return AuthenticateResult.NoResult();
        }

        var token = encabezado[EsquemaBearer.Length..].Trim();
        if (string.IsNullOrWhiteSpace(token))
        {
            return AuthenticateResult.Fail("Token vacío.");
        }

        var principal = await proveedor.ResolverPrincipalAsync(token, Context.RequestAborted);
        if (principal is null)
        {
            return AuthenticateResult.Fail("Token inválido, expirado o revocado.");
        }

        var ticket = new AuthenticationTicket(principal, MockAuthenticationOptions.SchemeName);
        return AuthenticateResult.Success(ticket);
    }
}
