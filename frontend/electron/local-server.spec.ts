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

describe('GET /boletas — proyección local de consulta', () => {
  beforeEach(async () => {
    db.exec(`
      INSERT INTO ConfiguracionLocal (Clave, Valor) VALUES
        ('BasculaId', 'ba-1'), ('BasculaCodigo', 'B01')
      ON CONFLICT(Clave) DO UPDATE SET Valor = excluded.Valor;
      INSERT INTO TipoMovimiento (Id, Codigo, Nombre, Prefijo, Direccion, OperacionD365, GeneraQR, FormatoBoletaId, Activo)
        VALUES ('tm-1', 'REC', 'Recepcion', 'REC', 'Entrada', NULL, 0, NULL, 1);
      INSERT INTO Seccion (Id, Clave, Nombre, Cardinalidad, Reportable, Estandar, Orden, Activa, FechaModificacion)
        VALUES ('s-1', 'producto', 'Producto', 'Unica', 0, 1, 1, 1, '2026-01-01T00:00:00Z');
      INSERT INTO Campo (Id, SeccionId, Clave, Etiqueta, TipoCampo, TipoCatalogoRef, Requerido, Configuracion, Orden, VigenteDesde, VigenteHasta, FechaModificacion)
        VALUES ('c-1', 's-1', 'lote', 'Lote', 'Texto', NULL, 0, NULL, 1, '2026-01-01T00:00:00Z', NULL, '2026-01-01T00:00:00Z');
      INSERT INTO Boleta (
        Id, NumeroBoleta, TipoMovimientoId, Estado, EstadoSync, PesoIngreso, PesoSalida, PesoNeto,
        OrigenPesoIngreso, OrigenPesoSalida, FechaHoraIngreso, FechaHoraSalida, UsuarioIngreso,
        UsuarioSalida, UsuarioAnula, UsuarioAutoriza, MotivoAnulacion, FechaHoraAnulacion,
        PreIngresoId, BoletaReemplazoId, BoletaOrigenId, BasculaSalidaId, RespuestaD365Id,
        CreadaOffline, MotivoPesoManual, MotivoPesoManualDetalle
      ) VALUES ('b-1', 'REC-B01-000001', 'tm-1', 'Cerrada', 'Local', 1000, 400, 600,
        'Bascula', 'Manual', '2026-09-08T12:00:00Z', '2026-09-08T13:00:00Z', 'op', 'op',
        NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, 'Otro', 'Captura autorizada');
      INSERT INTO BoletaValorCampo (
        BoletaId, CampoId, Ocurrencia, SeccionId, ValorTexto, ValorNumero,
        ValorFecha, ValorBooleano, ValorMaestroId
      ) VALUES ('b-1', 'c-1', 0, 's-1', 'L-42', NULL, NULL, NULL, NULL);
    `)
    await arrancarServidor()
  })

  it('embebe detalle compatible con BoletaDto y aplica ambos filtros', async () => {
    const res = await fetch(`${baseUrl}/boletas?estado=Cerrada&origenPeso=Manual`)
    expect(res.status).toBe(200)
    const cuerpo = (await res.json()) as Array<Record<string, unknown>>

    expect(cuerpo).toHaveLength(1)
    expect(cuerpo[0]).toMatchObject({
      id: 'b-1',
      basculaId: 'ba-1',
      basculaCodigo: 'B01',
      tipoMovimientoNombre: 'Recepcion',
      motivoPesoManual: 'Otro',
      motivoPesoManualDetalle: 'Captura autorizada',
    })
    expect(cuerpo[0]['valores']).toEqual([
      expect.objectContaining({
        campoId: 'c-1',
        seccionClave: 'producto',
        seccionNombre: 'Producto',
        campoClave: 'lote',
        etiqueta: 'Lote',
        valorTexto: 'L-42',
      }),
    ])
  })

  it('devuelve el mismo detalle por id y conserva el 404', async () => {
    const encontrado = await fetch(`${baseUrl}/boletas/b-1`)
    expect(encontrado.status).toBe(200)
    expect(((await encontrado.json()) as { valores: unknown[] }).valores).toHaveLength(1)

    const ausente = await fetch(`${baseUrl}/boletas/no-existe`)
    expect(ausente.status).toBe(404)
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

  it('persiste BasculaCentroId desde el AprovisionamientoDto central (prereq del preingreso-sync)', async () => {
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
              centroId: 'centro-9',
              tipoConexion: 'Serial',
              puerto: null,
              ip: null,
              puertoTcp: null,
              velocidad: null,
              bitsDatos: null,
              modoComunicacion: null,
            }),
          }
        }
        if (u.pathname === '/api/maestros') return { ok: true, status: 200, json: async () => [] }
        return { ok: false, status: 404, json: async () => ({}) }
      }) as unknown as typeof fetch,
    )

    const res = await fetch(`${baseUrl}/aprovisionamiento`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigo: 'ABC123' }),
    })
    expect(res.status).toBe(200)

    const centroId = (
      db.prepare("SELECT Valor FROM ConfiguracionLocal WHERE Clave = 'BasculaCentroId'").get() as
        | { Valor: string }
        | undefined
    )?.Valor
    expect(centroId).toBe('centro-9')
  })
})
