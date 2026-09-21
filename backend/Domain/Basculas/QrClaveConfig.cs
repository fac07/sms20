namespace SmsBackend.Domain.Basculas;

/// <summary>
/// Clave HMAC única de la empresa que firma el QR de transferencia (una sola
/// para todos los centros: una planta receptora debe poder verificar un QR
/// firmado por otra). Vive en la configuración del servidor
/// (<c>Qr:ClaveHmac</c> — variable de entorno <c>Qr__ClaveHmac</c> o
/// user-secrets), NUNCA en la DB ni en un appsettings versionado.
/// </summary>
public static class QrClaveConfig
{
    public const string Clave = "Qr:ClaveHmac";
    public const int BytesMinimos = 32;

    private static int _advertida;

    /// <summary>
    /// Devuelve la clave tal como está configurada (Base64) si es válida (Base64
    /// de al menos <see cref="BytesMinimos"/> bytes); si falta o está malformada,
    /// null — el terminal sigue imprimiendo QR sin firma, como antes. Advierte
    /// una sola vez por proceso y nunca vuelca la clave al log.
    /// </summary>
    public static string? Obtener(IConfiguration configuration, ILogger logger)
    {
        var valor = configuration[Clave]?.Trim();
        if (EsValida(valor)) return valor;

        if (Interlocked.Exchange(ref _advertida, 1) == 0)
        {
            logger.LogWarning(
                "{Clave} no está configurada o es inválida (Base64 de al menos {Bytes} bytes); " +
                "los terminales aprovisionados no recibirán clave y imprimirán QR sin firma.",
                Clave, BytesMinimos);
        }
        return null;
    }

    private static bool EsValida(string? valor)
    {
        if (string.IsNullOrEmpty(valor)) return false;
        var buffer = new byte[valor.Length];
        return Convert.TryFromBase64String(valor, buffer, out var escritos) && escritos >= BytesMinimos;
    }
}
