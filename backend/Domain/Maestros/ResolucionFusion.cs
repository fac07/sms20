using Microsoft.EntityFrameworkCore;
using SmsBackend.Data;

namespace SmsBackend.Domain.Maestros;

/// <summary>
/// Resolución del encadenamiento <see cref="Maestro.FusionadoConId"/> para el
/// write path imperativo: el ingest de <c>POST /api/maestros/sync</c> y el
/// redirect-on-write de <c>/api/boletas/sync</c>.
///
/// El guard de <c>/fusionar</c> (el target debe ser un Oficial activo) impide
/// crear cadenas nuevas, así que en la práctica esto resuelve en un solo salto.
/// Aun así el loop es defensivo: acota los saltos con <see cref="MaxSaltos"/> y
/// corta ante un ciclo, por si quedaron cadenas heredadas de antes del guard.
/// La proyección de lectura (<c>Proyectar</c>) resuelve un único salto inline en
/// el <see cref="IQueryable"/> y no usa este helper.
/// </summary>
public static class ResolucionFusion
{
    /// <summary>Tope de saltos siguiendo <see cref="Maestro.FusionadoConId"/> antes de abortar.</summary>
    public const int MaxSaltos = 5;

    /// <summary>
    /// Sigue <see cref="Maestro.FusionadoConId"/> desde <paramref name="id"/>
    /// hasta la fila que no está fusionada (el oficial vigente) y devuelve su
    /// <see cref="Maestro.Id"/>. Un id desconocido (sin fila) se devuelve tal
    /// cual — el llamador decide qué hacer con él. Lanza
    /// <see cref="InvalidOperationException"/> si el encadenamiento supera
    /// <see cref="MaxSaltos"/> o si se detecta un ciclo.
    /// </summary>
    public static async Task<Guid> ResolverMaestroFusionadoAsync(
        SmsDbContext db, Guid id, CancellationToken ct = default)
    {
        var visitados = new HashSet<Guid> { id };
        var actual = id;

        for (var salto = 0; salto < MaxSaltos; salto++)
        {
            var fusionadoConId = await db.Maestros
                .AsNoTracking()
                .Where(m => m.Id == actual)
                .Select(m => m.FusionadoConId)
                .FirstOrDefaultAsync(ct);

            if (fusionadoConId is null || fusionadoConId.Value == Guid.Empty)
            {
                return actual;
            }

            if (!visitados.Add(fusionadoConId.Value))
            {
                throw new InvalidOperationException(
                    $"Ciclo de FusionadoConId detectado al resolver el maestro {id}.");
            }

            actual = fusionadoConId.Value;
        }

        throw new InvalidOperationException(
            $"El encadenamiento de FusionadoConId del maestro {id} supera los {MaxSaltos} saltos.");
    }
}
