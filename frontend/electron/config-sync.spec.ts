import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _inyectarDbParaPruebas, inicializarEsquemaLocal } from './db'
import { sincronizarConfig, sincronizarConfigLocal } from './config-sync'
import type { Fetcher } from './config-sync'

// Espejo mínimo del backend central para manejar el canal de deltas:
// ?modificadoDesde filtra estrictamente por fechaModificacion, ausente = todo.
interface FakeTipo {
  id: string
  codigo: string
  nombre: string
  prefijo: string
  direccion: string
  operacionD365: string | null
  generaQR: boolean
  formatoBoletaId: string | null
  activo: boolean
}

interface FakeData {
  secciones: Array<Record<string, unknown> & { fechaModificacion: string }>
  campos: Array<Record<string, unknown> & { fechaModificacion: string }>
  tipos: FakeTipo[]
  tms: Record<string, Array<Record<string, unknown> & { fechaModificacion: string }>>
}

const tipoMov = (id: string, activo = true, extra: Partial<FakeTipo> = {}): FakeTipo => ({
  id,
  codigo: id.toUpperCase(),
  nombre: `Tipo ${id}`,
  prefijo: id.slice(0, 3).toUpperCase(),
  direccion: 'Entrada',
  operacionD365: null,
  generaQR: false,
  formatoBoletaId: null,
  activo,
  ...extra,
})

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })

function fakeCentral(data: FakeData, calls: string[]): Fetcher {
  const filtrar = <T extends { fechaModificacion: string }>(filas: T[], u: URL): T[] => {
    const desde = u.searchParams.get('modificadoDesde')
    return desde ? filas.filter((f) => f.fechaModificacion > desde) : filas
  }

  return async (rawUrl: string) => {
    calls.push(rawUrl)
    const u = new URL(rawUrl)
    if (u.pathname === '/api/secciones') return ok(filtrar(data.secciones, u))
    if (u.pathname === '/api/campos') return ok(filtrar(data.campos, u))
    if (u.pathname === '/api/tipos-movimiento') return ok(data.tipos)
    const m = u.pathname.match(/^\/api\/tipos-movimiento\/([^/]+)\/secciones$/)
    if (m) return ok(filtrar(data.tms[m[1]] ?? [], u))
    return { ok: false, status: 404, json: async () => ({ error: 'ruta desconocida' }) }
  }
}

const T1 = '2026-09-01T10:00:00.0000000'
const T2 = '2026-09-02T12:30:00.0000000'

const seccion = (id: string, clave: string, fm: string) => ({
  id,
  clave,
  nombre: `Sección ${clave}`,
  cardinalidad: 'Unica',
  reportable: false,
  estandar: false,
  orden: 1,
  activa: true,
  fechaModificacion: fm,
})

const campo = (id: string, seccionId: string, clave: string, fm: string) => ({
  id,
  seccionId,
  clave,
  etiqueta: `Etiqueta ${clave}`,
  tipoCampo: 'Texto',
  tipoCatalogoRef: null,
  requerido: false,
  configuracion: null,
  orden: 1,
  vigenteDesde: fm,
  vigenteHasta: null,
  fechaModificacion: fm,
})

const tmsRow = (seccionId: string, fm: string, vigenteHasta: string | null = null) => ({
  seccionId,
  seccionClave: 'x',
  seccionNombre: 'X',
  requerida: true,
  orden: 1,
  vigenteDesde: fm,
  vigenteHasta,
  fechaModificacion: fm,
})

let db: Database.Database
const BASE = 'http://central.test'

beforeEach(() => {
  db = new Database(':memory:')
  inicializarEsquemaLocal(db)
})

afterEach(() => {
  db.close()
})

const contar = (tabla: string): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get() as { n: number }).n

const leerConfig = (clave: string): string | undefined =>
  (db.prepare('SELECT Valor FROM ConfiguracionLocal WHERE Clave = ?').get(clave) as
    | { Valor: string }
    | undefined)?.Valor

describe('sincronizarConfig', () => {
  it('el primer sync siembra el caché local y sella lastConfigSyncAt', async () => {
    const data: FakeData = {
      secciones: [seccion('s1', 'peso', T1), seccion('s2', 'calidad', T1)],
      campos: [campo('c1', 's1', 'bruto', T1), campo('c2', 's2', 'acidez', T1)],
      tipos: [tipoMov('tm1')],
      tms: { tm1: [tmsRow('s1', T1)] },
    }
    const calls: string[] = []

    const resultado = await sincronizarConfig(db, { fetcher: fakeCentral(data, calls), baseUrl: BASE })

    expect(contar('Seccion')).toBe(2)
    expect(contar('Campo')).toBe(2)
    expect(contar('TipoMovimientoSeccion')).toBe(1)
    expect(resultado).toEqual({ secciones: 2, campos: 2, tiposMovimientoSeccion: 1, tiposMovimiento: 1 })

    const sello = leerConfig('LastConfigSyncAt')
    expect(sello).toBeTruthy()
    expect(Number.isNaN(Date.parse(sello!))).toBe(false)

    // Primer sync: sin watermark, ningún request lleva ?modificadoDesde.
    expect(calls.every((u) => !u.includes('modificadoDesde'))).toBe(true)
  })

  it('el sync incremental pide ?modificadoDesde=<MAX local> y solo hace upsert de los deltas', async () => {
    const data: FakeData = {
      secciones: [seccion('s1', 'peso', T1)],
      campos: [campo('c1', 's1', 'bruto', T1)],
      tipos: [tipoMov('tm1')],
      tms: { tm1: [tmsRow('s1', T1)] },
    }
    const calls: string[] = []
    const fetcher = fakeCentral(data, calls)

    await sincronizarConfig(db, { fetcher, baseUrl: BASE })
    expect(contar('Seccion')).toBe(1)

    // Aparece una sección nueva modificada después del watermark T1.
    data.secciones.push(seccion('s2', 'calidad', T2))
    calls.length = 0

    const resultado = await sincronizarConfig(db, { fetcher, baseUrl: BASE })

    const req = calls.find((u) => new URL(u).pathname === '/api/secciones')!
    expect(new URL(req).searchParams.get('modificadoDesde')).toBe(T1)
    expect(resultado.secciones).toBe(1)
    expect(contar('Seccion')).toBe(2)
  })

  it('un sync interrumpido no persiste nada y reanuda sin duplicar', async () => {
    const data: FakeData = {
      secciones: [seccion('s1', 'peso', T1)],
      campos: [campo('c1', 's1', 'bruto', T1)],
      tipos: [tipoMov('tm1')],
      tms: { tm1: [tmsRow('s1', T1)] },
    }
    const calls: string[] = []
    const sano = fakeCentral(data, calls)
    const roto: Fetcher = async (url) => {
      if (url.includes('/secciones') && url.includes('tipos-movimiento')) {
        throw new Error('red caída a mitad del batch')
      }
      return sano(url)
    }

    await expect(sincronizarConfig(db, { fetcher: roto, baseUrl: BASE })).rejects.toThrow()
    expect(contar('Seccion')).toBe(0)
    expect(contar('Campo')).toBe(0)
    expect(contar('TipoMovimiento')).toBe(0)
    expect(leerConfig('LastConfigSyncAt')).toBeUndefined()

    await sincronizarConfig(db, { fetcher: sano, baseUrl: BASE })
    await sincronizarConfig(db, { fetcher: sano, baseUrl: BASE })

    expect(contar('Seccion')).toBe(1)
    expect(contar('Campo')).toBe(1)
    expect(contar('TipoMovimientoSeccion')).toBe(1)
    expect(contar('TipoMovimiento')).toBe(1)
  })

  it('siembra el espejo de TipoMovimiento (activos + inactivos) desde el array ya bajado, sin fetch extra', async () => {
    const data: FakeData = {
      secciones: [seccion('s1', 'peso', T1)],
      campos: [campo('c1', 's1', 'bruto', T1)],
      tipos: [
        tipoMov('tm1', true, { nombre: 'Ingreso', prefijo: 'ING' }),
        tipoMov('tm2', false, { nombre: 'Salida', prefijo: 'SAL' }),
      ],
      tms: { tm1: [tmsRow('s1', T1)], tm2: [] },
    }
    const calls: string[] = []

    const resultado = await sincronizarConfig(db, { fetcher: fakeCentral(data, calls), baseUrl: BASE })

    // Sin fetch extra: `/api/tipos-movimiento` (lista) se pide una sola vez.
    const listaCalls = calls.filter((u) => new URL(u).pathname === '/api/tipos-movimiento')
    expect(listaCalls).toHaveLength(1)

    expect(contar('TipoMovimiento')).toBe(2)
    expect(resultado.tiposMovimiento).toBe(2)

    const filas = db
      .prepare('SELECT Id, Nombre, Prefijo, Activo FROM TipoMovimiento ORDER BY Nombre')
      .all() as Array<{ Id: string; Nombre: string; Prefijo: string; Activo: number }>
    expect(filas).toEqual([
      { Id: 'tm1', Nombre: 'Ingreso', Prefijo: 'ING', Activo: 1 },
      { Id: 'tm2', Nombre: 'Salida', Prefijo: 'SAL', Activo: 0 },
    ])

    // Re-run idempotente: mismo conteo, sin filas nuevas.
    await sincronizarConfig(db, { fetcher: fakeCentral(data, calls), baseUrl: BASE })
    expect(contar('TipoMovimiento')).toBe(2)
  })
})

describe('sincronizarConfigLocal — guardia de sync en vuelo', () => {
  const data: FakeData = {
    secciones: [seccion('s1', 'peso', T1)],
    campos: [campo('c1', 's1', 'bruto', T1)],
    tipos: [tipoMov('tm1')],
    tms: { tm1: [tmsRow('s1', T1)] },
  }

  beforeEach(() => {
    _inyectarDbParaPruebas(db)
  })

  afterEach(() => {
    _inyectarDbParaPruebas(null)
    vi.unstubAllGlobals()
  })

  it('dos disparos concurrentes coalescen en una sola corrida de sincronizarConfig', async () => {
    const calls: string[] = []
    // `sincronizarConfigLocal` no acepta fetcher inyectado — se stubea el global
    // y `baseUrl` cae al default `http://localhost:5094`.
    vi.stubGlobal('fetch', ((rawUrl: string) => {
      const u = new URL(rawUrl)
      calls.push(u.pathname)
      if (u.pathname === '/api/secciones') return Promise.resolve(ok(data.secciones))
      if (u.pathname === '/api/campos') return Promise.resolve(ok(data.campos))
      if (u.pathname === '/api/tipos-movimiento') return Promise.resolve(ok(data.tipos))
      const m = u.pathname.match(/^\/api\/tipos-movimiento\/([^/]+)\/secciones$/)
      if (m) return Promise.resolve(ok(data.tms[m[1]] ?? []))
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) })
    }) as unknown as typeof fetch)

    const [a, b] = await Promise.all([sincronizarConfigLocal(), sincronizarConfigLocal()])

    // Misma corrida: un solo set de fetches (una sola lectura de `/api/secciones`).
    expect(calls.filter((p) => p === '/api/secciones')).toHaveLength(1)
    expect(a).toEqual(b)
    expect(a.tiposMovimiento).toBe(1)

    // La guardia se libera: un disparo posterior vuelve a correr.
    calls.length = 0
    await sincronizarConfigLocal()
    expect(calls.filter((p) => p === '/api/secciones')).toHaveLength(1)
  })
})
