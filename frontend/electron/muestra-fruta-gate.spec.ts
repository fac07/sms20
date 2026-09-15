import Database from 'better-sqlite3'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { _inyectarDbParaPruebas, inicializarEsquemaLocal, obtenerBoletaLocal } from './db'
import { startLocalServer, stopLocalServer } from './local-server'

// Gate local de muestra de racimos en `POST /boletas/:id/cerrar`. Espejo de
// `GuardiaMuestraFruta` (central): 0 < verdes + maduros + sobremaduros +
// pasados <= 30 evaluado POR OCURRENCIA de forma independiente — cada
// ocurrencia de detalle_fruta es un envío con su propia muestra física y el
// cap de 30 acota UNA muestra, no la suma del camión. pedúnculo largo NO suma
// (paridad legacy frmCalidadFruta.cs:117-128). Sin contadores capturados el
// guard pasa; central NO re-valida en la ingesta de sync (D3/D8), así que la
// terminal es el punto de enforcement offline.

const TM_ID = '11111111-1111-1111-1111-111111111111'
const SEC_ID = '22222222-2222-2222-2222-222222222222'
const C_FINCA = '33333333-3333-3333-3333-333333333333'
const C_VERDE = '44444444-4444-4444-4444-444444444444'
const C_MADURO = '55555555-5555-5555-5555-555555555555'
const C_SOBRE = '66666666-6666-6666-6666-666666666666'
const C_PASADO = '77777777-7777-7777-7777-777777777777'
const C_PEDUNCULO = '88888888-8888-8888-8888-888888888888'
const M_FINCA = '99999999-9999-9999-9999-999999999999'

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

beforeEach(async () => {
  db = new Database(':memory:')
  inicializarEsquemaLocal(db)
  _inyectarDbParaPruebas(db)

  db.exec(`
    INSERT INTO TipoMovimiento (Id, Codigo, Nombre, Prefijo, Direccion, OperacionD365, GeneraQR, FormatoBoletaId, Activo)
      VALUES ('${TM_ID}', 'IF', 'Ingreso fruta', 'IF', 'Entrada', NULL, 0, NULL, 1);
    INSERT INTO Seccion (Id, Clave, Nombre, Cardinalidad, Reportable, Estandar, Orden, Activa, FechaModificacion)
      VALUES ('${SEC_ID}', 'detalle_fruta', 'Detalle de fruta', 'Repetible', 1, 1, 1, 1, '2026-01-01T00:00:00Z');
    INSERT INTO TipoMovimientoSeccion (TipoMovimientoId, SeccionId, VigenteDesde, VigenteHasta, Requerida, Orden, FechaModificacion)
      VALUES ('${TM_ID}', '${SEC_ID}', '2026-01-01T00:00:00Z', NULL, 0, 1, '2026-01-01T00:00:00Z');
    INSERT INTO Campo (Id, SeccionId, Clave, Etiqueta, TipoCampo, TipoCatalogoRef, Requerido, Configuracion, Orden, VigenteDesde, VigenteHasta, FechaModificacion) VALUES
      ('${C_FINCA}', '${SEC_ID}', 'finca', 'Finca', 'ReferenciaMaestro', 'Finca', 1, NULL, 1, '2026-01-01T00:00:00Z', NULL, '2026-01-01T00:00:00Z'),
      ('${C_VERDE}', '${SEC_ID}', 'racimos_verdes', 'Racimos verdes', 'Entero', NULL, 0, NULL, 2, '2026-01-01T00:00:00Z', NULL, '2026-01-01T00:00:00Z'),
      ('${C_MADURO}', '${SEC_ID}', 'racimos_maduros', 'Racimos maduros', 'Entero', NULL, 0, NULL, 3, '2026-01-01T00:00:00Z', NULL, '2026-01-01T00:00:00Z'),
      ('${C_SOBRE}', '${SEC_ID}', 'racimos_sobremaduros', 'Racimos sobremaduros', 'Entero', NULL, 0, NULL, 4, '2026-01-01T00:00:00Z', NULL, '2026-01-01T00:00:00Z'),
      ('${C_PASADO}', '${SEC_ID}', 'racimos_pasados', 'Racimos pasados', 'Entero', NULL, 0, NULL, 5, '2026-01-01T00:00:00Z', NULL, '2026-01-01T00:00:00Z'),
      ('${C_PEDUNCULO}', '${SEC_ID}', 'racimos_pedunculo_largo', 'Racimos con pedúnculo largo', 'Entero', NULL, 0, NULL, 6, '2026-01-01T00:00:00Z', NULL, '2026-01-01T00:00:00Z');
    INSERT INTO Maestro (Id, TipoCatalogo, Codigo, Nombre, DatosAdicionales, Estado, FusionadoConId, FechaModificacion, Activo)
      VALUES ('${M_FINCA}', 'Finca', 'F-1', 'La Loma', NULL, 'Activo', NULL, '2026-01-01T00:00:00Z', 1);
  `)
  await arrancarServidor()
})

afterEach(() => {
  stopLocalServer()
  _inyectarDbParaPruebas(null)
  db.close()
})

/** Boleta EnTransito con una fila de detalle_fruta (finca + los contadores pedidos). */
function sembrarBoleta(
  id: string,
  valores: Array<[ocurrencia: number, campoId: string, numero: number]>,
): void {
  // Sin contadores queda la ocurrencia 0 con sola la finca (el motor exige el
  // requerido dentro de cada ocurrencia capturada).
  const occs = new Set(valores.length ? valores.map((v) => v[0]) : [0])
  const filas = [
    ...[...occs].map((o) => `('${id}', '${C_FINCA}', ${o}, '${SEC_ID}', NULL, NULL, NULL, NULL, '${M_FINCA}')`),
    ...valores.map(
      ([o, campoId, n]) => `('${id}', '${campoId}', ${o}, '${SEC_ID}', NULL, ${n}, NULL, NULL, NULL)`,
    ),
  ]
  db.exec(`
    INSERT INTO Boleta (
      Id, NumeroBoleta, TipoMovimientoId, Estado, EstadoSync, PesoIngreso, PesoSalida, PesoNeto,
      OrigenPesoIngreso, OrigenPesoSalida, FechaHoraIngreso, FechaHoraSalida, UsuarioIngreso,
      UsuarioSalida, UsuarioAnula, UsuarioAutoriza, MotivoAnulacion, FechaHoraAnulacion,
      PreIngresoId, BoletaReemplazoId, BoletaOrigenId, BasculaSalidaId, RespuestaD365Id,
      CreadaOffline, MotivoPesoManual, MotivoPesoManualDetalle
    ) VALUES ('${id}', 'IF-B01-000001', '${TM_ID}', 'EnTransito', 'Local', 1000, NULL, NULL,
      'Bascula', NULL, '2026-09-08T12:00:00Z', NULL, 'op', NULL, NULL, NULL, NULL, NULL,
      NULL, NULL, NULL, NULL, NULL, 1, NULL, NULL);
    INSERT INTO BoletaValorCampo (
      BoletaId, CampoId, Ocurrencia, SeccionId, ValorTexto, ValorNumero,
      ValorFecha, ValorBooleano, ValorMaestroId
    ) VALUES ${filas.join(',')};
  `)
}

function cerrar(id: string): Promise<Response> {
  return fetch(`${baseUrl}/boletas/${id}/cerrar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pesoSalida: 400, origenPesoSalida: 'Bascula', usuarioSalida: 'op' }),
  })
}

describe('POST /boletas/:id/cerrar — gate local de muestra de racimos', () => {
  it('suma 31 → 400 y la boleta sigue EnTransito', async () => {
    sembrarBoleta('b1', [[0, C_VERDE, 10], [0, C_SOBRE, 21]])

    const res = await cerrar('b1')

    expect(res.status).toBe(400)
    expect(obtenerBoletaLocal('b1')!.estado).toBe('EnTransito')
  })

  it('suma exactamente 30 → cierra', async () => {
    sembrarBoleta('b2', [[0, C_VERDE, 10], [0, C_MADURO, 20]])

    const res = await cerrar('b2')

    expect(res.status).toBe(200)
    expect(obtenerBoletaLocal('b2')!.estado).toBe('Cerrada')
  })

  it('todos los contadores en 0 → 400', async () => {
    sembrarBoleta('b3', [[0, C_VERDE, 0], [0, C_MADURO, 0]])

    const res = await cerrar('b3')

    expect(res.status).toBe(400)
  })

  it('sin ningún contador capturado → el guard no aplica y cierra', async () => {
    sembrarBoleta('b4', [])

    const res = await cerrar('b4')

    expect(res.status).toBe(200)
  })

  it('dos ocurrencias con muestras válidas no se suman entre sí', async () => {
    // Cada ocurrencia de detalle_fruta es un envío con su propia muestra:
    // 25 + 25 = dos muestras válidas. La suma global (50) sería un rechazo
    // sin motivo — el cap de 30 acota UNA muestra física.
    sembrarBoleta('b5', [[0, C_VERDE, 25], [1, C_MADURO, 25]])

    const res = await cerrar('b5')

    expect(res.status).toBe(200)
    expect(obtenerBoletaLocal('b5')!.estado).toBe('Cerrada')
  })

  it('una ocurrencia de 31 es 400 aunque otra ocurrencia sea válida', async () => {
    sembrarBoleta('b7', [[0, C_VERDE, 20], [1, C_MADURO, 31]])

    const res = await cerrar('b7')

    expect(res.status).toBe(400)
    expect(obtenerBoletaLocal('b7')!.estado).toBe('EnTransito')
  })

  it('una ocurrencia en cero es 400 aunque otra ocurrencia sea válida', async () => {
    // Sentido inverso de la granularidad: occ 0 con el contador cargado en 0
    // es una muestra capturada vacía y se rechaza sola, sin que la suma
    // global (25) "salve" el cierre.
    sembrarBoleta('b8', [[0, C_VERDE, 0], [1, C_MADURO, 25]])

    const res = await cerrar('b8')

    expect(res.status).toBe(400)
  })

  it('pedúnculo largo no suma', async () => {
    sembrarBoleta('b6', [[0, C_VERDE, 30], [0, C_PEDUNCULO, 50]])

    const res = await cerrar('b6')

    expect(res.status).toBe(200)
  })
})
