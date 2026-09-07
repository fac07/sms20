import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _inyectarDbParaPruebas,
  aplicarFusionMaestroLocal,
  cerrarBoletaLocal,
  crearBoletaLocal,
  crearMaestroProvisionalLocal,
  inicializarEsquemaLocal,
  listarOutboxLocal,
  obtenerMaestroLocal,
  obtenerUltimaSincronizacionMaestros,
  setConfig,
  upsertMaestrosLocal,
  type MaestroLocal,
} from './db'
import { sincronizarMaestros } from './maestros-sync'

// Slice M4b — merge-apply en el terminal: cuando el delta de maestros trae un
// provisional con FusionadoConId seteado, se reescribe TODA referencia local
// (BoletaValorCampo + payloads de OutboxLocal pendientes) P -> O y se asienta el
// Crear del propio provisional si nunca sincronizó. El watermark solo avanza si
// los rewrites persisten.

const TM_ID = '11111111-1111-1111-1111-111111111111'
const SECCION_ID = '22222222-2222-2222-2222-222222222222'
const CAMPO_REF_ID = '33333333-3333-3333-3333-333333333333'
const OFICIAL_ID = '44444444-4444-4444-4444-444444444444'
const T0 = '2020-01-01T00:00:00.000Z'
const AHORA = '2026-09-06T12:00:00.000Z'

let db: Database.Database

function sembrarCampoReferencia(): void {
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

function crearBoletaConProvisional(provisionalId: string): { id: string } {
  return crearBoletaLocal({
    prefijo: 'REC',
    codigoBascula: 'B1',
    tipoMovimientoId: TM_ID,
    pesoIngreso: 1000,
    origenPesoIngreso: 'Bascula',
    fechaHoraIngreso: AHORA,
    usuarioIngreso: 'op',
    creadaOffline: true,
    valores: [{ campoId: CAMPO_REF_ID, ocurrencia: 0, valorMaestroId: provisionalId }],
  })
}

/** Fila de espejo que simula lo que baja el delta: el provisional ya fusionado. */
function provisionalFusionado(provisional: MaestroLocal): MaestroLocal {
  return {
    ...provisional,
    estado: 'Provisional',
    activo: false,
    fusionadoConId: OFICIAL_ID,
    fechaModificacion: '2026-09-07T00:00:00.000Z',
  }
}

function valoresMaestroDeBoleta(boletaId: string): (string | null)[] {
  return (
    db
      .prepare('SELECT ValorMaestroId FROM BoletaValorCampo WHERE BoletaId = ?')
      .all(boletaId) as Array<{ ValorMaestroId: string | null }>
  ).map((r) => r.ValorMaestroId)
}

beforeEach(() => {
  db = new Database(':memory:')
  inicializarEsquemaLocal(db)
  _inyectarDbParaPruebas(db)
  setConfig('BasculaCodigo', 'B1')
  sembrarCampoReferencia()
})

afterEach(() => {
  _inyectarDbParaPruebas(null)
  db.close()
  vi.unstubAllGlobals()
})

describe('aplicarFusionMaestroLocal (M4b)', () => {
  it('reescribe BoletaValorCampo local y los payloads Outbox Pendiente P -> O, y asienta el Crear del provisional', () => {
    const prov = crearMaestroProvisionalLocal({ tipoCatalogo: 'Transportista', nombre: 'Juan' })
    const boleta = crearBoletaConProvisional(prov.id)
    cerrarBoletaLocal(boleta.id, { pesoSalida: 800, origenPesoSalida: 'Bascula', usuarioSalida: 'op' })

    aplicarFusionMaestroLocal(prov.id, OFICIAL_ID)

    // Filas locales reescritas.
    expect(valoresMaestroDeBoleta(boleta.id)).toEqual([OFICIAL_ID])

    const eventos = listarOutboxLocal()
    const crearBoletaEv = eventos.find((e) => e.tipoEntidad === 'Boleta' && e.operacion === 'Crear')!
    const cerrarBoletaEv = eventos.find((e) => e.tipoEntidad === 'Boleta' && e.operacion === 'Cerrar')!
    expect(JSON.parse(crearBoletaEv.payload).valores[0].valorMaestroId).toBe(OFICIAL_ID)
    expect(JSON.parse(cerrarBoletaEv.payload).valores[0].valorMaestroId).toBe(OFICIAL_ID)

    // El Crear del propio provisional queda asentado (central ya sabe de la fusión).
    const crearProvEv = eventos.find((e) => e.tipoEntidad === 'MaestroProvisional')!
    expect(crearProvEv.estado).toBe('Enviado')
  })

  it('no toca payloads que ya no están Pendiente', () => {
    const prov = crearMaestroProvisionalLocal({ tipoCatalogo: 'Transportista', nombre: 'Ana' })
    const boleta = crearBoletaConProvisional(prov.id)
    const crearEv = listarOutboxLocal().find((e) => e.tipoEntidad === 'Boleta')!
    db.prepare(`UPDATE OutboxLocal SET Estado = 'Enviado' WHERE Id = ?`).run(crearEv.id)

    aplicarFusionMaestroLocal(prov.id, OFICIAL_ID)

    // La fila BoletaValorCampo sí se reescribe (es dato vivo); el payload ya
    // enviado queda histórico, sin tocar.
    expect(valoresMaestroDeBoleta(boleta.id)).toEqual([OFICIAL_ID])
    const enviado = listarOutboxLocal().find((e) => e.id === crearEv.id)!
    expect(JSON.parse(enviado.payload).valores[0].valorMaestroId).toBe(prov.id)
  })
})

describe('upsertMaestrosLocal aplica la fusión del delta (M4b)', () => {
  it('un delta con FusionadoConId reescribe filas + payloads en la misma transacción', () => {
    const prov = crearMaestroProvisionalLocal({ tipoCatalogo: 'Transportista', nombre: 'Juan' })
    const boleta = crearBoletaConProvisional(prov.id)

    upsertMaestrosLocal([provisionalFusionado(obtenerMaestroLocal(prov.id)!)])

    expect(valoresMaestroDeBoleta(boleta.id)).toEqual([OFICIAL_ID])
    expect(obtenerMaestroLocal(prov.id)!.fusionadoConId).toBe(OFICIAL_ID)
  })

  it('si el rewrite falla a mitad de camino, el batch se revierte y el watermark no avanza', () => {
    const prov = crearMaestroProvisionalLocal({ tipoCatalogo: 'Transportista', nombre: 'Juan' })
    crearBoletaConProvisional(prov.id)
    const watermarkPrevio = obtenerUltimaSincronizacionMaestros()

    // Rompe el UPDATE de BoletaValorCampo -> aplicarFusionMaestroLocal tira
    // dentro de la transacción del upsert.
    db.exec('DROP TABLE BoletaValorCampo')

    expect(() =>
      upsertMaestrosLocal([provisionalFusionado(obtenerMaestroLocal(prov.id)!)]),
    ).toThrow()

    expect(obtenerUltimaSincronizacionMaestros()).toBe(watermarkPrevio)
    expect(obtenerMaestroLocal(prov.id)!.fusionadoConId).toBeNull()
  })
})

describe('sincronizarMaestros aplica la fusión del delta (M4b)', () => {
  it('el delta que trae el provisional fusionado reescribe la referencia local', async () => {
    const prov = crearMaestroProvisionalLocal({ tipoCatalogo: 'Transportista', nombre: 'Juan' })
    const boleta = crearBoletaConProvisional(prov.id)

    const dto = {
      id: prov.id,
      tipoCatalogo: 'Transportista',
      codigo: prov.codigo,
      nombre: 'Juan',
      datosAdicionales: null,
      estado: 'Provisional',
      fusionadoConId: OFICIAL_ID,
      fechaModificacion: '2026-09-07T00:00:00.000Z',
      activo: false,
    }
    vi.stubGlobal(
      'fetch',
      (async () => ({ ok: true, status: 200, json: async () => [dto] })) as unknown as typeof fetch,
    )

    const res = await sincronizarMaestros()

    expect(res).toEqual({ descargados: 1 })
    expect(valoresMaestroDeBoleta(boleta.id)).toEqual([OFICIAL_ID])
  })
})
