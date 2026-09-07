import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _inyectarDbParaPruebas,
  crearBoletaLocal,
  crearMaestroProvisionalLocal,
  inicializarEsquemaLocal,
  listarOutboxLocal,
  setConfig,
} from './db'
import type { ValorCampo } from './motor-campos'
import { despacharOutboxPendiente } from './outbox-dispatcher'

// M4a — el dispatcher deja de mandar TODO a /api/boletas/sync: los eventos
// `MaestroProvisional` van a /api/maestros/sync, y un 4xx sobre uno de esos
// eventos lo "parquea" (queda Pendiente, nunca Error) y saltea los eventos que
// dependen de él sin contarlo como intento. Transporte / 5xx / 4xx-en-Boleta
// mantienen el `break` histórico.

const SECCION_ID = '22222222-2222-2222-2222-222222222222'
const CAMPO_REF_ID = '33333333-3333-3333-3333-333333333333'
const TM_ID = '11111111-1111-1111-1111-111111111111'
const T0 = '2020-01-01T00:00:00.000Z'
const AHORA = '2026-09-06T12:00:00.000Z'

let db: Database.Database

/** Siembra una sección Única con un campo `ReferenciaMaestro` para colgarle un `valorMaestroId`. */
function sembrarCampoReferencia(): void {
  db.prepare(
    `INSERT INTO Seccion (Id, Clave, Nombre, Cardinalidad, Reportable, Estandar, Orden, Activa, FechaModificacion)
     VALUES (?, 'transporte', 'Transporte', 'Unica', 0, 0, 1, 1, ?)`,
  ).run(SECCION_ID, T0)

  db.prepare(
    `INSERT INTO Campo (Id, SeccionId, Clave, Etiqueta, TipoCampo, TipoCatalogoRef, Requerido, Configuracion, Orden, VigenteDesde, VigenteHasta, FechaModificacion)
     VALUES (?, ?, 'transportista', 'Transportista', 'ReferenciaMaestro', 'Transportista', 0, NULL, 1, ?, NULL, ?)`,
  ).run(CAMPO_REF_ID, SECCION_ID, T0, T0)
}

function crearBoleta(valores: readonly ValorCampo[]): { id: string } {
  return crearBoletaLocal({
    prefijo: 'REC',
    codigoBascula: 'B1',
    tipoMovimientoId: TM_ID,
    pesoIngreso: 1000,
    origenPesoIngreso: 'Bascula',
    fechaHoraIngreso: AHORA,
    usuarioIngreso: 'operador',
    creadaOffline: true,
    valores,
  })
}

interface Llamada {
  url: string
  body: { basculaCodigo?: string; operacion?: string; payload?: Record<string, unknown> }
}

type Respuesta = { ok: boolean; status: number } | 'throw'

function fakeCentral(
  llamadas: Llamada[],
  responder: (url: string) => Respuesta,
): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    const ruta = typeof url === 'string' ? url : url.toString()
    const body = JSON.parse(String(init?.body)) as Llamada['body']
    llamadas.push({ url: ruta, body })
    const r = responder(ruta)
    if (r === 'throw') throw new Error('ECONNREFUSED: Central inalcanzable')
    return {
      ok: r.ok,
      status: r.status,
      text: async () => (r.ok ? '{}' : `error ${r.status}`),
    }
  }) as unknown as typeof fetch
}

function porEntidad(): Record<string, ReturnType<typeof listarOutboxLocal>[number]> {
  return Object.fromEntries(listarOutboxLocal().map((e) => [e.entidadId, e]))
}

beforeEach(() => {
  db = new Database(':memory:')
  inicializarEsquemaLocal(db)
  _inyectarDbParaPruebas(db)
  setConfig('BasculaCodigo', 'B1')
})

afterEach(() => {
  _inyectarDbParaPruebas(null)
  db.close()
  vi.unstubAllGlobals()
})

describe('outbox-dispatcher — routing por TipoEntidad + park dependency-aware (M4a)', () => {
  it('rutea un evento MaestroProvisional a /api/maestros/sync, no a /api/boletas/sync', async () => {
    crearMaestroProvisionalLocal({ tipoCatalogo: 'Transportista', nombre: 'Juan Perez' })

    const llamadas: Llamada[] = []
    vi.stubGlobal('fetch', fakeCentral(llamadas, () => ({ ok: true, status: 200 })))

    const res = await despacharOutboxPendiente()

    expect(res).toEqual({ enviados: 1, fallidos: 0 })
    expect(llamadas).toHaveLength(1)
    expect(llamadas[0].url).toContain('/api/maestros/sync')
    expect(llamadas[0].url).not.toContain('/api/boletas/sync')
    expect(llamadas[0].body).toMatchObject({
      basculaCodigo: 'B1',
      operacion: 'Crear',
      payload: { nombre: 'Juan Perez', tipoCatalogo: 'Transportista' },
    })
  })

  it('un 4xx en un provisional lo parquea (Pendiente, Intentos+1), saltea la boleta dependiente sin intento, y sigue despachando una boleta no relacionada', async () => {
    sembrarCampoReferencia()
    const prov = crearMaestroProvisionalLocal({ tipoCatalogo: 'Transportista', nombre: 'Juan' })
    const dependiente = crearBoleta([
      { campoId: CAMPO_REF_ID, ocurrencia: 0, valorMaestroId: prov.id },
    ])
    const noRelacionada = crearBoleta([])

    const llamadas: Llamada[] = []
    vi.stubGlobal(
      'fetch',
      fakeCentral(llamadas, (url) =>
        url.includes('/api/maestros/sync') ? { ok: false, status: 422 } : { ok: true, status: 200 },
      ),
    )

    const res = await despacharOutboxPendiente()

    const eventos = porEntidad()

    // provisional: intento fallido, sigue reintentable
    expect(eventos[prov.id].estado).toBe('Pendiente')
    expect(eventos[prov.id].intentos).toBe(1)

    // boleta dependiente: salteada, intacta (un salteo no es un intento)
    expect(eventos[dependiente.id].estado).toBe('Pendiente')
    expect(eventos[dependiente.id].intentos).toBe(0)

    // boleta no relacionada: se despachó igual
    expect(eventos[noRelacionada.id].estado).toBe('Enviado')

    // el dispatcher no POSTeó el evento dependiente; sí el no relacionado
    const boletasPosteadas = llamadas.filter((l) => l.url.includes('/api/boletas/sync'))
    expect(boletasPosteadas).toHaveLength(1)

    expect(res.enviados).toBe(1)
  })

  it('un 5xx corta todo el ciclo (break), como hoy', async () => {
    crearMaestroProvisionalLocal({ tipoCatalogo: 'Transportista', nombre: 'A' })
    const boleta = crearBoleta([])

    const llamadas: Llamada[] = []
    vi.stubGlobal('fetch', fakeCentral(llamadas, () => ({ ok: false, status: 503 })))

    const res = await despacharOutboxPendiente()

    expect(llamadas).toHaveLength(1)
    expect(res).toEqual({ enviados: 0, fallidos: 1 })
    expect(porEntidad()[boleta.id].intentos).toBe(0)
  })

  it('un error de transporte corta todo el ciclo (break), como hoy', async () => {
    crearMaestroProvisionalLocal({ tipoCatalogo: 'Transportista', nombre: 'A' })
    const boleta = crearBoleta([])

    const llamadas: Llamada[] = []
    vi.stubGlobal('fetch', fakeCentral(llamadas, () => 'throw'))

    const res = await despacharOutboxPendiente()

    expect(llamadas).toHaveLength(1)
    expect(res).toEqual({ enviados: 0, fallidos: 1 })
    expect(porEntidad()[boleta.id].intentos).toBe(0)
  })

  it('un 4xx en una Boleta mantiene el break (comportamiento actual sin cambios)', async () => {
    const primera = crearBoleta([])
    const segunda = crearBoleta([])

    const llamadas: Llamada[] = []
    vi.stubGlobal('fetch', fakeCentral(llamadas, () => ({ ok: false, status: 400 })))

    const res = await despacharOutboxPendiente()

    expect(llamadas).toHaveLength(1)
    expect(res).toEqual({ enviados: 0, fallidos: 1 })
    const eventos = porEntidad()
    expect(eventos[primera.id].intentos).toBe(1)
    expect(eventos[segunda.id].intentos).toBe(0)
  })

  it('un provisional que 4xx-ea 11 veces sigue Pendiente (nunca Error) con Intentos=11', async () => {
    const prov = crearMaestroProvisionalLocal({ tipoCatalogo: 'Transportista', nombre: 'A' })

    vi.stubGlobal(
      'fetch',
      fakeCentral([], (url) =>
        url.includes('/api/maestros/sync') ? { ok: false, status: 400 } : { ok: true, status: 200 },
      ),
    )

    for (let i = 0; i < 11; i++) {
      await despacharOutboxPendiente()
    }

    const evento = listarOutboxLocal().find((e) => e.entidadId === prov.id)
    expect(evento?.estado).toBe('Pendiente')
    expect(evento?.intentos).toBe(11)
  })
})
