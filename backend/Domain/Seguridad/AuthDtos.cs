namespace SmsBackend.Domain.Seguridad;

/// <summary>Credenciales para <c>POST /api/auth/login</c> (design D3) — validadas contra <see cref="Usuario"/> sembrado por <see cref="Data.Seeding.SeguridadSeeder"/>.</summary>
public sealed record LoginRequest(string NombreUsuario, string Clave);

/// <summary>
/// Identidad actual para <c>GET /api/auth/yo</c> — el frontend (PR8/9) la usa
/// para decidir qué mostrar sin decodificar el token él mismo. <see cref="Centros"/>
/// vacío + <see cref="Alcance"/> <c>"global"</c> es Administrador; nunca ambiguo
/// con un usuario Operador/Supervisor mal configurado (design D2).
/// </summary>
public sealed record YoResponse(Guid UsuarioId, string NombreUsuario, Rol Rol, IReadOnlyList<Guid> Centros, string Alcance);
