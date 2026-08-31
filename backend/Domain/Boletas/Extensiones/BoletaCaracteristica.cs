namespace SmsBackend.Domain.Boletas.Extensiones;

/// <summary>
/// Escape hatch genérico clave/valor — 1:N con Boleta, sin gate de
/// TipoMovimiento (siempre está disponible, a diferencia de las otras tres
/// secciones que dependen de un Habilita* específico).
/// </summary>
public class BoletaCaracteristica
{
    public Guid Id { get; set; }

    /// <summary>FK -> Boleta.</summary>
    public Guid BoletaId { get; set; }

    public string Clave { get; set; } = string.Empty;

    /// <summary>Valor libre — el único lugar del modelo pensado para dato verdaderamente no tipado, ver el esquema.</summary>
    public string Valor { get; set; } = string.Empty;

    /// <summary>Para que la UI sepa cómo renderizar — "texto"/"numero"/"fecha"/"booleano", no es un enum cerrado a propósito.</summary>
    public string TipoDato { get; set; } = string.Empty;
}
