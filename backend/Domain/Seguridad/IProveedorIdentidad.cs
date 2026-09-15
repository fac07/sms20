using System.Security.Claims;

namespace SmsBackend.Domain.Seguridad;

/// <summary>
/// Puerto hexagonal de identidad (design "Technical Approach"): el único
/// contrato que endpoints/guards/handler conocen. Hoy lo implementa
/// <see cref="MockProveedorIdentidad"/>; el swap a NAT_Seguridad/Entra ID
/// reemplaza SOLO la implementación, sin tocar ningún consumidor.
/// </summary>
public interface IProveedorIdentidad
{
    /// <summary>Null si el usuario no existe, está inactivo, o la clave no coincide — sin distinguir el motivo.</summary>
    Task<ResultadoLogin?> AutenticarAsync(string usuario, string clave, CancellationToken ct);

    /// <summary>Null si el token no existe, expiró, o fue revocado.</summary>
    Task<ClaimsPrincipal?> ResolverPrincipalAsync(string token, CancellationToken ct);

    /// <summary>Revoca una sesión (logout). Idempotente: revocar un token ya revocado o inexistente no falla.</summary>
    Task RevocarAsync(string token, CancellationToken ct);
}

/// <summary>Resultado de un login exitoso — lo que <c>POST /api/auth/login</c> (PR2) devuelve al cliente.</summary>
public sealed record ResultadoLogin(string Token, Guid UsuarioId, string NombreUsuario, Rol Rol);
