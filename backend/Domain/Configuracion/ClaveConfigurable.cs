using System.Text.RegularExpressions;

namespace SmsBackend.Domain.Configuracion;

/// <summary>
/// Regla de formato para las claves estables de <see cref="Seccion"/> y
/// <see cref="Campo"/>. Validada al escribir (design D8) para que el cambio de
/// sábana (fuera de alcance) — que arma nombres de columna <c>{seccion}_{campo}</c>
/// a partir de estas claves — herede datos a prueba de inyección.
/// </summary>
public static partial class ClaveConfigurable
{
    public const string Formato =
        "minúsculas, empieza con letra y solo admite [a-z0-9_], máximo 50 caracteres";

    [GeneratedRegex("^[a-z][a-z0-9_]{0,49}$")]
    private static partial Regex Patron();

    public static bool EsValida(string? clave) => clave is not null && Patron().IsMatch(clave);
}
