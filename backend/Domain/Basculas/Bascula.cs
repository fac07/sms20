namespace SmsBackend.Domain.Basculas;

/// <summary>
/// Una fila por punto de pesaje físico. Soporta las dos vías de lectura que
/// ya existen en planta: serial y TCP/IP — confirmado contra
/// clsConexionBasculaSERIAL_COM.cs y clsConexionBasculaMT_Continuo.cs del
/// legacy (la variante SERIAL_COM es la que realmente corre en producción,
/// no clsConexionBasculaSERIAL.cs).
/// </summary>
public class Bascula
{
    public Guid Id { get; set; }

    /// <summary>Namespace del correlativo de Boleta — dos básculas offline nunca colisionan.</summary>
    public string Codigo { get; set; } = string.Empty;

    public string Nombre { get; set; } = string.Empty;

    /// <summary>FK lógica hacia Maestro (TipoCatalogo = Centro).</summary>
    public Guid CentroId { get; set; }

    public TipoConexion TipoConexion { get; set; }

    /// <summary>COM3, etc. — solo si TipoConexion = Serial.</summary>
    public string? Puerto { get; set; }

    /// <summary>Solo si TipoConexion = Ethernet.</summary>
    public string? Ip { get; set; }

    public int? PuertoTcp { get; set; }

    /// <summary>Baudrate del puerto serial.</summary>
    public int? Velocidad { get; set; }

    public int? BitsDatos { get; set; }

    /// <summary>Protocolo del indicador: serial con STX o transmisión continua tipo MT.</summary>
    public string? ModoComunicacion { get; set; }

    public bool Activa { get; set; } = true;

    // --- Aprovisionamiento (primer arranque de Electron) ---

    /// <summary>Código corto de un solo uso, generado por el admin al pre-registrar la báscula.</summary>
    public string? CodigoAprovisionamiento { get; set; }

    /// <summary>El código deja de servir después de esta fecha, aunque nadie lo haya usado.</summary>
    public DateTime? CodigoAprovisionamientoExpira { get; set; }

    /// <summary>Pasa a verdadero en el primer arranque exitoso — el código ya no sirve después de eso.</summary>
    public bool Aprovisionada { get; set; }
}
