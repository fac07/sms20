import Database from 'better-sqlite3'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _inyectarDbParaPruebas,
  guardarConfigIngresoManual,
  inicializarEsquemaLocal,
  leerConfigIngresoManual,
  listarOutboxLocal,
  obtenerBoletaLocal,
  upsertPreIngresosLocal,
  upsertVinculosLocal,
  vinculosPorTransportistaLocal,
  type PreIngresoLocal,
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

describe('cola de transporte (PreIngreso) — read path del selector de pesaje (slice 4)', () => {
  const pre = (
    id: string,
    estado: string,
    numeroEnvio: string,
    extra: Partial<PreIngresoLocal> = {},
  ): PreIngresoLocal => ({
    id,
    centroId: 'centro-1',
    pilotoId: null,
    transportistaId: null,
    equipoId: null,
    regionId: null,
    fincaId: null,
    numeroEnvio,
    pesoEnviado: 20000,
    racimos: 100,
    sacos: null,
    estado,
    boletaId: null,
    usuarioCreacion: 'admin',
    usuarioCancela: null,
    motivoCancelacion: null,
    fechaCreacion: '2026-09-01T00:00:00Z',
    fechaModificacion: '2026-09-01T00:00:00Z',
    ...extra,
  })

  beforeEach(async () => {
    db.exec(`
      INSERT INTO ConfiguracionLocal (Clave, Valor) VALUES ('BasculaId', 'ba-1'), ('BasculaCodigo', 'B01')
      ON CONFLICT(Clave) DO UPDATE SET Valor = excluded.Valor;
      INSERT INTO TipoMovimiento (Id, Codigo, Nombre, Prefijo, Direccion, OperacionD365, GeneraQR, FormatoBoletaId, Activo)
        VALUES ('tm-1', 'REC', 'Recepcion', 'REC', 'Entrada', NULL, 0, NULL, 1);
    `)
    upsertPreIngresosLocal([
      pre('p1', 'Pendiente', 'ENV-2026-001'),
      pre('p2', 'Pendiente', 'ENV-2026-777'),
      pre('p3', 'Vinculado', 'ENV-2026-999'),
    ])
    await arrancarServidor()
  })

  it('GET /preingreso sirve solo los Pendiente del espejo local', async () => {
    const res = await fetch(`${baseUrl}/preingreso?estado=Pendiente`)
    expect(res.status).toBe(200)
    const cuerpo = (await res.json()) as Array<{ id: string; numeroEnvio: string }>
    expect(cuerpo.map((p) => p.id).sort()).toEqual(['p1', 'p2'])
  })

  it('GET /preingreso?numeroEnvio= filtra por coincidencia parcial', async () => {
    const res = await fetch(`${baseUrl}/preingreso?numeroEnvio=001`)
    const cuerpo = (await res.json()) as Array<{ id: string }>
    expect(cuerpo.map((p) => p.id)).toEqual(['p1'])
  })

  it('GET /preingreso/:id devuelve el registro y conserva el 404', async () => {
    const encontrado = await fetch(`${baseUrl}/preingreso/p1`)
    expect(encontrado.status).toBe(200)
    expect((await encontrado.json()) as Record<string, unknown>).toMatchObject({
      id: 'p1',
      numeroEnvio: 'ENV-2026-001',
      pesoEnviado: 20000,
      estado: 'Pendiente',
    })

    const ausente = await fetch(`${baseUrl}/preingreso/no-existe`)
    expect(ausente.status).toBe(404)
  })

  it('POST /boletas reenvía preIngresoId a crearBoletaLocal y el payload del Outbox lo lleva', async () => {
    const res = await fetch(`${baseUrl}/boletas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        numeroBoletaPrefijo: 'REC',
        codigoBascula: 'B01',
        tipoMovimientoId: 'tm-1',
        pesoIngreso: 1000,
        origenPesoIngreso: 'Bascula',
        usuarioIngreso: 'operador',
        preIngresoId: 'p1',
      }),
    })
    expect(res.status).toBe(201)
    const boleta = (await res.json()) as { id: string }

    expect(obtenerBoletaLocal(boleta.id)?.preIngresoId).toBe('p1')
    const evento = listarOutboxLocal().find(
      (e) => e.operacion === 'Crear' && e.entidadId === boleta.id,
    )
    const payload = JSON.parse(evento!.payload) as { preIngresoId?: string | null }
    expect(payload.preIngresoId).toBe('p1')
  })
})

describe('GET /vinculos — selector de piloto escopado por transportista (PR5)', () => {
  beforeEach(async () => {
    upsertVinculosLocal([
      { id: 'v1', pilotoId: 'pi-1', transportistaId: 'tr-1', activo: true, fechaModificacion: '2026-09-01T00:00:00Z' },
      { id: 'v2', pilotoId: 'pi-2', transportistaId: 'tr-1', activo: true, fechaModificacion: '2026-09-01T00:00:00Z' },
      { id: 'v3', pilotoId: 'pi-3', transportistaId: 'tr-1', activo: false, fechaModificacion: '2026-09-01T00:00:00Z' },
      { id: 'v4', pilotoId: 'pi-4', transportistaId: 'tr-2', activo: true, fechaModificacion: '2026-09-01T00:00:00Z' },
    ])
    await arrancarServidor()
  })

  it('sirve SOLO los vínculos activos del transportista pedido', async () => {
    const res = await fetch(`${baseUrl}/vinculos?transportistaId=tr-1`)
    expect(res.status).toBe(200)
    const cuerpo = (await res.json()) as Array<{ pilotoId: string }>
    expect(cuerpo.map((v) => v.pilotoId).sort()).toEqual(['pi-1', 'pi-2'])
  })

  it('otro transportista devuelve su propia lista, sin mezclar', async () => {
    const res = await fetch(`${baseUrl}/vinculos?transportistaId=tr-2`)
    const cuerpo = (await res.json()) as Array<{ pilotoId: string }>
    expect(cuerpo.map((v) => v.pilotoId)).toEqual(['pi-4'])
  })

  it('sin transportistaId responde 400 en vez de devolver el catálogo entero', async () => {
    const res = await fetch(`${baseUrl}/vinculos`)
    expect(res.status).toBe(400)
  })

  it('un transportista sin enlaces devuelve [] (nunca 5xx)', async () => {
    const res = await fetch(`${baseUrl}/vinculos?transportistaId=tr-sin-enlaces`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })
})

// spec obs #251, capability `boletas` — escenario "Terminal-captured boleta is
// never synchronously rejected for the pair": una boleta capturada offline con
// Piloto=P, Transportista=T sin vínculo activo entre ambos debe guardarse y
// encolarse para sync SIN ningún rechazo por el par (diseño D3 — "no hard
// local guard at POST /boletas... by then the truck is already weighed"). El
// único enforcement síncrono del par vive en central (GuardiaVinculoTransporte,
// PR4); este terminal jamás lo replica. `POST /boletas` solo valida
// `valores` campo por campo (existencia/estado/tipo del Maestro referenciado
// vía `validarValoresLocal` → `motor-campos.ts`), nunca la relación cruzada
// piloto+transportista — no hay ninguna llamada a `vinculosPorTransportistaLocal`
// (ni a ninguna otra función de vínculo) en el handler de `POST /boletas`
// (confirmado por lectura directa de `local-server.ts`).
describe('POST /boletas — par piloto+transportista sin vínculo activo (D3, boletas)', () => {
  const PILOTO_ID = 'piloto-sin-vinculo'
  const TRANSPORTISTA_ID = 'transportista-sin-vinculo'

  beforeEach(async () => {
    db.exec(`
      INSERT INTO ConfiguracionLocal (Clave, Valor) VALUES
        ('BasculaId', 'ba-1'), ('BasculaCodigo', 'B01')
      ON CONFLICT(Clave) DO UPDATE SET Valor = excluded.Valor;
      INSERT INTO TipoMovimiento (Id, Codigo, Nombre, Prefijo, Direccion, OperacionD365, GeneraQR, FormatoBoletaId, Activo)
        VALUES ('tm-1', 'REC', 'Recepcion', 'REC', 'Entrada', NULL, 0, NULL, 1);
      INSERT INTO Seccion (Id, Clave, Nombre, Cardinalidad, Reportable, Estandar, Orden, Activa, FechaModificacion)
        VALUES ('s-transporte', 'transporte', 'Transporte', 'Unica', 0, 1, 1, 1, '2026-01-01T00:00:00Z');
      INSERT INTO Campo (Id, SeccionId, Clave, Etiqueta, TipoCampo, TipoCatalogoRef, Requerido, Configuracion, Orden, VigenteDesde, VigenteHasta, FechaModificacion)
        VALUES
          ('c-piloto', 's-transporte', 'piloto', 'Piloto', 'ReferenciaMaestro', 'Piloto', 1, NULL, 1, '2026-01-01T00:00:00Z', NULL, '2026-01-01T00:00:00Z'),
          ('c-transportista', 's-transporte', 'transportista', 'Transportista', 'ReferenciaMaestro', 'Transportista', 1, NULL, 2, '2026-01-01T00:00:00Z', NULL, '2026-01-01T00:00:00Z');
      INSERT INTO TipoMovimientoSeccion (TipoMovimientoId, SeccionId, VigenteDesde, VigenteHasta, Requerida, Orden, FechaModificacion)
        VALUES ('tm-1', 's-transporte', '2026-01-01T00:00:00Z', NULL, 1, 1, '2026-01-01T00:00:00Z');
      INSERT INTO Maestro (Id, TipoCatalogo, Codigo, Nombre, DatosAdicionales, Estado, FusionadoConId, FechaModificacion, Activo) VALUES
        ('${PILOTO_ID}', 'Piloto', 'P-900', 'Piloto Sin Vinculo', NULL, 'Activo', NULL, '2026-01-01T00:00:00Z', 1),
        ('${TRANSPORTISTA_ID}', 'Transportista', 'T-900', 'Transportista Sin Vinculo', NULL, 'Activo', NULL, '2026-01-01T00:00:00Z', 1);
    `)
    // Deliberadamente NO se inserta ninguna fila en VinculoPilotoTransportista:
    // el par P/T no tiene enlace activo, ni siquiera un espejo obsoleto.
    await arrancarServidor()
  })

  it('guarda localmente y encola para sync sin rechazar el par sin vínculo', async () => {
    // Precondición explícita: confirma que el espejo local NO tiene ningún
    // vínculo activo para este transportista antes de intentar el guardado.
    expect(vinculosPorTransportistaLocal(TRANSPORTISTA_ID)).toEqual([])

    const res = await fetch(`${baseUrl}/boletas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        numeroBoletaPrefijo: 'REC',
        codigoBascula: 'B01',
        tipoMovimientoId: 'tm-1',
        pesoIngreso: 18500,
        origenPesoIngreso: 'Bascula',
        usuarioIngreso: 'operador',
        creadaOffline: true,
        valores: [
          { campoId: 'c-piloto', ocurrencia: 0, valorMaestroId: PILOTO_ID },
          { campoId: 'c-transportista', ocurrencia: 0, valorMaestroId: TRANSPORTISTA_ID },
        ],
      }),
    })

    // El guardado local NUNCA rechaza por el par piloto+transportista —
    // ninguna validación cruzada corre en este terminal (D3).
    expect(res.status).toBe(201)
    const boleta = (await res.json()) as { id: string }

    expect(obtenerBoletaLocal(boleta.id)).not.toBeNull()

    // Queda encolada para sync como cualquier otra boleta — el par sin
    // vínculo no bloquea ni retrasa el Outbox.
    const evento = listarOutboxLocal().find(
      (e) => e.operacion === 'Crear' && e.entidadId === boleta.id,
    )
    expect(evento).toBeDefined()
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
        // El seed inicial de /aprovisionamiento dispara sincronizarMaestros(),
        // que ahora también delta-pide el vínculo piloto-transportista (PR5).
        if (u.pathname === '/api/vinculos-piloto-transportista') {
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
        if (u.pathname === '/api/vinculos-piloto-transportista') {
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

    const centroId = (
      db.prepare("SELECT Valor FROM ConfiguracionLocal WHERE Clave = 'BasculaCentroId'").get() as
        | { Valor: string }
        | undefined
    )?.Valor
    expect(centroId).toBe('centro-9')
  })
})

describe('GET /configuracion-centro — defaults de ubicacion espejados', () => {
  beforeEach(arrancarServidor)

  const seedUbicacionDefaults = (json: string) =>
    db.prepare(
      `INSERT INTO ConfiguracionLocal (Clave, Valor) VALUES ('UbicacionDefaults', ?)
       ON CONFLICT(Clave) DO UPDATE SET Valor = excluded.Valor`,
    ).run(json)

  it('devuelve objeto vacio si nunca sincronizo (default-deny, nunca 404/5xx)', async () => {
    const res = await fetch(`${baseUrl}/configuracion-centro`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({})
  })

  it('devuelve el cuarteto espejado, nulls incluidos', async () => {
    seedUbicacionDefaults(
      JSON.stringify({
        sitioOrigenDefaultId: 'sit-org',
        sitioDestinoDefaultId: null,
        almacenOrigenDefaultId: 'alm-org',
        almacenDestinoDefaultId: 'alm-des',
      }),
    )

    const res = await fetch(`${baseUrl}/configuracion-centro`)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      sitioOrigenDefaultId: 'sit-org',
      sitioDestinoDefaultId: null,
      almacenOrigenDefaultId: 'alm-org',
      almacenDestinoDefaultId: 'alm-des',
    })
  })

  it('JSON corrupto en el espejo degrada a vacio sin tumbar el server', async () => {
    seedUbicacionDefaults('no-es-json')

    const res = await fetch(`${baseUrl}/configuracion-centro`)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({})
  })
})
