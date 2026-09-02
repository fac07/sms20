namespace SmsBackend.Domain.Configuracion;

/// <summary>
/// Bloque de campos configurable (transporte, calidad, marchamos, ...). Reemplaza
/// las pantallas fijas por transacción del legacy. Estado replicado central→báscula
/// por marca de agua, igual que Maestro.
/// </summary>
public class Seccion
{
    public Guid Id { get; set; }

    /// <summary>Identificador estable en snake_case. Único. No cambia entre versiones.</summary>
    public string Clave { get; set; } = string.Empty;

    public string Nombre { get; set; } = string.Empty;

    public Cardinalidad Cardinalidad { get; set; }

    /// <summary>Si la sección alimenta reportes (sábana) o es solo captura operativa.</summary>
    public bool Reportable { get; set; }

    /// <summary>
    /// Sección del set estándar (ver <see cref="SeccionEstandar"/>). Con esto en 1
    /// el <c>GuardiaEstandar</c> bloquea renombrar la clave, desactivar y borrar.
    /// </summary>
    public bool Estandar { get; set; }

    public int Orden { get; set; }

    public bool Activa { get; set; } = true;
}
