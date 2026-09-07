import Database from 'better-sqlite3'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  _inyectarDbParaPruebas,
  crearMaestroProvisionalLocal,
  inicializarEsquemaLocal,
  listarEventosTrabados,
  listarOutboxLocal,
  setConfig,
} from './db'
import { startLocalServer, stopLocalServer } from './local-server'

// Slice M4b — el banner del operador (M5b) consulta GET /outbox/alertas, que
// deriva su predicado de OutboxLocal (sin columna nueva, M-D3):
// TipoEntidad='MaestroProvisional' AND Estado='Pendiente' AND Intentos >= 5.

let db: Database.Database

/** Fuerza el contador de intentos de un evento del Outbox. */
function forzarIntentos(entidadId: string, intentos: number): void {
  db.prepare('UPDATE OutboxLocal SET Intentos = ? WHERE EntidadId = ?').run(intentos, entidadId)
}

beforeEach(() => {
  db = new Database(':memory:')
  inicializarEsquemaLocal(db)
  _inyectarDbParaPruebas(db)
  setConfig('BasculaCodigo', 'B1')
})

afterEach(() => {
  stopLocalServer()
  _inyectarDbParaPruebas(null)
  db.close()
})

describe('listarEventosTrabados (M4b)', () => {
  it('incluye un provisional Pendiente con Intentos >= 5 y lo enriquece con datos del espejo', () => {
    const prov = crearMaestroProvisionalLocal({ tipoCatalogo: 'Transportista', nombre: 'Juan Perez' })
    forzarIntentos(prov.id, 5)

    const trabados = listarEventosTrabados()
    expect(trabados).toHaveLength(1)
    expect(trabados[0]).toMatchObject({
      entidadId: prov.id,
      tipoCatalogo: 'Transportista',
      nombre: 'Juan Perez',
      codigo: prov.codigo,
      intentos: 5,
    })
  })

  it('no incluye un provisional con Intentos < 5', () => {
    const prov = crearMaestroProvisionalLocal({ tipoCatalogo: 'Finca', nombre: 'Finca X' })
    forzarIntentos(prov.id, 4)
    expect(listarEventosTrabados()).toHaveLength(0)
  })

  it('deja de incluirlo cuando el evento sale de Pendiente', () => {
    const prov = crearMaestroProvisionalLocal({ tipoCatalogo: 'Equipo', nombre: 'Equipo 1' })
    forzarIntentos(prov.id, 7)
    expect(listarEventosTrabados()).toHaveLength(1)

    const ev = listarOutboxLocal().find((e) => e.entidadId === prov.id)!
    db.prepare(`UPDATE OutboxLocal SET Estado = 'Enviado' WHERE Id = ?`).run(ev.id)
    expect(listarEventosTrabados()).toHaveLength(0)
  })
})

describe('GET /outbox/alertas (M4b)', () => {
  let baseUrl: string

  beforeEach(async () => {
    const server = startLocalServer(0, false)
    await new Promise<void>((resolve, reject) => {
      server.once('listening', () => resolve())
      server.once('error', reject)
    })
    const { port } = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${port}`
  })

  it('sin trabados -> hayAlertaProvisional false, eventos vacío', async () => {
    const res = await fetch(`${baseUrl}/outbox/alertas`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ hayAlertaProvisional: false, eventos: [] })
  })

  it('con un provisional a 5 intentos -> hayAlertaProvisional true y lo lista', async () => {
    const prov = crearMaestroProvisionalLocal({ tipoCatalogo: 'Transportista', nombre: 'Juan' })
    forzarIntentos(prov.id, 5)

    const res = await fetch(`${baseUrl}/outbox/alertas`)
    const cuerpo = (await res.json()) as {
      hayAlertaProvisional: boolean
      eventos: Array<{ entidadId: string; tipoCatalogo: string; nombre: string; intentos: number }>
    }
    expect(cuerpo.hayAlertaProvisional).toBe(true)
    expect(cuerpo.eventos).toEqual([
      { entidadId: prov.id, tipoCatalogo: 'Transportista', nombre: 'Juan', intentos: 5 },
    ])
  })
})
