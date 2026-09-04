import Database from 'better-sqlite3'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { _inyectarDbParaPruebas, inicializarEsquemaLocal, listarTiposMovimientoLocal } from './db'
import { startLocalServer, stopLocalServer } from './local-server'

// Espejo local de TipoMovimiento (D1) + ruta de lectura `GET /tipos-movimiento`
// (D3). El espejo guarda TODO (activos + inactivos); el filtro `Activo = 1` es
// decisión de la capa de lectura, igual que `listarMaestrosLocal` / `GET /maestros`.

const TM_ACTIVO_A = 'aaaaaaaa-0000-0000-0000-000000000001'
const TM_ACTIVO_B = 'bbbbbbbb-0000-0000-0000-000000000002'
const TM_INACTIVO = 'cccccccc-0000-0000-0000-000000000003'

let db: Database.Database

function sembrarTipo(id: string, nombre: string, activo: boolean): void {
  db.prepare(
    `INSERT INTO TipoMovimiento
       (Id, Codigo, Nombre, Prefijo, Direccion, OperacionD365, GeneraQR, FormatoBoletaId, Activo)
     VALUES (?, ?, ?, ?, 'Entrada', NULL, 0, NULL, ?)`,
  ).run(id, nombre.slice(0, 3).toUpperCase(), nombre, nombre.slice(0, 2).toUpperCase(), activo ? 1 : 0)
}

beforeEach(() => {
  db = new Database(':memory:')
  inicializarEsquemaLocal(db)
  _inyectarDbParaPruebas(db)
})

afterEach(() => {
  stopLocalServer()
  _inyectarDbParaPruebas(null)
  db.close()
})

describe('listarTiposMovimientoLocal (D1)', () => {
  it('por default oculta los inactivos y ordena por Nombre', () => {
    sembrarTipo(TM_ACTIVO_B, 'Zeta', true)
    sembrarTipo(TM_ACTIVO_A, 'Alfa', true)
    sembrarTipo(TM_INACTIVO, 'Media', false)

    expect(listarTiposMovimientoLocal().map((t) => t.nombre)).toEqual(['Alfa', 'Zeta'])
  })

  it('incluirInactivos=true devuelve todas', () => {
    sembrarTipo(TM_ACTIVO_A, 'Alfa', true)
    sembrarTipo(TM_INACTIVO, 'Media', false)

    const todas = listarTiposMovimientoLocal(true)
    expect(todas.map((t) => t.nombre)).toEqual(['Alfa', 'Media'])
    expect(todas.find((t) => t.nombre === 'Media')?.activo).toBe(false)
  })

  it('espejo vacío -> []', () => {
    expect(listarTiposMovimientoLocal()).toEqual([])
    expect(listarTiposMovimientoLocal(true)).toEqual([])
  })
})

describe('GET /tipos-movimiento (D3)', () => {
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

  it('por default devuelve solo activos', async () => {
    sembrarTipo(TM_ACTIVO_A, 'Alfa', true)
    sembrarTipo(TM_INACTIVO, 'Media', false)

    const res = await fetch(`${baseUrl}/tipos-movimiento`)
    expect(res.status).toBe(200)
    const cuerpo = (await res.json()) as Array<{ nombre: string }>
    expect(cuerpo.map((t) => t.nombre)).toEqual(['Alfa'])
  })

  it('?incluirInactivos=true devuelve todas', async () => {
    sembrarTipo(TM_ACTIVO_A, 'Alfa', true)
    sembrarTipo(TM_INACTIVO, 'Media', false)

    const res = await fetch(`${baseUrl}/tipos-movimiento?incluirInactivos=true`)
    const cuerpo = (await res.json()) as Array<{ nombre: string }>
    expect(cuerpo.map((t) => t.nombre)).toEqual(['Alfa', 'Media'])
  })

  it('espejo nunca sincronizado -> 200 []', async () => {
    const res = await fetch(`${baseUrl}/tipos-movimiento`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })
})
