import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MOTIVOS_PESO_MANUAL,
  guardarConfigIngresoManual,
  inicializarEsquemaLocal,
  leerConfigIngresoManual,
} from './db'

// Config de ingreso manual de peso espejada en `ConfiguracionLocal` (S2a). El
// esquema es aditivo: se siembra con `ON CONFLICT DO NOTHING` sin bump de
// `EsquemaLocalVersion`, mismo precedente que la allow-list de provisionales.

let db: Database.Database

const leerCrudo = (clave: string): string | null | undefined =>
  (db.prepare('SELECT Valor FROM ConfiguracionLocal WHERE Clave = ?').get(clave) as
    | { Valor: string | null }
    | undefined)?.Valor

beforeEach(() => {
  db = new Database(':memory:')
  inicializarEsquemaLocal(db)
})

afterEach(() => {
  db.close()
})

describe('MOTIVOS_PESO_MANUAL', () => {
  it('es el catálogo cerrado que matchea el enum central MotivoPesoManual verbatim', () => {
    expect(MOTIVOS_PESO_MANUAL).toEqual([
      'IndicadorSinSenal',
      'IndicadorEnReparacion',
      'CorteEnergia',
      'Otro',
    ])
  })
})

describe('sembrarConfiguracionInicial — trío de ingreso manual', () => {
  it('siembra PermiteIngresoManual=false y cotas vacías en una DB nueva', () => {
    expect(leerCrudo('PermiteIngresoManual')).toBe('false')
    expect(leerCrudo('PesoMinimoManual')).toBe('')
    expect(leerCrudo('PesoMaximoManual')).toBe('')

    const cfg = leerConfigIngresoManual(db)
    expect(cfg.permiteIngresoManual).toBe(false)
    expect(cfg.pesoMinimoManual).toBeNull()
    expect(cfg.pesoMaximoManual).toBeNull()
    expect(cfg.motivosPesoManual).toEqual(MOTIVOS_PESO_MANUAL)
  })

  it('re-inicializar el esquema NO pisa un valor ya sincronizado (ON CONFLICT DO NOTHING)', () => {
    guardarConfigIngresoManual(db, {
      permiteIngresoManual: true,
      pesoMinimoManual: 100,
      pesoMaximoManual: 42000,
    })

    // Simula un reinicio de la app: el esquema se levanta de nuevo sobre la
    // misma base.
    inicializarEsquemaLocal(db)

    const cfg = leerConfigIngresoManual(db)
    expect(cfg.permiteIngresoManual).toBe(true)
    expect(cfg.pesoMinimoManual).toBe(100)
    expect(cfg.pesoMaximoManual).toBe(42000)
  })
})

describe('leerConfigIngresoManual', () => {
  it('clave ausente => default-deny y sin cotas', () => {
    db.prepare(
      `DELETE FROM ConfiguracionLocal WHERE Clave IN
       ('PermiteIngresoManual', 'PesoMinimoManual', 'PesoMaximoManual')`,
    ).run()

    const cfg = leerConfigIngresoManual(db)
    expect(cfg.permiteIngresoManual).toBe(false)
    expect(cfg.pesoMinimoManual).toBeNull()
    expect(cfg.pesoMaximoManual).toBeNull()
    expect(cfg.motivosPesoManual).toEqual(MOTIVOS_PESO_MANUAL)
  })

  it('guardarConfigIngresoManual upsertea el trío y null en una cota se guarda vacío', () => {
    guardarConfigIngresoManual(db, {
      permiteIngresoManual: true,
      pesoMinimoManual: 75.25,
      pesoMaximoManual: null,
    })

    expect(leerCrudo('PesoMaximoManual')).toBe('')
    const cfg = leerConfigIngresoManual(db)
    expect(cfg.permiteIngresoManual).toBe(true)
    expect(cfg.pesoMinimoManual).toBe(75.25)
    expect(cfg.pesoMaximoManual).toBeNull()
  })
})
