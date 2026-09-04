import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { _inyectarDbParaPruebas, inicializarEsquemaLocal, listarTiposMovimientoLocal } from './db'

// Espejo local de TipoMovimiento (D1). El espejo guarda TODO (activos +
// inactivos); el filtro `Activo = 1` es decisión de la capa de lectura, igual
// que `listarMaestrosLocal` / `GET /maestros`.

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
