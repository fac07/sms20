import cors from 'cors'
import express from 'express'
import type { Server } from 'node:http'
import {
  anularBoletaLocal,
  cerrarBoletaLocal,
  crearBoletaLocal,
  getConfig,
  listarBoletasLocal,
  listarMaestrosLocal,
  listarOutboxLocal,
  listarTiposMovimientoLocal,
  obtenerBoletaLocal,
  resolverCamposLocal,
  setConfig,
  validarCierreLocal,
  validarValoresLocal,
} from './db'
import type { EstadoOutboxLocal, OrigenPesoLocal } from './db'
import type { ValorCampo } from './motor-campos'
import { crearPesoProvider, PesoProviderSimulado } from './peso-provider'
import type { OrigenPeso } from './peso-provider'
import { despacharOutboxPendiente } from './outbox-dispatcher'
import { sincronizarMaestros } from './maestros-sync'
import { obtenerEstadoConfigSync, sincronizarConfigLocal } from './config-sync'

// Mismo origen hardcodeado que ya usan outbox-dispatcher.ts y los servicios
// Angular — cada archivo tiene su propia copia a propósito (no hay un módulo
// de config compartido en este repo todavía, no vale la pena inventarlo acá).
const CENTRAL_API_URL = 'http://localhost:5094'

let server: Server | null = null

/**
 * Normaliza el arreglo `valores` crudo del body a `ValorCampo[]` — keyed por
 * `campoId` + `ocurrencia`, con un único slot tipado por entrada. Entradas que
 * no son objetos con `campoId` string se descartan; la validación de tipo/config
 * la hace después `validarValoresLocal` (motor). Un `valores` ausente → `[]`.
 */
function normalizarValores(crudo: unknown): ValorCampo[] {
  if (!Array.isArray(crudo)) return []

  const valores: ValorCampo[] = []
  for (const entrada of crudo) {
    if (typeof entrada !== 'object' || entrada === null) continue
    const v = entrada as Record<string, unknown>
    if (typeof v['campoId'] !== 'string') continue

    valores.push({
      campoId: v['campoId'],
      ocurrencia: typeof v['ocurrencia'] === 'number' ? v['ocurrencia'] : 0,
      valorTexto: typeof v['valorTexto'] === 'string' ? v['valorTexto'] : null,
      valorNumero: typeof v['valorNumero'] === 'number' ? v['valorNumero'] : null,
      valorFecha: typeof v['valorFecha'] === 'string' ? v['valorFecha'] : null,
      valorBooleano: typeof v['valorBooleano'] === 'boolean' ? v['valorBooleano'] : null,
      valorMaestroId: typeof v['valorMaestroId'] === 'string' ? v['valorMaestroId'] : null,
    })
  }
  return valores
}

/**
 * Servidor HTTP local (127.0.0.1) embebido en el proceso principal de
 * Electron. El renderer habla con este mismo contrato tanto si la báscula
 * está offline (todo se resuelve acá, contra SQLite) como si el backend
 * central respondiera directo — la UI no necesita dos caminos distintos.
 *
 * Cubre por ahora el flujo de aprovisionamiento inicial (primer arranque):
 * el operador escribe un código corto, la app lo cambia por la config
 * completa de esta báscula (Bascula.Codigo, TipoConexion, Puerto/IP,
 * CentroId, ...) más el snapshot inicial de Maestro. Ver la sección
 * "Aprovisionamiento" del esquema.
 */
export function startLocalServer(port: number, esDev: boolean): Server {
  const app = express()

  // Este servidor solo escucha en loopback (127.0.0.1) — nunca es alcanzable
  // desde fuera de esta máquina — así que abrir CORS a cualquier origen acá
  // no es el mismo riesgo que en el backend central. Sin esto, el renderer
  // (que corre en su propio origen: localhost:4200 en dev, file:// empaquetado)
  // no puede pegarle a este puerto — el browser bloquea el fetch antes de
  // que la request salga.
  app.use(cors())
  app.use(express.json())

  // Un único provider para toda la vida del servidor — en dev es el mismo
  // objeto en memoria que las rutas de abajo leen y escriben.
  const provider = crearPesoProvider(esDev)

  app.get('/estado', (_req, res) => {
    const basculaId = getConfig('BasculaId')
    const basculaCodigo = getConfig('BasculaCodigo')
    res.json({
      aprovisionada: Boolean(basculaId),
      basculaId: basculaId ?? null,
      basculaCodigo: basculaCodigo ?? null,
      // Campos de hardware guardados por /aprovisionamiento — sin pantalla
      // que los use todavía, pero acá al lado de basculaCodigo es donde una
      // futura screen de config de hardware va a esperar encontrarlos.
      basculaTipoConexion: getConfig('BasculaTipoConexion') ?? null,
      basculaPuerto: getConfig('BasculaPuerto') || null,
      basculaIp: getConfig('BasculaIp') || null,
      basculaPuertoTcp: getConfig('BasculaPuertoTcp') || null,
      basculaVelocidad: getConfig('BasculaVelocidad') || null,
      basculaBitsDatos: getConfig('BasculaBitsDatos') || null,
      basculaModoComunicacion: getConfig('BasculaModoComunicacion') || null,
      dev: esDev,
    })
  })

  app.get('/peso', (_req, res) => {
    res.json(provider.obtenerPesoActual())
  })

  if (esDev) {
    // Solo existe en dev: si no es dev, ni siquiera se registra la ruta —
    // una petición ahí debe dar 404 como cualquier ruta desconocida, no una
    // rama 4xx deliberada.
    app.post('/peso-simulado', (req, res) => {
      const { peso, origen } = req.body as { peso?: number; origen?: OrigenPeso }
      if (typeof peso !== 'number' || !Number.isFinite(peso)) {
        res.status(400).json({ error: 'El peso debe ser un número finito.' })
        return
      }

      // Seguro: esta ruta solo se registra cuando esDev es true, y
      // crearPesoProvider(true) siempre devuelve un PesoProviderSimulado.
      ;(provider as PesoProviderSimulado).establecerPeso(peso, origen ?? 'Bascula')
      res.json(provider.obtenerPesoActual())
    })

    // Sirve para sembrar BasculaId/BasculaCodigo a mano mientras
    // /aprovisionamiento sigue siendo un stub (501 más abajo) — no reemplaza
    // ese flujo real, solo destraba probar el resto de la app sin él.
    app.post('/dev/config', (req, res) => {
      const { clave, valor } = req.body as { clave?: string; valor?: string }
      if (!clave || valor === undefined) {
        res.status(400).json({ error: 'Faltan clave y/o valor.' })
        return
      }

      setConfig(clave, valor)
      res.json({ clave, valor })
    })
  }

  // Formulario de campos configurables — resuelto 100% contra el espejo local
  // de configuración (Seccion/Campo/TipoMovimientoSeccion), sin ninguna llamada
  // a central. Devuelve `CampoAplicable[]` (mismo shape camelCase que
  // `GET /api/tipos-movimiento/:id/formulario` del central) resuelto as-of el
  // instante actual — el renderer arma el formulario reactivo con esto.
  // Tipos de movimiento — read path local del dropdown de Pesaje, servido 100%
  // del espejo SQLite (sin llamada a central), mismo posture que `GET /maestros`.
  // Por default solo `Activo = 1` (`?incluirInactivos=true` para traer todos).
  // Espejo vacío (nunca sincronizado) → `200 []`, nunca 5xx: la UI muestra su
  // aviso de "sin conexión" sin bloquear.
  app.get('/tipos-movimiento', (req, res) => {
    const incluirInactivos = req.query.incluirInactivos === 'true'
    res.json(listarTiposMovimientoLocal(incluirInactivos))
  })

  app.get('/tipos-movimiento/:id/formulario', (req, res) => {
    res.json(resolverCamposLocal(req.params.id, new Date().toISOString()))
  })

  // Boletas — este es el flujo real (offline-first): la boleta nace acá,
  // en SQLite, y queda EstadoSync='Local' hasta que exista el Outbox de
  // sincronización. Compará con POST /api/boletas del backend central, que
  // hoy es solo un endpoint de prueba usado para poblar datos vía curl
  // mientras no existía esta capa. El shape de las rutas mirrorea
  // /api/boletas del central (sin el prefijo /api, que sobra acá porque
  // este servidor ya está scopeado a esta báscula) para que el futuro
  // Outbox y el cliente HTTP del renderer puedan reusar DTOs casi iguales.
  app.get('/boletas', (req, res) => {
    const estado = req.query.estado as string | undefined
    res.json(listarBoletasLocal(estado))
  })

  app.get('/boletas/:id', (req, res) => {
    const boleta = obtenerBoletaLocal(req.params.id)
    if (!boleta) {
      res.status(404).json({ error: 'No existe esa boleta.' })
      return
    }
    res.json(boleta)
  })

  app.post('/boletas', (req, res) => {
    const body = req.body as {
      numeroBoletaPrefijo?: string
      codigoBascula?: string
      tipoMovimientoId?: string
      pesoIngreso?: number
      origenPesoIngreso?: OrigenPesoLocal
      usuarioIngreso?: string
      creadaOffline?: boolean
      valores?: unknown
    }

    if (typeof body.pesoIngreso !== 'number' || !Number.isFinite(body.pesoIngreso)) {
      res.status(400).json({ error: 'El peso debe ser un número finito.' })
      return
    }

    const tipoMovimientoId = body.tipoMovimientoId ?? ''
    const valores = normalizarValores(body.valores)
    // asOf compartido entre validación y persistencia: se congela acá y se pasa
    // a crearBoletaLocal para que el conjunto de campos vigente sea el mismo en
    // ambos pasos.
    const fechaHoraIngreso = new Date().toISOString()

    // Bloqueo de creación: un `campoId` fuera del conjunto vigente as-of, o un
    // valor que viola su tipo/config, aborta con la lista de `ErrorCampo`
    // (arreglo pelado, igual que `Results.BadRequest(errores)` del central).
    const errores = validarValoresLocal(tipoMovimientoId, fechaHoraIngreso, valores)
    if (errores.length > 0) {
      res.status(400).json(errores)
      return
    }

    const boleta = crearBoletaLocal({
      prefijo: body.numeroBoletaPrefijo ?? '',
      codigoBascula: body.codigoBascula ?? '',
      tipoMovimientoId,
      pesoIngreso: body.pesoIngreso,
      origenPesoIngreso: body.origenPesoIngreso ?? 'Bascula',
      fechaHoraIngreso,
      usuarioIngreso: body.usuarioIngreso ?? '',
      creadaOffline: body.creadaOffline ?? false,
      valores,
    })

    res.status(201).json(boleta)
  })

  app.post('/boletas/:id/cerrar', (req, res) => {
    const { pesoSalida, origenPesoSalida, usuarioSalida, basculaSalidaId } = req.body as {
      pesoSalida?: number
      origenPesoSalida?: OrigenPesoLocal
      usuarioSalida?: string
      basculaSalidaId?: string | null
    }

    const boleta = obtenerBoletaLocal(req.params.id)
    if (!boleta) {
      res.status(404).json({ error: 'No existe esa boleta.' })
      return
    }

    // Máquina de estados: solo se cierra una boleta EnTransito (una ya cerrada o
    // anulada → 409, sin cambios).
    if (boleta.estado !== 'EnTransito') {
      res.status(409).json({ error: 'Solo se puede cerrar una boleta en estado EnTransito.' })
      return
    }

    if (typeof pesoSalida !== 'number' || !Number.isFinite(pesoSalida)) {
      res.status(400).json({ error: 'El peso debe ser un número finito.' })
      return
    }

    // Bloqueo duro de cierre (sin ruta de override): el motor valida contra el
    // conjunto resuelto a asOf = fechaHoraIngreso. Si hay errores → 422 y la
    // boleta se queda EnTransito.
    const errores = validarCierreLocal({
      id: boleta.id,
      tipoMovimientoId: boleta.tipoMovimientoId,
      fechaHoraIngreso: boleta.fechaHoraIngreso,
    })
    if (errores.length > 0) {
      res.status(422).json(errores)
      return
    }

    const cerrada = cerrarBoletaLocal(boleta.id, {
      pesoSalida,
      origenPesoSalida: origenPesoSalida ?? 'Bascula',
      usuarioSalida: usuarioSalida ?? '',
      basculaSalidaId,
    })
    res.json(cerrada)
  })

  app.post('/boletas/:id/anular', (req, res) => {
    const { usuarioAnula, usuarioAutoriza, motivoAnulacion } = req.body as {
      usuarioAnula?: string
      usuarioAutoriza?: string
      motivoAnulacion?: string
    }

    if (!usuarioAnula || !usuarioAutoriza || !motivoAnulacion) {
      res.status(400).json({ error: 'Faltan usuarioAnula, usuarioAutoriza y/o motivoAnulacion.' })
      return
    }

    try {
      const boleta = anularBoletaLocal(req.params.id, { usuarioAnula, usuarioAutoriza, motivoAnulacion })
      if (!boleta) {
        res.status(404).json({ error: 'No existe esa boleta.' })
        return
      }
      res.json(boleta)
    } catch (err) {
      res.status(409).json({ error: (err as Error).message })
    }
  })

  // Las rutas de extensión legacy (calidad / compostera / detalle-fruta /
  // caracteristicas) se eliminaron junto con sus tablas SQLite en el reshape D1:
  // ese contexto ahora son valores configurables (BoletaValorCampo) capturados
  // vía `GET /tipos-movimiento/:id/formulario` + `valores` en `POST /boletas`
  // (slice D4). Cualquier verbo sobre esos paths legacy cae al 404 genérico de
  // Express.

  // Diagnóstico/lectura del Outbox (Parte 1 del patrón Outbox — ver el
  // comentario junto al CREATE TABLE OutboxLocal en db.ts): permite observar
  // los eventos de sync pendientes sin abrir el archivo .sqlite a mano.
  // Sin gating: es solo lectura, no hay nada que proteger acá. El dispatcher
  // que efectivamente los envía al backend central es tarea aparte.
  app.get('/outbox', (req, res) => {
    const estado = req.query.estado as EstadoOutboxLocal | undefined
    res.json(listarOutboxLocal(estado))
  })

  // "Sincronizar ahora" — despacha el OutboxLocal pendiente sin esperar al
  // próximo ciclo del interval en main.ts. No dev-gated: es una función real
  // (un futuro botón "Sync now" en la UI la llama), no una herramienta de
  // desarrollo, y también sirve para probar el dispatcher sin esperar 15s.
  app.post('/outbox/despachar', async (_req, res) => {
    const resultado = await despacharOutboxPendiente()
    res.json(resultado)
  })

  // Maestros — read path local de los combos de Pesaje (ver
  // listarMaestrosLocal en db.ts: siempre Activo=1). Es lo que la pantalla
  // llama en vez de pegarle directo a Central (MaestrosService), así que
  // sigue andando con Central caído.
  app.get('/maestros', (req, res) => {
    const tipoCatalogo = req.query.tipoCatalogo as string | undefined
    res.json(listarMaestrosLocal(tipoCatalogo))
  })

  // "Sincronizar ahora" — mismo patrón que POST /outbox/despachar: no
  // dev-gated, dispara el delta-sync sin esperar el próximo ciclo del
  // interval en main.ts. A diferencia del dispatcher, esto es de solo
  // lectura contra Central, así que un fallo acá no compromete nada local —
  // 502 y listo, no hay estado que marcar como error.
  app.post('/maestros/sincronizar', async (_req, res) => {
    try {
      const resultado = await sincronizarMaestros()
      res.json(resultado)
    } catch (err) {
      res.status(502).json({ error: (err as Error).message })
    }
  })

  // Configuración (secciones/campos/asignaciones) — read path del estado del
  // último sync para la UI (indicador de staleness en Pesaje) y disparo manual,
  // mismo patrón que /maestros. GET /config/estado nunca falla: si nunca
  // sincronizó, lastConfigSyncAt es null y la UI muestra el aviso sin bloquear.
  app.get('/config/estado', (_req, res) => {
    res.json(obtenerEstadoConfigSync())
  })

  // "Sincronizar ahora" — igual que /maestros/sincronizar: no dev-gated, de solo
  // lectura contra Central. Un fallo acá no compromete nada local (la marca de
  // agua no avanza sin batch persistido) — 502 y listo.
  app.post('/config/sincronizar', async (_req, res) => {
    try {
      const resultado = await sincronizarConfigLocal()
      res.json(resultado)
    } catch (err) {
      res.status(502).json({ error: (err as Error).message })
    }
  })

  app.post('/aprovisionamiento', async (req, res) => {
    const { codigo } = req.body as { codigo?: string }
    if (!codigo) {
      res.status(400).json({ error: 'Falta el código de aprovisionamiento.' })
      return
    }

    let response: Response
    try {
      response = await fetch(`${CENTRAL_API_URL}/api/basculas/aprovisionar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo }),
      })
    } catch (err) {
      res.status(502).json({ error: `No se pudo contactar al backend central: ${(err as Error).message}` })
      return
    }

    if (!response.ok) {
      // Reenviamos el status y el cuerpo tal cual — el 404/409/400 de
      // Central trae el mensaje real (código inválido, ya aprovisionada,
      // vencido) y el operador necesita verlo, no una versión genérica.
      let cuerpo: unknown
      try {
        cuerpo = await response.json()
      } catch {
        cuerpo = { error: `HTTP ${response.status}` }
      }
      res.status(response.status).json(cuerpo)
      return
    }

    const dto = (await response.json()) as {
      basculaId: string
      basculaCodigo: string
      basculaNombre: string
      centroId: string
      tipoConexion: string
      puerto: string | null
      ip: string | null
      puertoTcp: number | null
      velocidad: number | null
      bitsDatos: number | null
      modoComunicacion: string | null
    }

    setConfig('BasculaId', dto.basculaId)
    setConfig('BasculaCodigo', dto.basculaCodigo)
    setConfig('BasculaTipoConexion', dto.tipoConexion)
    setConfig('BasculaPuerto', dto.puerto ?? '')
    setConfig('BasculaIp', dto.ip ?? '')
    setConfig('BasculaPuertoTcp', dto.puertoTcp !== null ? String(dto.puertoTcp) : '')
    setConfig('BasculaVelocidad', dto.velocidad !== null ? String(dto.velocidad) : '')
    setConfig('BasculaBitsDatos', dto.bitsDatos !== null ? String(dto.bitsDatos) : '')
    setConfig('BasculaModoComunicacion', dto.modoComunicacion ?? '')

    // Snapshot inicial completo — a partir de acá el sync incremental
    // (interval de main.ts, o /maestros/sincronizar a mano) toma la posta.
    const { descargados } = await sincronizarMaestros()

    res.json({ basculaId: dto.basculaId, basculaCodigo: dto.basculaCodigo, maestrosDescargados: descargados })
  })

  server = app.listen(port, '127.0.0.1')
  return server
}

export function stopLocalServer(): void {
  server?.close()
  server = null
}
