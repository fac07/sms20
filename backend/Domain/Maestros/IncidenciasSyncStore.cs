using System.Collections.Concurrent;

namespace SmsBackend.Domain.Maestros;

/// <summary>
/// Store en memoria (sin tabla — M-D3) de las incidencias de sync que reportan
/// las básculas: un evento <c>MaestroProvisional</c> trabado a &gt;= 5 intentos.
/// Cada entrada vive a lo sumo <see cref="Ttl"/> y se poda en cada
/// lectura/escritura. Volátil por diseño: el terminal re-reporta en cada ciclo,
/// así que un reinicio del central se autocura. Idempotente por
/// <c>(BasculaCodigo, EntidadId)</c>.
/// </summary>
public sealed class IncidenciasSyncStore
{
    /// <summary>Vida máxima de una entrada sin volver a reportarse.</summary>
    public static readonly TimeSpan Ttl = TimeSpan.FromHours(1);

    private readonly ConcurrentDictionary<string, IncidenciaSync> _entradas = new();
    private readonly Func<DateTimeOffset> _reloj;

    public IncidenciasSyncStore(Func<DateTimeOffset>? reloj = null)
        => _reloj = reloj ?? (() => DateTimeOffset.UtcNow);

    private static string Clave(string basculaCodigo, Guid entidadId) => $"{basculaCodigo}|{entidadId}";

    /// <summary>Upsert idempotente por <c>(BasculaCodigo, EntidadId)</c>.</summary>
    public void Reportar(ReportarIncidenciaSyncRequest request)
    {
        var ahora = _reloj();
        Podar(ahora);
        _entradas[Clave(request.BasculaCodigo, request.EntidadId)] = new IncidenciaSync(
            request.BasculaCodigo,
            request.EntidadId,
            request.TipoCatalogo,
            request.Nombre,
            request.Intentos,
            request.UltimoError,
            ahora);
    }

    public IReadOnlyList<IncidenciaSync> Listar()
    {
        var ahora = _reloj();
        Podar(ahora);
        return _entradas.Values
            .OrderBy(i => i.BasculaCodigo, StringComparer.Ordinal)
            .ThenBy(i => i.Nombre, StringComparer.Ordinal)
            .ToList();
    }

    private void Podar(DateTimeOffset ahora)
    {
        foreach (var (clave, incidencia) in _entradas)
        {
            if (ahora - incidencia.Visto > Ttl)
            {
                _entradas.TryRemove(clave, out _);
            }
        }
    }
}
