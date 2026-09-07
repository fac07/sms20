import Database from 'better-sqlite3'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  _inyectarDbParaPruebas,
  guardarConfigIngresoManual,
  inicializarEsquemaLocal,
  listarOutboxLocal,
  obtenerBoletaLocal,
} from './db'
import { startLocalServer, stopLocalServer } from './local-server'

// ingreso-manual-peso S2b — gate local del peso manual en `POST /boletas` y
// `POST /boletas/:id/cerrar`. Espeja `ValidarPesoManualTipado` de central: flag
// habilitado → motivo de catálogo → `Otro`⇒detalle → rango contra las cotas
// locales, toda falla 422 (diseño D7). El rango se valida acá, al tipear —
// central NO lo re-chequea en la ingesta de sync (D8). El motivo se persiste
// local y viaja en el payload del Outbox (`Crear` / `Cerrar`).

const TM_ID = '11111111-1111-1111-1111-111111111111'

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

function habilitarIngresoManual(cotas: { min: number | null; max: number | null }): void {
  guardarConfigIngresoManual(db, {
    permiteIngresoManual: true,
    pesoMinimoManual: cotas.min,
    pesoMaximoManual: cotas.max,
  })
}

async function crearBoleta(body: Record<string, unknown>): Promise<Response> {
  return fetch(`${baseUrl}/boletas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      numeroBoletaPrefijo: 'REC',
      codigoBascula: 'B1',
      tipoMovimientoId: TM_ID,
      usuarioIngreso: 'operador@naturaceites.com',
      creadaOffline: true,
      ...body,
    }),
  })
}

beforeEach(async () => {
  db = new Database(':memory:')
  inicializarEsquemaLocal(db)
  _inyectarDbParaPruebas(db)
  await arrancarServidor()
})

afterEach(() => {
  stopLocalServer()
  _inyectarDbParaPruebas(null)
  db.close()
})

describe('POST /boletas — gate de ingreso manual', () => {
  it('flag deshabilitado + origen Manual → 422 y no crea la boleta', async () => {
    const res = await crearBoleta({
      pesoIngreso: 500,
      origenPesoIngreso: 'Manual',
      motivoPesoManual: 'CorteEnergia',
    })

    expect(res.status).toBe(422)
    expect(listarOutboxLocal()).toHaveLength(0)
  })

  it('flag habilitado pero sin motivo → 422', async () => {
    habilitarIngresoManual({ min: null, max: null })

    const res = await crearBoleta({ pesoIngreso: 500, origenPesoIngreso: 'Manual' })

    expect(res.status).toBe(422)
  })

  it('flag habilitado con motivo fuera de catálogo → 422', async () => {
    habilitarIngresoManual({ min: null, max: null })

    const res = await crearBoleta({
      pesoIngreso: 500,
      origenPesoIngreso: 'Manual',
      motivoPesoManual: 'PorqueSi',
    })

    expect(res.status).toBe(422)
  })

  it('motivo Otro sin detalle → 422; con detalle → 201', async () => {
    habilitarIngresoManual({ min: null, max: null })

    const sinDetalle = await crearBoleta({
      pesoIngreso: 500,
      origenPesoIngreso: 'Manual',
      motivoPesoManual: 'Otro',
    })
    expect(sinDetalle.status).toBe(422)

    const conDetalle = await crearBoleta({
      pesoIngreso: 500,
      origenPesoIngreso: 'Manual',
      motivoPesoManual: 'Otro',
      motivoPesoManualDetalle: 'Indicador con lectura errática, se pesa a mano',
    })
    expect(conDetalle.status).toBe(201)
  })

  it('peso fuera de las cotas locales → 422 (por debajo y por encima)', async () => {
    habilitarIngresoManual({ min: 100, max: 9000 })

    const bajo = await crearBoleta({
      pesoIngreso: 50,
      origenPesoIngreso: 'Manual',
      motivoPesoManual: 'IndicadorSinSenal',
    })
    expect(bajo.status).toBe(422)

    const alto = await crearBoleta({
      pesoIngreso: 99999,
      origenPesoIngreso: 'Manual',
      motivoPesoManual: 'IndicadorSinSenal',
    })
    expect(alto.status).toBe(422)
  })

  it('sin cotas configuradas, peso <= 0 → 422', async () => {
    habilitarIngresoManual({ min: null, max: null })

    const res = await crearBoleta({
      pesoIngreso: 0,
      origenPesoIngreso: 'Manual',
      motivoPesoManual: 'IndicadorEnReparacion',
    })

    expect(res.status).toBe(422)
  })

  it('happy path: persiste el motivo y el payload Crear del Outbox lo lleva', async () => {
    habilitarIngresoManual({ min: 100, max: 9000 })

    const res = await crearBoleta({
      pesoIngreso: 4200,
      origenPesoIngreso: 'Manual',
      motivoPesoManual: 'CorteEnergia',
      motivoPesoManualDetalle: 'Corte general de la zona',
    })
    expect(res.status).toBe(201)
    const boleta = (await res.json()) as { id: string }

    const persistida = obtenerBoletaLocal(boleta.id)
    expect(persistida?.motivoPesoManual).toBe('CorteEnergia')
    expect(persistida?.motivoPesoManualDetalle).toBe('Corte general de la zona')

    const crear = listarOutboxLocal().find((e) => e.operacion === 'Crear')
    expect(crear).toBeDefined()
    const payload = JSON.parse(crear!.payload) as Record<string, unknown>
    expect(payload.origenPesoIngreso).toBe('Manual')
    expect(payload.motivoPesoManual).toBe('CorteEnergia')
    expect(payload.motivoPesoManualDetalle).toBe('Corte general de la zona')
  })

  it('origen automático no exige motivo aunque el flag esté deshabilitado', async () => {
    const res = await crearBoleta({ pesoIngreso: 500, origenPesoIngreso: 'Bascula' })
    expect(res.status).toBe(201)
  })
})

describe('POST /boletas/:id/cerrar — gate de ingreso manual', () => {
  async function crearEnTransito(): Promise<string> {
    const res = await crearBoleta({ pesoIngreso: 1000, origenPesoIngreso: 'Bascula' })
    const boleta = (await res.json()) as { id: string }
    return boleta.id
  }

  it('salida Manual + flag deshabilitado → 422', async () => {
    const id = await crearEnTransito()

    const res = await fetch(`${baseUrl}/boletas/${id}/cerrar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pesoSalida: 400,
        origenPesoSalida: 'Manual',
        motivoPesoManual: 'CorteEnergia',
        usuarioSalida: 'operador@naturaceites.com',
      }),
    })

    expect(res.status).toBe(422)
    expect(obtenerBoletaLocal(id)?.estado).toBe('EnTransito')
  })

  it('happy path: el payload Cerrar del Outbox lleva el motivo de salida', async () => {
    habilitarIngresoManual({ min: null, max: null })
    const id = await crearEnTransito()

    const res = await fetch(`${baseUrl}/boletas/${id}/cerrar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pesoSalida: 400,
        origenPesoSalida: 'Manual',
        motivoPesoManual: 'IndicadorSinSenal',
        usuarioSalida: 'operador@naturaceites.com',
      }),
    })
    expect(res.status).toBe(200)

    expect(obtenerBoletaLocal(id)?.motivoPesoManual).toBe('IndicadorSinSenal')

    const cerrar = listarOutboxLocal().find((e) => e.operacion === 'Cerrar')
    expect(cerrar).toBeDefined()
    const payload = JSON.parse(cerrar!.payload) as Record<string, unknown>
    expect(payload.origenPesoSalida).toBe('Manual')
    expect(payload.motivoPesoManual).toBe('IndicadorSinSenal')
  })
})
