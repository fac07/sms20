namespace SmsBackend.Domain.Boletas;

/// <summary>
/// Catálogo fijo de motivos por los que un peso se tipeó manualmente en lugar
/// de leerlo del indicador. Es una lista cerrada en código (decisión de
/// producto #6): sin pantalla de administración, sin sincronización — cambiarla
/// es un despliegue. El renderer mapea el código a su etiqueta en español.
/// </summary>
public enum MotivoPesoManual
{
    /// <summary>"indicador sin señal".</summary>
    IndicadorSinSenal,

    /// <summary>"indicador en reparación".</summary>
    IndicadorEnReparacion,

    /// <summary>"corte de energía".</summary>
    CorteEnergia,

    /// <summary>"otro" — requiere el detalle de texto libre.</summary>
    Otro,
}

/// <summary>
/// Utilidades de parseo del catálogo <see cref="MotivoPesoManual"/>. El backend
/// mantiene su propio enum (no puede importar el <c>MOTIVOS_PESO_MANUAL</c> de
/// <c>db.ts</c>); la duplicación de los 4 valores entre runtimes está fijada por
/// los tests de ingesta de sync.
/// </summary>
public static class MotivosPesoManual
{
    /// <summary>
    /// Intenta resolver un código de catálogo. Rechaza null/blanco, cadenas
    /// numéricas y cualquier valor que no sea uno de los 4 nombres definidos.
    /// </summary>
    public static bool TryParse(string? valor, out MotivoPesoManual motivo)
    {
        motivo = default;
        if (string.IsNullOrWhiteSpace(valor) || valor.All(char.IsDigit))
        {
            return false;
        }

        return Enum.TryParse(valor, ignoreCase: true, out motivo) && Enum.IsDefined(motivo);
    }
}
