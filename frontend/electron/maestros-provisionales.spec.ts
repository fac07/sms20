import Database from 'better-sqlite3'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  _inyectarDbParaPruebas,
  crearBoletaLocal,
  crearMaestroProvisionalLocal,
  inicializarEsquemaLocal,
  listarMaestrosLocal,
  listarOutboxLocal,
  setConfig,
} from './db'
import { startLocalServer, stopLocalServer } from './local-server'

// Slice M1 — la báscula coina un maestro provisional 100% offline: mirror local
// `Maestro` (`Estado=Provisional`, `Activo=1`, `Codigo = PROV-{bascula}-{seq}`)
// + un evento `MaestroProvisional`/`Crear` del OutboxLocal, en la MISMA
// transacción. El contador global `OutboxLocalSecuencia` garantiza que ese
// evento se despache antes que cualquier boleta que lo referencie.

const TM_ID = '11111111-1111-1111-1111-111111111111'
const SECCION_ID = '22222222-2222-2222-2222-222222222222'
const CAMPO_REF_ID = '33333333-3333-3333-3333-333333333333'
const T0 = '2020-01-01T00:00:00.000Z'

let db: Database.Database

/** Sección Única con un único campo `ReferenciaMaestro` (catálogo Transportista). */
function sembrarSeccionReferencia(): void {
  db.prepare(
    `INSERT INTO Seccion (Id, Clave, Nombre, Cardinalidad, Reportable, Estandar, Orden, Activa, FechaModificacion)
     VALUES (?, 'transporte', 'Transporte', 'Unica', 0, 0, 1, 1, ?)`,
  ).run(SECCION_ID, T0)

  db.prepare(
    `INSERT INTO Campo (Id, SeccionId, Clave, Etiqueta, TipoCampo, TipoCatalogoRef, Requerido, Configuracion, Orden, VigenteDesde, VigenteHasta, FechaModificacion)
     VALUES (?, ?, 'transportista', 'Transportista', 'ReferenciaMaestro', 'Transportista', 0, NULL, 1, ?, NULL, ?)`,
  ).run(CAMPO_REF_ID, SECCION_ID, T0, T0)

  db.prepare(
    `INSERT INTO TipoMovimientoSeccion (TipoMovimientoId, SeccionId, VigenteDesde, VigenteHasta, Requerida, Orden, FechaModificacion)
     VALUES (?, ?, ?, NULL, 0, 1, ?)`,
  ).run(TM_ID, SECCION_ID, T0, T0)
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

describe('crearMaestroProvisionalLocal (M1)', () => {
  it('crea el mirror Provisional y su evento MaestroProvisional/Crear en la misma transacción', () => {
    const maestro = crearMaestroProvisionalLocal({ tipoCatalogo: 'Piloto', nombre: 'Juan Pérez' })

    expect(maestro).toMatchObject({
      tipoCatalogo: 'Piloto',
      nombre: 'Juan Pérez',
      estado: 'Provisional',
      activo: true,
      fusionadoConId: null,
    })
    expect(maestro.codigo).toBe('PROV-B1-1')

    // Visible al read path de los combos de Pesaje (siempre Activo = 1).
    expect(listarMaestrosLocal('Piloto').map((m) => m.id)).toContain(maestro.id)

    const eventos = listarOutboxLocal()
    expect(eventos).toHaveLength(1)
    expect(eventos[0]).toMatchObject({
      tipoEntidad: 'MaestroProvisional',
      entidadId: maestro.id,
      operacion: 'Crear',
      estado: 'Pendiente',
    })

    // El payload calza con `MaestroProvisionalPayload` de central (camelCase).
    expect(JSON.parse(eventos[0].payload)).toEqual({
      id: maestro.id,
      tipoCatalogo: 'Piloto',
      codigo: 'PROV-B1-1',
      nombre: 'Juan Pérez',
      datosAdicionales: null,
      fechaCreacion: expect.any(String),
    })
  })

  it('coina el Codigo PROV-{bascula}-{seq} de forma monotónica por báscula', () => {
    const a = crearMaestroProvisionalLocal({ tipoCatalogo: 'Finca', nombre: 'Finca A' })
    const b = crearMaestroProvisionalLocal({ tipoCatalogo: 'Transportista', nombre: 'Trans B' })
    expect([a.codigo, b.codigo]).toEqual(['PROV-B1-1', 'PROV-B1-2'])
  })

  it('ordena el evento del provisional ANTES del evento de la boleta que lo referencia', () => {
    sembrarSeccionReferencia()

    const maestro = crearMaestroProvisionalLocal({ tipoCatalogo: 'Transportista', nombre: 'Trans X' })

    crearBoletaLocal({
      prefijo: 'REC',
      codigoBascula: 'B1',
      tipoMovimientoId: TM_ID,
      pesoIngreso: 1000,
      origenPesoIngreso: 'Bascula',
      fechaHoraIngreso: '2026-09-06T12:00:00.000Z',
      usuarioIngreso: 'op',
      creadaOffline: true,
      valores: [{ campoId: CAMPO_REF_ID, ocurrencia: 0, valorMaestroId: maestro.id }],
    })

    const eventos = listarOutboxLocal()
    const evMaestro = eventos.find((e) => e.tipoEntidad === 'MaestroProvisional')
    const evBoleta = eventos.find((e) => e.tipoEntidad === 'Boleta' && e.operacion === 'Crear')

    expect(evMaestro).toBeDefined()
    expect(evBoleta).toBeDefined()
    expect(evMaestro!.secuencia).toBeLessThan(evBoleta!.secuencia)
  })

  it('es idempotente: reintento con el mismo Guid de cliente no duplica fila ni evento', () => {
    const G = 'aaaaaaaa-1111-1111-1111-111111111111'
    const primero = crearMaestroProvisionalLocal({ id: G, tipoCatalogo: 'Equipo', nombre: 'Equipo 1' })
    const repetido = crearMaestroProvisionalLocal({ id: G, tipoCatalogo: 'Equipo', nombre: 'Equipo 1' })

    expect(repetido.id).toBe(primero.id)
    expect(repetido.codigo).toBe(primero.codigo)
    expect(listarMaestrosLocal('Equipo')).toHaveLength(1)
    expect(listarOutboxLocal()).toHaveLength(1)
  })

  it('un fallo al escribir el Outbox revierte también el mirror', () => {
    db.exec('DROP TABLE OutboxLocalSecuencia')
    expect(() => crearMaestroProvisionalLocal({ tipoCatalogo: 'Piloto', nombre: 'Rollback' })).toThrow()
    expect(listarMaestrosLocal()).toHaveLength(0)
  })
})

describe('POST /maestros + GET /maestros/tipos-provisionables (M1)', () => {
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

  it('GET /maestros/tipos-provisionables devuelve la allow-list sembrada por defecto', async () => {
    const res = await fetch(`${baseUrl}/maestros/tipos-provisionables`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ tipos: ['Piloto', 'Transportista', 'Equipo', 'Finca'] })
  })

  it('POST /maestros crea un provisional para un tipo habilitado -> 201 y aparece en GET /maestros', async () => {
    const res = await fetch(`${baseUrl}/maestros`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipoCatalogo: 'Finca', nombre: 'Finca Nueva' }),
    })
    expect(res.status).toBe(201)
    const maestro = (await res.json()) as { id: string; codigo: string; estado: string; activo: boolean }
    expect(maestro).toMatchObject({ estado: 'Provisional', activo: true })
    expect(maestro.codigo).toMatch(/^PROV-B1-\d+$/)

    const lista = (await (await fetch(`${baseUrl}/maestros?tipoCatalogo=Finca`)).json()) as Array<{ id: string }>
    expect(lista.map((m) => m.id)).toContain(maestro.id)
  })

  it('POST /maestros rechaza un tipo fuera de la allow-list -> 403 y no persiste nada', async () => {
    const res = await fetch(`${baseUrl}/maestros`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipoCatalogo: 'Producto', nombre: 'X' }),
    })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { mensaje: string }).mensaje).toContain('Producto')
    expect(listarMaestrosLocal()).toHaveLength(0)
    expect(listarOutboxLocal()).toHaveLength(0)
  })

  it('POST /maestros con nombre vacío -> 400', async () => {
    const res = await fetch(`${baseUrl}/maestros`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipoCatalogo: 'Piloto', nombre: '   ' }),
    })
    expect(res.status).toBe(400)
  })
})
