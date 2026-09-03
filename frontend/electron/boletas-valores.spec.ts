import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _inyectarDbParaPruebas,
  cerrarBoletaLocal,
  crearBoletaLocal,
  inicializarEsquemaLocal,
  listarOutboxLocal,
  listarValoresLocal,
  obtenerBoletaLocal,
  setConfig,
  validarCierreLocal,
} from './db'
import { despacharOutboxPendiente } from './outbox-dispatcher'

// Regresión D4.6 — una boleta cuyo TipoMovimiento tiene una sección requerida
// asignada se crea, se cierra y se sincroniza 100% offline-first. El bug latente
// que esto cubre: el payload 'Crear' del Outbox no llevaba `valores`, así que el
// motor de central rechazaba la boleta (sección requerida sin ocurrencia) y la
// dejaba en ErrorCentral para siempre. Con `valores` en el payload, la ronda
// completa termina en `Cerrada` sin ErrorCentral.

const TM_ID = '11111111-1111-1111-1111-111111111111'
const SECCION_ID = '22222222-2222-2222-2222-222222222222'
const CAMPO_LOTE_ID = '33333333-3333-3333-3333-333333333333'
const T0 = '2020-01-01T00:00:00.000Z'
const AHORA = '2026-09-03T12:00:00.000Z'

let db: Database.Database

/** Siembra una sección requerida (Única) con un único campo Texto requerido. */
function sembrarConfig(): void {
  db.prepare(
    `INSERT INTO Seccion (Id, Clave, Nombre, Cardinalidad, Reportable, Estandar, Orden, Activa, FechaModificacion)
     VALUES (?, 'producto', 'Producto', 'Unica', 0, 0, 1, 1, ?)`,
  ).run(SECCION_ID, T0)

  db.prepare(
    `INSERT INTO Campo (Id, SeccionId, Clave, Etiqueta, TipoCampo, TipoCatalogoRef, Requerido, Configuracion, Orden, VigenteDesde, VigenteHasta, FechaModificacion)
     VALUES (?, ?, 'lote', 'Lote', 'Texto', NULL, 1, NULL, 1, ?, NULL, ?)`,
  ).run(CAMPO_LOTE_ID, SECCION_ID, T0, T0)

  db.prepare(
    `INSERT INTO TipoMovimientoSeccion (TipoMovimientoId, SeccionId, VigenteDesde, VigenteHasta, Requerida, Orden, FechaModificacion)
     VALUES (?, ?, ?, NULL, 1, 1, ?)`,
  ).run(TM_ID, SECCION_ID, T0, T0)
}

interface EventoSyncCapturado {
  operacion: string
  payload: { valores?: unknown[]; [k: string]: unknown }
}

/**
 * Espejo mínimo de `POST /api/boletas/sync`. Corre el mismo criterio que el
 * motor de central para la sección requerida: un evento 'Crear' sin `valores`
 * para un tipo con sección requerida es un 422 (ErrorCentral); con `valores` es
 * un 200.
 */
function fakeCentral(capturados: EventoSyncCapturado[]): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    const ruta = typeof url === 'string' ? url : url.toString()
    if (!ruta.endsWith('/api/boletas/sync')) {
      return { ok: false, status: 404, text: async () => 'ruta desconocida' }
    }

    const body = JSON.parse(String(init?.body)) as {
      operacion: string
      payload: { valores?: unknown[]; [k: string]: unknown }
    }
    capturados.push({ operacion: body.operacion, payload: body.payload })

    const valores = body.payload.valores ?? []
    if (body.operacion === 'Crear' && valores.length === 0) {
      return {
        ok: false,
        status: 422,
        text: async () =>
          JSON.stringify([{ seccionClave: 'producto', campoClave: '(seccion)', ocurrencia: 0 }]),
      }
    }

    return { ok: true, status: 200, text: async () => '{}' }
  }) as unknown as typeof fetch
}

beforeEach(() => {
  db = new Database(':memory:')
  inicializarEsquemaLocal(db)
  _inyectarDbParaPruebas(db)
  sembrarConfig()
  setConfig('BasculaCodigo', 'B1')
})

afterEach(() => {
  _inyectarDbParaPruebas(null)
  db.close()
  vi.unstubAllGlobals()
})

describe('boleta con sección requerida — ronda offline-first (D4.6)', () => {
  it('crea + cierra + sincroniza y el payload Crear lleva valores, sin ErrorCentral, boleta Cerrada', async () => {
    const boleta = crearBoletaLocal({
      prefijo: 'REC',
      codigoBascula: 'B1',
      tipoMovimientoId: TM_ID,
      pesoIngreso: 1000,
      origenPesoIngreso: 'Bascula',
      fechaHoraIngreso: AHORA,
      usuarioIngreso: 'operador',
      creadaOffline: true,
      valores: [{ campoId: CAMPO_LOTE_ID, ocurrencia: 0, valorTexto: 'L-2026-001' }],
    })

    // La fila EAV se persiste con SeccionId derivado server-side desde Campo.
    const persistidos = listarValoresLocal(boleta.id)
    expect(persistidos).toHaveLength(1)
    expect(persistidos[0]).toMatchObject({
      campoId: CAMPO_LOTE_ID,
      ocurrencia: 0,
      valorTexto: 'L-2026-001',
    })

    // La sección requerida ya tiene su ocurrencia → el cierre local no bloquea.
    expect(validarCierreLocal(boleta)).toEqual([])

    const cerrada = cerrarBoletaLocal(boleta.id, {
      pesoSalida: 400,
      origenPesoSalida: 'Bascula',
      usuarioSalida: 'operador',
    })
    expect(cerrada?.estado).toBe('Cerrada')

    const capturados: EventoSyncCapturado[] = []
    vi.stubGlobal('fetch', fakeCentral(capturados))

    const resultado = await despacharOutboxPendiente()

    expect(resultado).toEqual({ enviados: 2, fallidos: 0 })

    const crear = capturados.find((e) => e.operacion === 'Crear')
    expect(crear?.payload.valores).toHaveLength(1)
    const cerrar = capturados.find((e) => e.operacion === 'Cerrar')
    expect(cerrar?.payload.valores).toHaveLength(1)

    // Ningún evento quedó en Error (ErrorCentral) ni Pendiente.
    const outbox = listarOutboxLocal()
    expect(outbox.map((e) => e.estado)).toEqual(['Enviado', 'Enviado'])

    // La boleta local termina Cerrada.
    expect(obtenerBoletaLocal(boleta.id)?.estado).toBe('Cerrada')
  })
})
