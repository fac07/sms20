using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using SmsBackend.Data;
using SmsBackend.Data.Seeding;

namespace SmsBackend.Domain.Seguridad;

/// <summary>
/// Adapter mock de <see cref="IProveedorIdentidad"/> (design D1/D3): usuario y
/// clave contra <see cref="Usuario"/> sembrado por <see cref="SeguridadSeeder"/>,
/// sesión persistida en <see cref="SesionMock"/> con token opaco de 256 bits
/// (nunca un JWT firmado). Es el ÚNICO archivo que el swap a
/// NAT_Seguridad/Entra ID reemplaza — nada más en el backend referencia esta
/// clase directamente, solo el puerto.
/// </summary>
public sealed class MockProveedorIdentidad(SmsDbContext db) : IProveedorIdentidad
{
    private static readonly TimeSpan DuracionSesion = TimeSpan.FromHours(8);

    public async Task<ResultadoLogin?> AutenticarAsync(string usuario, string clave, CancellationToken ct)
    {
        var candidato = await db.Usuarios
            .FirstOrDefaultAsync(u => u.NombreUsuario == usuario && u.Activo, ct);

        // Mismo resultado (null) para "no existe" y "clave incorrecta" — el
        // llamador no debe poder distinguir cuál de los dos pasó.
        if (candidato is null || candidato.ClaveHash != SeguridadSeeder.HashClaveMock(clave))
        {
            return null;
        }

        var ahora = DateTime.UtcNow;
        var sesion = new SesionMock
        {
            Id = Guid.NewGuid(),
            Token = GenerarToken(),
            UsuarioId = candidato.Id,
            CreadaEn = ahora,
            ExpiraEn = ahora + DuracionSesion,
            RevocadaEn = null,
        };
        db.SesionesMock.Add(sesion);
        await db.SaveChangesAsync(ct);

        return new ResultadoLogin(sesion.Token, candidato.Id, candidato.NombreUsuario, candidato.Rol);
    }

    public async Task<ClaimsPrincipal?> ResolverPrincipalAsync(string token, CancellationToken ct)
    {
        var ahora = DateTime.UtcNow;
        var sesion = await db.SesionesMock.FirstOrDefaultAsync(s => s.Token == token, ct);

        if (sesion is null || sesion.RevocadaEn is not null || sesion.ExpiraEn <= ahora)
        {
            return null;
        }

        var usuario = await db.Usuarios.FirstOrDefaultAsync(u => u.Id == sesion.UsuarioId && u.Activo, ct);
        if (usuario is null)
        {
            return null;
        }

        var centros = await db.UsuariosCentro
            .Where(uc => uc.UsuarioId == usuario.Id)
            .Select(uc => uc.CentroId)
            .ToListAsync(ct);

        // El alcance sale del ROL, no de "cuántos centros tiene" (design D2):
        // así "cero claims sms20/centro" nunca puede leerse como "es global"
        // para un Operador/Supervisor mal configurado — falla cerrado.
        var alcance = usuario.Rol == Rol.Administrador ? ClaimsSms20.AlcanceGlobal : ClaimsSms20.AlcanceAsignado;

        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, usuario.NombreUsuario),
            new(ClaimsSms20.UsuarioId, usuario.Id.ToString()),
            new(ClaimsSms20.Rol, usuario.Rol.ToString()),
            new(ClaimsSms20.CentroAlcance, alcance),
        };
        claims.AddRange(centros.Select(centroId => new Claim(ClaimsSms20.Centro, centroId.ToString())));

        var identity = new ClaimsIdentity(claims, authenticationType: "sms20-mock");
        return new ClaimsPrincipal(identity);
    }

    public async Task RevocarAsync(string token, CancellationToken ct)
    {
        var sesion = await db.SesionesMock.FirstOrDefaultAsync(s => s.Token == token, ct);
        if (sesion is null || sesion.RevocadaEn is not null)
        {
            return;
        }

        sesion.RevocadaEn = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
    }

    /// <summary>256 bits de aleatoriedad criptográfica, hex — nunca un JWT firmado (design D3).</summary>
    private static string GenerarToken() => Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
}
