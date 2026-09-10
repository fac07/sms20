import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _inyectarDbParaPruebas,
  inicializarEsquemaLocal,
  listarPreIngresosPendientesLocal,
  obtenerPreIngresoLocal,
  obtenerUltimaSincronizacionPreIngresos,
  setConfig,
} from './db'
import { sincronizarPreIngresos, sincronizarPreIngresosLocal } from './preingreso-sync'
import type { Fetcher } from './preingreso-sync'

// Slice 3 (PR3) — delta-sync central→terminal de PreIngreso. Espejo del contrato
// de maestros/config-sync: pull filtrado por el centro de la báscula, marca de
// agua `MAX(FechaModificacion)` local, predicado estrictamente `>`. `Vinculado` /
// `Cancelado` que llegan en el delta sacan la fila de la cola de pendientes.

const CENTRO_C = 'ce171100-0000-0000-0000-0000000000c1'
const OTRO_CENTRO = 'ce171100-0000-0000-0000-0000000000c2'
const BASE = 'http://central.test'

const T1 = '2026-09-01T10:00:00.0000000'
const T2 = '2026-09-02T12:30:00.0000000'
const T3 = '2026-09-03T08:15:00.0000000'

let db: Database.Database

interface FakePre {
  id: string
  centroId: string
  numeroEnvio: string
  estado: string
  fechaModificacion: string
  [k: string]: unknown
}

const pre = (id: string, estado: string, fm: string, extra: Partial<FakePre> = {}): FakePre => ({
  id,
  centroId: CENTRO_C,
  pilotoId: null,
  transportistaId: null,
  equipoId: null,
  regionId: null,
  fincaId: null,
  numeroEnvio: `ENV-${id}`,
  pesoEnviado: 20000,
  racimos: 100,
  sacos: null,
  estado,
  boletaId: null,
  usuarioCreacion: 'admin',
  usuarioCancela: null,
  motivoCancelacion: null,
  fechaCreacion: fm,
  fechaModificacion: fm,
  ...extra,
})

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })

/** Central falso: `?modificadoDesde` filtra estrictamente por `>`; `?centroId` scopea. */
function fakeCentral(filas: FakePre[], calls: string[]): Fetcher {
  return async (rawUrl: string) => {
    calls.push(rawUrl)
    const u = new URL(rawUrl)
    if (u.pathname !== '/api/preingresos') return { ok: false, status: 404, json: async () => ({}) }
    const centroId = u.searchParams.get('centroId')
    const desde = u.searchParams.get('modificadoDesde')
    const salida = filas.filter(
      (f) =>
        (!centroId || f.centroId === centroId) && (!desde || f.fechaModificacion > desde),
    )
    return ok(salida)
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

describe('sincronizarPreIngresos', () => {
  it('el pull inicial guarda los Pendiente del centro de la báscula', async () => {
    setConfig('BasculaCentroId', CENTRO_C)
    const calls: string[] = []
    const fetcher = fakeCentral(
      [
        pre('p1', 'Pendiente', T1),
        pre('p2', 'Pendiente', T2),
        pre('p3', 'Pendiente', T1, { centroId: OTRO_CENTRO }),
      ],
      calls,
    )

    const resultado = await sincronizarPreIngresos({ fetcher, baseUrl: BASE })

    expect(resultado).toEqual({ descargados: 2 })
    const pendientes = listarPreIngresosPendientesLocal().map((p) => p.id).sort()
    expect(pendientes).toEqual(['p1', 'p2'])
    // Sin watermark local: el primer request no lleva ?modificadoDesde.
    expect(calls).toHaveLength(1)
    expect(new URL(calls[0]).searchParams.get('centroId')).toBe(CENTRO_C)
    expect(new URL(calls[0]).searchParams.has('modificadoDesde')).toBe(false)
  })

  it('el delta pide ?modificadoDesde=<MAX local> con predicado estricto y avanza la marca de agua', async () => {
    setConfig('BasculaCentroId', CENTRO_C)
    const calls: string[] = []
    const filas = [pre('p1', 'Pendiente', T1), pre('p2', 'Pendiente', T2)]
    const fetcher = fakeCentral(filas, calls)

    await sincronizarPreIngresos({ fetcher, baseUrl: BASE })
    expect(obtenerUltimaSincronizacionPreIngresos()).toBe(T2)

    // Nueva fila modificada después del watermark; p2 (== watermark) NO se reenvía.
    filas.push(pre('p3', 'Pendiente', T3))
    calls.length = 0

    const resultado = await sincronizarPreIngresos({ fetcher, baseUrl: BASE })

    expect(new URL(calls[0]).searchParams.get('modificadoDesde')).toBe(T2)
    expect(resultado).toEqual({ descargados: 1 })
    expect(listarPreIngresosPendientesLocal().map((p) => p.id).sort()).toEqual(['p1', 'p2', 'p3'])
    expect(obtenerUltimaSincronizacionPreIngresos()).toBe(T3)
  })

  it('un delta Vinculado saca la fila de la lista de pendientes', async () => {
    setConfig('BasculaCentroId', CENTRO_C)
    const filas = [pre('p1', 'Pendiente', T1)]
    const fetcher = fakeCentral(filas, [])

    await sincronizarPreIngresos({ fetcher, baseUrl: BASE })
    expect(listarPreIngresosPendientesLocal().map((p) => p.id)).toEqual(['p1'])

    filas[0] = pre('p1', 'Vinculado', T2)
    await sincronizarPreIngresos({ fetcher, baseUrl: BASE })

    expect(listarPreIngresosPendientesLocal()).toEqual([])
    expect(obtenerPreIngresoLocal('p1')?.estado).toBe('Vinculado')
  })

  it('un delta Cancelado saca la fila y marca la boleta ya enlazada localmente', async () => {
    setConfig('BasculaCentroId', CENTRO_C)
    const filas = [pre('p1', 'Pendiente', T1)]
    const fetcher = fakeCentral(filas, [])

    await sincronizarPreIngresos({ fetcher, baseUrl: BASE })

    // Una boleta local ya enlazó p1 estando offline.
    db.prepare(
      `INSERT INTO Boleta (
        Id, NumeroBoleta, TipoMovimientoId, Estado, EstadoSync, PesoIngreso, OrigenPesoIngreso,
        FechaHoraIngreso, UsuarioIngreso, CreadaOffline, PreIngresoId
      ) VALUES ('b1', 'REC-B1-000001', 'tm1', 'Cerrada', 'Local', 1000, 'Bascula',
        '2026-09-02T00:00:00Z', 'op', 1, 'p1')`,
    ).run()

    filas[0] = pre('p1', 'Cancelado', T3, { usuarioCancela: 'admin', motivoCancelacion: 'duplicado' })
    await sincronizarPreIngresos({ fetcher, baseUrl: BASE })

    expect(listarPreIngresosPendientesLocal()).toEqual([])
    const boleta = db.prepare(`SELECT MarcaPreIngreso, Estado FROM Boleta WHERE Id = 'b1'`).get() as {
      MarcaPreIngreso: string | null
      Estado: string
    }
    expect(boleta.MarcaPreIngreso).toBe('PreIngresoCancelado')
    // El enlace y la validez de la boleta no se tocan.
    expect(boleta.Estado).toBe('Cerrada')
  })

  it('sin BasculaCentroId (báscula no aprovisionada) no pega al central y no lanza', async () => {
    const calls: string[] = []
    const fetcher = fakeCentral([pre('p1', 'Pendiente', T1)], calls)

    const resultado = await sincronizarPreIngresos({ fetcher, baseUrl: BASE })

    expect(resultado).toEqual({ descargados: 0 })
    expect(calls).toEqual([])
    expect(listarPreIngresosPendientesLocal()).toEqual([])
  })

  it('un HTTP no-2xx del central propaga el error (marca de agua intacta)', async () => {
    setConfig('BasculaCentroId', CENTRO_C)
    const fetcher: Fetcher = async () => ({ ok: false, status: 503, json: async () => ({}) })

    await expect(sincronizarPreIngresos({ fetcher, baseUrl: BASE })).rejects.toThrow()
    expect(obtenerUltimaSincronizacionPreIngresos()).toBeNull()
  })
})

describe('sincronizarPreIngresosLocal — guardia de sync en vuelo', () => {
  it('dos disparos concurrentes coalescen en una sola corrida', async () => {
    setConfig('BasculaCentroId', CENTRO_C)
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      ((rawUrl: string) => {
        calls.push(new URL(rawUrl).pathname)
        return Promise.resolve(ok([pre('p1', 'Pendiente', T1)]))
      }) as unknown as typeof fetch,
    )

    const [a, b] = await Promise.all([sincronizarPreIngresosLocal(), sincronizarPreIngresosLocal()])

    expect(calls.filter((p) => p === '/api/preingresos')).toHaveLength(1)
    expect(a).toEqual(b)
    expect(a.descargados).toBe(1)

    // La guardia se libera: un disparo posterior vuelve a correr.
    calls.length = 0
    await sincronizarPreIngresosLocal()
    expect(calls.filter((p) => p === '/api/preingresos')).toHaveLength(1)
  })
})
