namespace SmsBackend.Domain.Boletas.Valores;

/// <summary>
/// Valor capturado en una boleta para un <see cref="Configuracion.Campo"/>
/// configurable (almacenamiento EAV tipado). Fluye báscula→central como parte
/// del payload de la boleta.
///
/// PK compuesta <c>(BoletaId, CampoId, Ocurrencia)</c>. <see cref="Ocurrencia"/>
/// es 0 para secciones de cardinalidad <c>Unica</c> y 0..N para <c>Repetible</c>
/// (marchamos, detalle de fruta). Cada fila referencia el <see cref="CampoId"/>
/// exacto vigente al crear la boleta — nunca se re-resuelve por clave.
///
/// Exactamente una de las columnas de valor está poblada; qué columna depende
/// del <see cref="Configuracion.TipoCampo"/> del campo y lo garantiza el check
/// constraint <c>CK_BoletaValorCampo_UnSoloValor</c>.
/// </summary>
public class BoletaValorCampo
{
    public Guid BoletaId { get; set; }

    /// <summary>Campo vigente al crear la boleta. Estable a través del borde central/local.</summary>
    public Guid CampoId { get; set; }

    /// <summary>0 para secciones <c>Unica</c>; 0..N para <c>Repetible</c>.</summary>
    public int Ocurrencia { get; set; }

    /// <summary>
    /// Denormalizado server-side desde <see cref="Configuracion.Campo.SeccionId"/>
    /// — nunca se acepta del cliente. Permite leer el formulario por sección sin
    /// join a Campo.
    /// </summary>
    public Guid SeccionId { get; set; }

    /// <summary>Texto / Lista.</summary>
    public string? ValorTexto { get; set; }

    /// <summary>Entero / Decimal. Columna SQL <c>decimal(18,4)</c>.</summary>
    public decimal? ValorNumero { get; set; }

    /// <summary>Fecha / FechaHora.</summary>
    public DateTime? ValorFecha { get; set; }

    /// <summary>Booleano.</summary>
    public bool? ValorBooleano { get; set; }

    /// <summary>ReferenciaMaestro — FK a Maestro (Restrict, nullable).</summary>
    public Guid? ValorMaestroId { get; set; }
}
