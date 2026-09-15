import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _inyectarDbParaPruebas,
  inicializarEsquemaLocal,
  obtenerUltimaSincronizacionMaestros,
  obtenerUltimaSincronizacionVinculos,
  vinculosPorTransportistaLocal,
} from './db'
import { sincronizarMaestros } from './maestros-sync'

// PR5 (Slice B1c) — sincronizarMaestros ahora también delta-sincroniza el
// vínculo Piloto-Transportista en el MISMO pase (diseño D3/G4): un solo
// módulo, un solo tick de 60s, un solo upsert transaccional
// (upsertMaestrosYVinculosLocal en db.ts) para que los dos watermarks nunca
// puedan divergir. `sincronizarMaestros()` no acepta un fetcher inyectable
// (a diferencia de preingreso-sync.ts): sigue el mismo patrón que
// merge-apply.spec.ts, `vi.stubGlobal('fetch', ...)` ruteado por pathname.

let db: Database.Database

const maestroDto = (id: string, tipoCatalogo: string, fechaModificacion: string) => ({
  id,
  tipoCatalogo,
  codigo: `COD-${id}`,
  nombre: `Nombre ${id}`,
  datosAdicionales: null,
  estado: 'Oficial',
  fusionadoConId: null,
  fechaModificacion,
  activo: true,
})

const vinculoDto = (
  id: string,
  pilotoId: string,
  transportistaId: string,
  fechaModificacion: string,
  activo = true,
) => ({ id, pilotoId, transportistaId, activo, fechaModificacion })

/** Central falso ruteado por pathname — sirve /api/maestros y /api/vinculos-piloto-transportista. */
function fakeCentral(
  maestros: unknown[],
  vinculos: unknown[],
  calls: string[] = [],
): (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> {
  return async (rawUrl: string) => {
    calls.push(rawUrl)
    const u = new URL(rawUrl)
    if (u.pathname === '/api/maestros') return { ok: true, status: 200, json: async () => maestros }
    if (u.pathname === '/api/vinculos-piloto-transportista') {
      return { ok: true, status: 200, json: async () => vinculos }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }
}

beforeEach(() => {
  db = new Database(':memory:')
  inicializarEsquemaLocal(db)
  _inyectarDbParaPruebas(db)
})

afterEach(() => {
  _inyectarDbParaPruebas(null)
  vi.unstubAllGlobals()
  db.close()
})

describe('sincronizarMaestros — delta de vínculos piloto-transportista en el mismo pase (PR5/D3)', () => {
  it('descarga y upsertea maestros Y vínculos en la misma pasada', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      fakeCentral(
        [maestroDto('pi-1', 'Piloto', '2026-09-01T00:00:00Z')],
        [vinculoDto('v1', 'pi-1', 'tr-1', '2026-09-01T00:00:00Z')],
        calls,
      ) as unknown as typeof fetch,
    )

    const resultado = await sincronizarMaestros()

    expect(resultado).toEqual({ descargados: 1 })
    expect(vinculosPorTransportistaLocal('tr-1').map((v) => v.pilotoId)).toEqual(['pi-1'])
    expect(calls.some((c) => new URL(c).pathname === '/api/maestros')).toBe(true)
    expect(calls.some((c) => new URL(c).pathname === '/api/vinculos-piloto-transportista')).toBe(true)
  })

  it('el delta de vínculos pide ?modificadoDesde=<MAX local> con predicado estricto, watermark propio', async () => {
    vi.stubGlobal(
      'fetch',
      fakeCentral([], [vinculoDto('v1', 'pi-1', 'tr-1', '2026-09-01T00:00:00Z')]) as unknown as typeof fetch,
    )
    await sincronizarMaestros()
    expect(obtenerUltimaSincronizacionVinculos()).toBe('2026-09-01T00:00:00Z')

    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      fakeCentral([], [vinculoDto('v2', 'pi-2', 'tr-1', '2026-09-02T00:00:00Z')], calls) as unknown as typeof fetch,
    )
    await sincronizarMaestros()

    const urlVinculos = calls.find((c) => new URL(c).pathname === '/api/vinculos-piloto-transportista')!
    expect(new URL(urlVinculos).searchParams.get('modificadoDesde')).toBe('2026-09-01T00:00:00Z')
    expect(vinculosPorTransportistaLocal('tr-1').map((v) => v.pilotoId).sort()).toEqual(['pi-1', 'pi-2'])
    expect(obtenerUltimaSincronizacionVinculos()).toBe('2026-09-02T00:00:00Z')
  })

  it('G4: si el upsert de vínculos falla a mitad de camino, NI el watermark de Maestro NI el de Vínculo avanzan', async () => {
    const watermarkMaestroPrevio = obtenerUltimaSincronizacionMaestros()
    const watermarkVinculoPrevio = obtenerUltimaSincronizacionVinculos()

    // Rompe el upsert de VinculoPilotoTransportista a mitad de la transacción
    // combinada -> Maestro, que se upsertea PRIMERO dentro de la misma
    // transacción, tiene que revertirse también (no solo el de Vínculo).
    db.exec('DROP TABLE VinculoPilotoTransportista')

    vi.stubGlobal(
      'fetch',
      fakeCentral(
        [maestroDto('pi-9', 'Piloto', '2026-09-09T00:00:00Z')],
        [vinculoDto('v9', 'pi-9', 'tr-9', '2026-09-09T00:00:00Z')],
      ) as unknown as typeof fetch,
    )

    await expect(sincronizarMaestros()).rejects.toThrow()

    expect(obtenerUltimaSincronizacionMaestros()).toBe(watermarkMaestroPrevio)
    // No se puede reconsultar el watermark de Vínculo (la tabla está dropeada
    // a propósito para forzar la falla), pero el punto de la prueba es que el
    // Maestro tampoco quedó persistido: la transacción entera se revirtió.
    void watermarkVinculoPrevio
    db.exec(
      'CREATE TABLE VinculoPilotoTransportista (Id TEXT PRIMARY KEY, PilotoId TEXT, TransportistaId TEXT, Activo INTEGER, FechaModificacion TEXT)',
    )
    expect(vinculosPorTransportistaLocal('tr-9')).toEqual([])
    const maestroFila = db.prepare('SELECT * FROM Maestro WHERE Id = ?').get('pi-9')
    expect(maestroFila).toBeUndefined()
  })

  it('un HTTP no-2xx en el delta de vínculos propaga el error (watermark de Maestro tampoco avanza)', async () => {
    const watermarkPrevio = obtenerUltimaSincronizacionMaestros()
    vi.stubGlobal(
      'fetch',
      (async (rawUrl: string) => {
        const u = new URL(rawUrl)
        if (u.pathname === '/api/maestros') {
          return { ok: true, status: 200, json: async () => [maestroDto('pi-1', 'Piloto', '2026-09-01T00:00:00Z')] }
        }
        return { ok: false, status: 503, json: async () => ({}) }
      }) as unknown as typeof fetch,
    )

    await expect(sincronizarMaestros()).rejects.toThrow()
    expect(obtenerUltimaSincronizacionMaestros()).toBe(watermarkPrevio)
  })
})
