namespace SmsBackend.Domain.Seguridad;

/// <summary>
/// Sesión mock emitida por <c>POST /api/auth/login</c> (PR2): token opaco de
/// 256 bits guardado server-side (design D3) — nunca un JWT firmado con una
/// clave de firma que se pudiera filtrar. Soporta expiración y revocación
/// (logout), lo que obliga al frontend a construir YA el flujo
/// 401 → limpiar sesión → redirect que el proveedor real también exigirá.
/// </summary>
public class SesionMock
{
    public Guid Id { get; set; }

    /// <summary>Token opaco (256 bits, hex) — nunca un JWT firmado.</summary>
    public string Token { get; set; } = string.Empty;

    public Guid UsuarioId { get; set; }

    public DateTime CreadaEn { get; set; }

    public DateTime ExpiraEn { get; set; }

    /// <summary>Null = sigue viva. La setea el endpoint de logout (PR2).</summary>
    public DateTime? RevocadaEn { get; set; }
}
