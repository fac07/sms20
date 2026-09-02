using System.Text.Json;

namespace SmsBackend.Domain.Configuracion;

/// <summary>
/// Forma parseada de <see cref="Campo.Configuracion"/> (JSON crudo). Union de
/// todas las claves posibles; qué subconjunto es válido depende del
/// <see cref="TipoCampo"/> y lo valida el endpoint de administración al escribir
/// (design D3), así que el motor de cierre nunca ve JSON malformado.
/// </summary>
public sealed record ConfiguracionCampo(
    int? MaxLength,
    string? Regex,
    decimal? Min,
    decimal? Max,
    int? Decimales,
    string? Unidad,
    IReadOnlyList<string>? Opciones)
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    /// <summary>
    /// Devuelve <c>null</c> cuando la cadena es nula o vacía. Lanza
    /// <see cref="JsonException"/> si el JSON está malformado — la validación de
    /// escritura (D3) garantiza que eso no llegue al motor de cierre.
    /// </summary>
    public static ConfiguracionCampo? Parse(string? configuracion)
    {
        if (string.IsNullOrWhiteSpace(configuracion))
        {
            return null;
        }

        return JsonSerializer.Deserialize<ConfiguracionCampo>(configuracion, SerializerOptions);
    }

    /// <summary>Igual que <see cref="Parse"/> pero devuelve <c>false</c> en vez de lanzar.</summary>
    public static bool TryParse(string? configuracion, out ConfiguracionCampo? resultado)
    {
        try
        {
            resultado = Parse(configuracion);
            return true;
        }
        catch (JsonException)
        {
            resultado = null;
            return false;
        }
    }
}
