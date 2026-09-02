using System.Text.Json;
using SmsBackend.Domain.Maestros;

namespace SmsBackend.Domain.Configuracion;

/// <summary>
/// Chequeos de escritura de un <see cref="Campo"/> (design D3 + "TipoCatalogoRef
/// solo para ReferenciaMaestro"). Devuelve el mensaje de error, o <c>null</c> si
/// la definición es válida. Se corre al crear y al versionar, así que el motor
/// de cierre nunca ve JSON malformado ni claves de config incompatibles.
/// </summary>
public static class ValidacionCampo
{
    // Qué claves de ConfiguracionCampo tienen sentido para cada TipoCampo.
    private static readonly IReadOnlyDictionary<TipoCampo, string[]> ClavesPermitidas =
        new Dictionary<TipoCampo, string[]>
        {
            [TipoCampo.Texto] = new[] { "maxLength", "regex" },
            [TipoCampo.Lista] = new[] { "opciones", "maxLength" },
            [TipoCampo.Entero] = new[] { "min", "max" },
            [TipoCampo.Decimal] = new[] { "min", "max", "decimales", "unidad" },
            [TipoCampo.Fecha] = Array.Empty<string>(),
            [TipoCampo.FechaHora] = Array.Empty<string>(),
            [TipoCampo.Booleano] = Array.Empty<string>(),
            [TipoCampo.ReferenciaMaestro] = Array.Empty<string>(),
        };

    public static string? Validar(TipoCampo tipo, TipoCatalogo? catalogoRef, string? configuracion)
    {
        if (catalogoRef is not null && tipo != TipoCampo.ReferenciaMaestro)
        {
            return "TipoCatalogoRef solo se puede definir cuando TipoCampo es ReferenciaMaestro.";
        }

        if (tipo == TipoCampo.ReferenciaMaestro && catalogoRef is null)
        {
            return "TipoCampo ReferenciaMaestro requiere un TipoCatalogoRef.";
        }

        return ValidarConfiguracion(tipo, configuracion);
    }

    private static string? ValidarConfiguracion(TipoCampo tipo, string? configuracion)
    {
        if (string.IsNullOrWhiteSpace(configuracion))
        {
            return tipo == TipoCampo.Lista
                ? "Un campo Lista requiere una configuración con 'opciones' no vacías."
                : null;
        }

        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(configuracion);
        }
        catch (JsonException)
        {
            return "La configuración no es JSON válido.";
        }

        using (doc)
        {
            if (doc.RootElement.ValueKind != JsonValueKind.Object)
            {
                return "La configuración debe ser un objeto JSON.";
            }

            var permitidas = ClavesPermitidas[tipo];
            foreach (var prop in doc.RootElement.EnumerateObject())
            {
                var conocida = permitidas.Any(
                    k => string.Equals(k, prop.Name, StringComparison.OrdinalIgnoreCase));
                if (!conocida)
                {
                    return $"La clave de configuración '{prop.Name}' no aplica a un campo {tipo}.";
                }
            }
        }

        if (!ConfiguracionCampo.TryParse(configuracion, out var cfg))
        {
            return "La configuración no se pudo interpretar.";
        }

        if (tipo == TipoCampo.Lista && (cfg?.Opciones is null || cfg.Opciones.Count == 0))
        {
            return "Un campo Lista requiere 'opciones' no vacías.";
        }

        return null;
    }
}
