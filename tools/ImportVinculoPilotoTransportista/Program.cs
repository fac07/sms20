// Importador único de arranque (design "Migration/Rollout", tasks G5).
//
// Vuelca el extracto legado `mas_Piloto_Transportista` (Licencia,
// Transportista, Activo) a la tabla `VinculoPilotoTransportista`, resolviendo
// cada código a `Maestro.Id` vía (TipoCatalogo, Codigo). Ordering es load-
// bearing: este import DEBE correr contra producción ANTES de que PR4 (el
// guard `GuardiaVinculoTransporte`) llegue a producción, o cada listado de
// piloto ofrecido a un operador renderiza vacío y las básculas quedan
// bloqueadas.
//
// Esto NO es parte de la API que corre en producción — es una herramienta de
// consola de un solo uso (deploy-time), separada del backend web
// (`backend/SmsBackend.csproj`) aunque reutiliza su `SmsDbContext` y sus
// entidades para no duplicar a mano el esquema de columnas/tipos.
//
// Este entorno no tiene acceso directo a la base legada, así que el import
// solo admite un CSV como entrada (no una conexión SQL a la base legada). Si
// se dispone de acceso directo más adelante, exportar primero con:
//
//   SELECT Licencia, Transportista, Activo FROM mas_Piloto_Transportista
//
// y volcar el resultado a CSV (bcp, sqlcmd -s",", o el cliente que use el
// equipo de datos). El CSV esperado NO lleva encabezado, 3 columnas:
//
//   <Licencia>,<Transportista>,<Activo>
//
// donde Activo es "1"/"0" o "true"/"false" (case-insensitive).
//
// Uso (desde la raíz del repo, con SmsCentral migrado — dotnet ef database
// update ya corrido con la migración AddVinculoPilotoTransportista):
//
//   dotnet run --project tools/ImportVinculoPilotoTransportista -- \
//     --connection-string "Server=...;Database=SmsCentral;User Id=...;Password=...;TrustServerCertificate=True" \
//     --csv ruta/al/legado-piloto-transportista.csv \
//     [--usuario "migracion-legado"] \
//     [--dry-run]
//
// Re-ejecutable (idempotente): el índice único (PilotoId, TransportistaId)
// de VinculoPilotoTransportista hace que un segundo pase sobre el mismo CSV
// sea un upsert por par — nunca crea una fila duplicada. Un piloto o
// transportista cuyo código no resuelve a un Maestro existente (Piloto o
// Transportista respectivamente) se omite y se reporta al final; no aborta
// el resto del import por una fila mala.

using ImportVinculoPilotoTransportista;
using Microsoft.EntityFrameworkCore;
using SmsBackend.Data;
using SmsBackend.Domain.Maestros;
using SmsBackend.Domain.Transporte;

var opciones = ArgumentosImport.Parsear(args);
if (opciones is null)
{
    return 1;
}

var dbOptions = new DbContextOptionsBuilder<SmsDbContext>()
    .UseSqlServer(opciones.ConnectionString)
    .Options;

await using var db = new SmsDbContext(dbOptions);

var filas = LectorCsvLegado.Leer(opciones.RutaCsv);
Console.WriteLine($"Leídas {filas.Count} filas de '{opciones.RutaCsv}'.");

// Cache de resolución: (TipoCatalogo, Codigo) -> Maestro.Id, cargado una sola
// vez para no pegarle a la base con un SELECT por fila del extracto legado.
var maestrosPorCodigo = await db.Maestros
    .AsNoTracking()
    .Where(m => m.TipoCatalogo == TipoCatalogo.Piloto || m.TipoCatalogo == TipoCatalogo.Transportista)
    .Select(m => new { m.TipoCatalogo, m.Codigo, m.Id })
    .ToDictionaryAsync(m => (m.TipoCatalogo, m.Codigo), m => m.Id);

var creados = 0;
var actualizados = 0;
var sinCambios = 0;
var omitidos = new List<string>();

foreach (var fila in filas)
{
    if (!maestrosPorCodigo.TryGetValue((TipoCatalogo.Piloto, fila.Licencia), out var pilotoId))
    {
        omitidos.Add($"Licencia '{fila.Licencia}' (transportista '{fila.Transportista}'): no existe un Maestro Piloto con ese Codigo.");
        continue;
    }

    if (!maestrosPorCodigo.TryGetValue((TipoCatalogo.Transportista, fila.Transportista), out var transportistaId))
    {
        omitidos.Add($"Transportista '{fila.Transportista}' (licencia '{fila.Licencia}'): no existe un Maestro Transportista con ese Codigo.");
        continue;
    }

    var existente = await db.VinculosPilotoTransportista
        .FirstOrDefaultAsync(v => v.PilotoId == pilotoId && v.TransportistaId == transportistaId);

    if (existente is null)
    {
        db.VinculosPilotoTransportista.Add(new VinculoPilotoTransportista
        {
            Id = Guid.NewGuid(),
            PilotoId = pilotoId,
            TransportistaId = transportistaId,
            Activo = fila.Activo,
            UsuarioCreacion = opciones.Usuario,
            FechaCreacion = DateTime.UtcNow,
            // FechaModificacion la sella SmsDbContext.SaveChanges.
        });
        creados++;
    }
    else if (existente.Activo != fila.Activo)
    {
        existente.Activo = fila.Activo;
        actualizados++;
    }
    else
    {
        sinCambios++;
    }
}

if (opciones.DryRun)
{
    Console.WriteLine(
        $"[dry-run] Se crearían {creados}, se actualizarían {actualizados}, sin cambios {sinCambios}, omitidos {omitidos.Count}. No se escribió nada.");
}
else
{
    await db.SaveChangesAsync();
    Console.WriteLine($"Creados: {creados}. Actualizados (Activo cambió): {actualizados}. Sin cambios: {sinCambios}.");
}

if (omitidos.Count > 0)
{
    Console.WriteLine($"Omitidos ({omitidos.Count}) — código de piloto o transportista no resuelto a un Maestro existente:");
    foreach (var motivo in omitidos)
    {
        Console.WriteLine($"  - {motivo}");
    }
}

return 0;
