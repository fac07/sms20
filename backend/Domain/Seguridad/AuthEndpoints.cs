using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;

namespace SmsBackend.Domain.Seguridad;

/// <summary>
/// Vertical slice de autenticación (design D3, PR2 Phase 1): <c>login</c> emite
/// el token opaco real de <see cref="IProveedorIdentidad"/> — nunca un header
/// fijo mockeado —, <c>logout</c> revoca la sesión (<see cref="SesionMock"/>),
/// <c>yo</c> devuelve la identidad actual leyendo el
/// <see cref="ClaimsPrincipal"/> que <see cref="MockAuthenticationHandler"/>
/// ya sabe materializar desde el bearer token.
///
/// <c>logout</c> y <c>yo</c> autentican explícitamente vía
/// <c>HttpContext.AuthenticateAsync()</c> (esquema DEFAULT, sin nombrarlo) en
/// vez de depender de <c>.RequireAuthorization()</c> + el pipeline: eso los
/// hace testeables ya en este PR, antes de que <c>UseAuthentication()</c>/
/// <c>UseAuthorization()</c> se agreguen al pipeline HTTP (paso 1.4), y sigue
/// sin nombrar el scheme mock en ningún lado — el swap a Entra ID solo cambia
/// el registro en <c>Program.cs</c>, nunca este archivo.
/// </summary>
public static class AuthEndpoints
{
    private const string EsquemaBearer = "Bearer ";

    public static RouteGroupBuilder MapAuth(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/auth").WithTags("Auth");

        group.MapPost("/login", async (LoginRequest request, IProveedorIdentidad proveedor, CancellationToken ct) =>
        {
            var resultado = await proveedor.AutenticarAsync(request.NombreUsuario, request.Clave, ct);
            return resultado is null ? Results.Unauthorized() : Results.Ok(resultado);
        });

        group.MapPost("/logout", async (HttpContext context, IProveedorIdentidad proveedor, CancellationToken ct) =>
        {
            // Idempotente incluso sin token o con un token ya revocado —
            // RevocarAsync no distingue el caso (design D3, IProveedorIdentidad).
            var token = ExtraerToken(context);
            if (token is not null)
            {
                await proveedor.RevocarAsync(token, ct);
            }

            return Results.Ok();
        });

        group.MapGet("/yo", async (HttpContext context) =>
        {
            var resultado = await context.AuthenticateAsync();
            if (!resultado.Succeeded || resultado.Principal is null)
            {
                return Results.Unauthorized();
            }

            var principal = resultado.Principal;
            var usuarioId = Guid.Parse(principal.FindFirstValue(ClaimsSms20.UsuarioId)!);
            var nombreUsuario = principal.FindFirstValue(ClaimTypes.NameIdentifier)!;
            var rol = Enum.Parse<Rol>(principal.FindFirstValue(ClaimsSms20.Rol)!);
            var centros = principal.FindAll(ClaimsSms20.Centro).Select(c => Guid.Parse(c.Value)).ToList();
            var alcance = principal.FindFirstValue(ClaimsSms20.CentroAlcance)!;

            return Results.Ok(new YoResponse(usuarioId, nombreUsuario, rol, centros, alcance));
        });

        return group;
    }

    /// <summary>Mismo parseo de <c>Authorization: Bearer &lt;token&gt;</c> que <see cref="MockAuthenticationHandler"/> — no depende de la autenticación del pipeline.</summary>
    private static string? ExtraerToken(HttpContext context)
    {
        if (!context.Request.Headers.TryGetValue("Authorization", out var valores))
        {
            return null;
        }

        var encabezado = valores.ToString();
        if (!encabezado.StartsWith(EsquemaBearer, StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        var token = encabezado[EsquemaBearer.Length..].Trim();
        return string.IsNullOrWhiteSpace(token) ? null : token;
    }
}
