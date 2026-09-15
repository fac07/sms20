namespace SmsBackend.Domain.Seguridad;

/// <summary>
/// Nombres de claim bajo namespace propio <c>sms20/</c> (design D2) —
/// deliberadamente NO <c>ClaimTypes.Role</c> ni el <c>roles</c> de Entra:
/// tomar prestado cualquiera de los dos hornea una asunción de proveedor en
/// los 61 call sites que consultan estos claims. <see cref="Rol"/> sí usa
/// <c>ClaimTypes.NameIdentifier</c> para el login/UPN — mismo shape que
/// <c>Boleta.UsuarioIngreso</c> ya guarda.
/// </summary>
public static class ClaimsSms20
{
    /// <summary>Guid estable de <see cref="Usuario.Id"/> — identidad app-owned, no cambia con el proveedor.</summary>
    public const string UsuarioId = "sms20/usuario-id";

    /// <summary>Valor único: <c>Operador</c> | <c>Supervisor</c> | <c>Administrador</c>.</summary>
    public const string Rol = "sms20/rol";

    /// <summary>Repetido: un claim por Centro autorizado. Cero claims para Administrador.</summary>
    public const string Centro = "sms20/centro";

    /// <summary><see cref="AlcanceGlobal"/> o <see cref="AlcanceAsignado"/> — nunca ambiguo con "cero claims sms20/centro".</summary>
    public const string CentroAlcance = "sms20/centro-alcance";

    public const string AlcanceGlobal = "global";

    public const string AlcanceAsignado = "asignado";
}
