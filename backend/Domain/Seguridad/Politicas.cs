using Microsoft.AspNetCore.Authorization;

namespace SmsBackend.Domain.Seguridad;

/// <summary>
/// Tres políticas de rol jerárquico (design D4): Administrador ⊇ Supervisor ⊇
/// Operador — cada uno de los 61 endpoints elige UNA de estas tres
/// constantes vía <c>.RequireAuthorization(Politicas.X)</c>, mecánico y
/// greppable. Deliberadamente NO una política por endpoint (61 políticas
/// derivan sin que nadie pueda auditarlas) ni una política por dominio (el
/// eje equivocado: dentro de Maestros, GET es nivel Operador y DELETE es
/// nivel Admin — una política de dominio colapsaría al miembro más laxo).
///
/// El alcance de Centro NO es una política: un <see cref="IAuthorizationHandler"/>
/// no ve el body del request ni la query EF, así que codificar el alcance acá
/// sería teatro. Vive en <c>ICentroContext</c> (PR3).
/// </summary>
public static class Politicas
{
    public const string Operador = "Operador";
    public const string Supervisor = "Supervisor";
    public const string Administrador = "Administrador";

    /// <summary>Rango numérico del rol — mayor rango cumple las políticas de todo rango menor o igual.</summary>
    private static readonly IReadOnlyDictionary<Rol, int> Rango = new Dictionary<Rol, int>
    {
        [Rol.Operador] = 0,
        [Rol.Supervisor] = 1,
        [Rol.Administrador] = 2,
    };

    /// <summary>
    /// True si el claim <see cref="ClaimsSms20.Rol"/> del contexto tiene rango
    /// mayor o igual a <paramref name="minimo"/>. Sin claim de rol, o con un
    /// valor que no mapea a <see cref="Seguridad.Rol"/>, deniega — falla cerrado.
    /// </summary>
    public static bool CumpleRolMinimo(AuthorizationHandlerContext context, Rol minimo)
    {
        var valorRol = context.User.FindFirst(ClaimsSms20.Rol)?.Value;
        if (valorRol is null || !Enum.TryParse<Rol>(valorRol, out var rol))
        {
            return false;
        }

        return Rango[rol] >= Rango[minimo];
    }
}
