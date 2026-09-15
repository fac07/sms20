namespace SmsBackend.Domain.Seguridad;

/// <summary>
/// Identidad humana mock (design D1/D3): fuente de verdad para login mientras
/// el proveedor real (NAT_Seguridad/Entra ID) no está integrado. Vive en tabla
/// EF sembrada, no en un fixture JSON — así el cliente reprueba cualquier rol
/// con un <c>UPDATE</c>, sin rebuild, y el mapeo Rol/Centro es dato app-owned
/// que SOBREVIVE el swap de proveedor (Entra entrega identidad, nunca el
/// alcance de Centro).
/// </summary>
public class Usuario
{
    public Guid Id { get; set; }

    /// <summary>Login — mismo shape que ya guarda <c>Boleta.UsuarioIngreso</c>.</summary>
    public string NombreUsuario { get; set; } = string.Empty;

    public string NombreCompleto { get; set; } = string.Empty;

    /// <summary>
    /// Hash de la clave mock (SHA-256 hex). Existe solo para este adapter
    /// throwaway (design D3) — el proveedor real nunca almacena ni valida
    /// claves acá; se descarta entero en el swap.
    /// </summary>
    public string ClaveHash { get; set; } = string.Empty;

    public Rol Rol { get; set; }

    public bool Activo { get; set; } = true;
}
