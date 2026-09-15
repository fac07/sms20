using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using SmsBackend.Domain.Seguridad;

namespace SmsBackend.Data.Seeding;

/// <summary>
/// Siembra un usuario mock fijo por rol (design "Mock data source: seeded EF
/// tables"), pensado para que QA/el cliente pueda reprobar cualquier rol con
/// las credenciales fijas de abajo sin redeploy. Idempotente por
/// <c>NombreUsuario</c>: inserta si falta, NUNCA actualiza una fila existente
/// — misma regla que <see cref="ConfiguracionSeeder"/>, para no pisar una
/// clave que el cliente ya haya rotado a mano. Corre una vez al arrancar,
/// después de <c>MigrateAsync()</c>. Ante cualquier falla loguea y sigue, no
/// tira la app.
///
/// Cardinalidad Centro por rol (spec autorizacion-roles): Operador → 1 Centro
/// fijo, Supervisor → N Centros, Administrador → 0 filas (alcance global). En
/// PR1 estos Centros son Guids fijos sin fila de Maestro correspondiente — el
/// filtrado real por Centro (y su validación) llega en PR3; acá solo importa
/// que el claim se materialice con la forma correcta.
/// </summary>
public static class SeguridadSeeder
{
    private sealed record UsuarioSeed(string NombreUsuario, string NombreCompleto, string Clave, Rol Rol, Guid[] Centros);

    // Centros fijos de prueba — sin fila Maestro asociada en PR1 (ver comentario
    // de clase). Valores estables entre corridas para que un test pueda
    // referenciarlos si hiciera falta.
    private static readonly Guid CentroA = new("11111111-1111-1111-1111-111111111111");
    private static readonly Guid CentroB = new("22222222-2222-2222-2222-222222222222");

    private static readonly IReadOnlyList<UsuarioSeed> Usuarios = new[]
    {
        new UsuarioSeed("operador", "Operador de prueba", "Operador123!", Rol.Operador, new[] { CentroA }),
        new UsuarioSeed("supervisor", "Supervisor de prueba", "Supervisor123!", Rol.Supervisor, new[] { CentroA, CentroB }),
        new UsuarioSeed("administrador", "Administrador de prueba", "Administrador123!", Rol.Administrador, Array.Empty<Guid>()),
    };

    public static async Task SeedAsync(SmsDbContext db, ILogger logger, CancellationToken ct = default)
    {
        try
        {
            if (!await db.Database.CanConnectAsync(ct))
            {
                logger.LogWarning("SeguridadSeeder: sin conexión a la base; se omite el seeding.");
                return;
            }

            if ((await db.Database.GetPendingMigrationsAsync(ct)).Any())
            {
                logger.LogWarning("SeguridadSeeder: hay migraciones pendientes; se omite el seeding.");
                return;
            }

            var creados = 0;

            foreach (var seed in Usuarios)
            {
                var existente = await db.Usuarios
                    .FirstOrDefaultAsync(u => u.NombreUsuario == seed.NombreUsuario, ct);

                if (existente is not null)
                {
                    logger.LogInformation(
                        "SeguridadSeeder: usuario '{NombreUsuario}' ya presente, se omite (no se actualiza).",
                        seed.NombreUsuario);
                    continue;
                }

                var usuario = new Usuario
                {
                    Id = Guid.NewGuid(),
                    NombreUsuario = seed.NombreUsuario,
                    NombreCompleto = seed.NombreCompleto,
                    ClaveHash = HashClaveMock(seed.Clave),
                    Rol = seed.Rol,
                    Activo = true,
                };
                db.Usuarios.Add(usuario);

                foreach (var centroId in seed.Centros)
                {
                    db.UsuariosCentro.Add(new UsuarioCentro
                    {
                        UsuarioId = usuario.Id,
                        CentroId = centroId,
                    });
                }

                creados++;
                logger.LogInformation("SeguridadSeeder: creando usuario mock '{NombreUsuario}' ({Rol}).",
                    seed.NombreUsuario, seed.Rol);
            }

            if (creados > 0)
            {
                await db.SaveChangesAsync(ct);
            }

            logger.LogInformation(
                "SeguridadSeeder: {Creados} usuarios creados. Total esperado: {Total} usuarios mock.",
                creados, Usuarios.Count);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "SeguridadSeeder: el seeding falló; se omite y el arranque continúa.");
        }
    }

    /// <summary>
    /// Hash mock de un solo sentido (SHA-256 hex) — solo para el adapter
    /// throwaway (design D3), reutilizado también por
    /// <see cref="Domain.Seguridad.MockProveedorIdentidad"/> para validar login.
    /// El proveedor real nunca almacena ni valida claves en SMS20.
    /// </summary>
    internal static string HashClaveMock(string clave)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(clave));
        return Convert.ToHexString(bytes);
    }
}
