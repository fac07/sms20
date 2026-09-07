import Database from 'better-sqlite3'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _inyectarDbParaPruebas,
  guardarConfigIngresoManual,
  inicializarEsquemaLocal,
  leerConfigIngresoManual,
} from './db'
import { startLocalServer, stopLocalServer } from './local-server'

// Config de ingreso manual de peso expuesta por el servidor local (S2a). El
// `GET /estado` es EL canal al renderer (viaja en el request que `flushInit` ya
// flushea); `POST /aprovisionamiento` la siembra en cold-start.

let db: Database.Database
let baseUrl: string

async function arrancarServidor(): Promise<void> {
  const server = startLocalServer(0, false)
  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => resolve())
    server.once('error', reject)
  })
  const { port } = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${port}`
}

beforeEach(() => {
  db = new Database(':memory:')
  inicializarEsquemaLocal(db)
  _inyectarDbParaPruebas(db)
})

afterEach(() => {
  stopLocalServer()
  _inyectarDbParaPruebas(null)
  vi.unstubAllGlobals()
  db.close()
})

describe('GET /estado — config de ingreso manual', () => {
  beforeEach(arrancarServidor)

  it('default-deny cuando nunca se sincronizó, pero el catálogo de motivos siempre viaja', async () => {
    const res = await fetch(`${baseUrl}/estado`)
    expect(res.status).toBe(200)
    const cuerpo = (await res.json()) as Record<string, unknown>

    expect(cuerpo.permiteIngresoManual).toBe(false)
    expect(cuerpo.pesoMinimoManual).toBeNull()
    expect(cuerpo.pesoMaximoManual).toBeNull()
    expect(cuerpo.motivosPesoManual).toEqual([
      'IndicadorSinSenal',
      'IndicadorEnReparacion',
      'CorteEnergia',
      'Otro',
    ])
  })

  it('expone el flag y las cotas ya sincronizadas', async () => {
    guardarConfigIngresoManual(db, {
      permiteIngresoManual: true,
      pesoMinimoManual: 100,
      pesoMaximoManual: 9000,
    })

    const cuerpo = (await (await fetch(`${baseUrl}/estado`)).json()) as Record<string, unknown>
    expect(cuerpo.permiteIngresoManual).toBe(true)
    expect(cuerpo.pesoMinimoManual).toBe(100)
    expect(cuerpo.pesoMaximoManual).toBe(9000)
  })
})

describe('POST /aprovisionamiento — cold-start seed del trío', () => {
  beforeEach(arrancarServidor)

  it('persiste permiteIngresoManual + cotas desde el AprovisionamientoDto central', async () => {
    // El handler de `/aprovisionamiento` habla con el central por `fetch`; el
    // request del test al servidor local también es `fetch`. Se stubea solo el
    // host de central (`localhost:5094`) y se delega el resto al `fetch` real.
    const realFetch = globalThis.fetch
    vi.stubGlobal(
      'fetch',
      vi.fn(async (rawUrl: string | URL, init?: RequestInit) => {
        const u = new URL(String(rawUrl))
        if (u.host !== 'localhost:5094') return realFetch(rawUrl as string, init)
        if (u.pathname === '/api/basculas/aprovisionar' && init?.method === 'POST') {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              basculaId: 'ba5c111a-0000-0000-0000-000000000009',
              basculaCodigo: 'B9',
              basculaNombre: 'Báscula 9',
              centroId: 'c1',
              tipoConexion: 'Serial',
              puerto: null,
              ip: null,
              puertoTcp: null,
              velocidad: null,
              bitsDatos: null,
              modoComunicacion: null,
              permiteIngresoManual: true,
              pesoMinimoManual: 200,
              pesoMaximoManual: 55000,
            }),
          }
        }
        if (u.pathname === '/api/maestros') {
          return { ok: true, status: 200, json: async () => [] }
        }
        return { ok: false, status: 404, json: async () => ({}) }
      }) as unknown as typeof fetch,
    )

    const res = await fetch(`${baseUrl}/aprovisionamiento`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigo: 'ABC123' }),
    })
    expect(res.status).toBe(200)

    const cfg = leerConfigIngresoManual(db)
    expect(cfg.permiteIngresoManual).toBe(true)
    expect(cfg.pesoMinimoManual).toBe(200)
    expect(cfg.pesoMaximoManual).toBe(55000)
  })
})
