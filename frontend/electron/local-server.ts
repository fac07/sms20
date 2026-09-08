import cors from 'cors'
import express from 'express'
import type { Server } from 'node:http'
import {
  anularBoletaLocal,
  cerrarBoletaLocal,
  crearBoletaLocal,
  crearMaestroProvisionalLocal,
  getConfig,
  getDb,
  guardarConfigIngresoManual,
  leerConfigIngresoManual,
  listarBoletasDtoLocal,
  listarEventosTrabados,
  listarMaestrosLocal,
  listarOutboxLocal,
  listarTiposMovimientoLocal,
  MOTIVOS_PESO_MANUAL,
  obtenerBoletaDtoLocal,
  obtenerBoletaLocal,
  obtenerConfigIngresoManual,
  resolverCamposLocal,
  setConfig,
  tiposProvisionalesHabilitados,
  validarCierreLocal,
  validarValoresLocal,
} from './db'
import type { EstadoOutboxLocal, MotivoPesoManual, OrigenPesoLocal } from './db'
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
 * Espejo local de `ValidarPesoManualTipado` (central, BoletaEndpoints.cs). Se
 * corre en `POST /boletas` y `POST /boletas/:id/cerrar` cuando el origen del
 * pesaje es `Manual`. Orden: flag de báscula habilitado → motivo presente y de
 * catálogo → detalle obligatorio cuando el motivo es `Otro` → rango contra las
 * cotas locales (o `> 0` si no hay cotas). Toda falla es 422 (diseño D7: no hay
 * capa de auth, 403 no aplica). Devuelve `null` cuando el pesaje es válido.
 *
 * El rango se valida ACÁ, al tipear — central NO lo re-chequea en la ingesta de
 * sync (diseño D8): los límites pueden editarse centralmente después de una
 * captura offline y rechazar ahí tiraría boletas ya válidas a ErrorCentral.
 */
function validarPesoManualLocal(
  peso: number,
  motivo: string | undefined,
  detalle: string | undefined,
): { status: number; error: string } | null {
  const cfg = leerConfigIngresoManual(getDb())

  if (!cfg.permiteIngresoManual) {
    return {
      status: 422,
      error: 'Esta báscula no tiene habilitado el ingreso manual de peso.',
    }
  }

  if (typeof motivo !== 'string' || !(MOTIVOS_PESO_MANUAL as readonly string[]).includes(motivo)) {
    return {
      status: 422,
      error:
        'Un peso de origen Manual requiere un motivo del catálogo: ' +
        'IndicadorSinSenal, IndicadorEnReparacion, CorteEnergia u Otro.',
    }
  }

  if (motivo === 'Otro' && (typeof detalle !== 'string' || detalle.trim() === '')) {
    return {
      status: 422,
      error: "El motivo 'Otro' requiere un detalle que explique el ingreso manual del peso.",
    }
  }

  const min = cfg.pesoMinimoManual
  const max = cfg.pesoMaximoManual
  if (min === null && max === null) {
    if (peso <= 0) {
      return { status: 422, error: 'El peso manual debe ser mayor que cero.' }
    }
  } else if ((min !== null && peso < min) || (max !== null && peso > max)) {
    return {
      status: 422,
      error:
        `El peso manual ${peso} kg está fuera del rango permitido ` +
        `(${min ?? 'sin cota'} – ${max ?? 'sin cota'} kg).`,
    }
  }

  return null
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
    // Config de ingreso manual de peso — este es EL canal al renderer: viaja en
    // el `GET /estado` que `flushInit` ya flushea, así que S3 no agrega ningún
    // request nuevo en `ngOnInit`. Default-deny si nunca se sincronizó.
    const ingresoManual = obtenerConfigIngresoManual()
    res.json({
      aprovisionada: Boolean(basculaId),
      basculaId: basculaId ?? null,
      basculaCodigo: basculaCodigo ?? null,
      permiteIngresoManual: ingresoManual.permiteIngresoManual,
      pesoMinimoManual: ingresoManual.pesoMinimoManual,
      pesoMaximoManual: ingresoManual.pesoMaximoManual,
      motivosPesoManual: [...ingresoManual.motivosPesoManual],
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
    const origenPeso = req.query.origenPeso as string | undefined
    res.json(listarBoletasDtoLocal(estado, origenPeso))
  })

  app.get('/boletas/:id', (req, res) => {
    const boleta = obtenerBoletaDtoLocal(req.params.id)
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
      motivoPesoManual?: string
      motivoPesoManualDetalle?: string
      valores?: unknown
    }

    if (typeof body.pesoIngreso !== 'number' || !Number.isFinite(body.pesoIngreso)) {
      res.status(400).json({ error: 'El peso debe ser un número finito.' })
      return
    }

    const origenPesoIngreso = body.origenPesoIngreso ?? 'Bascula'

    // Gate de ingreso manual (diseño D7): flag → motivo/catálogo → Otro⇒detalle →
    // rango, todo 422, antes de la validación de `valores` (400). Solo aplica al
    // pesaje Manual; el automático pasa de largo.
    if (origenPesoIngreso === 'Manual') {
      const errorManual = validarPesoManualLocal(
        body.pesoIngreso,
        body.motivoPesoManual,
        body.motivoPesoManualDetalle,
      )
      if (errorManual) {
        res.status(errorManual.status).json({ error: errorManual.error })
        return
      }
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
      origenPesoIngreso,
      fechaHoraIngreso,
      usuarioIngreso: body.usuarioIngreso ?? '',
      creadaOffline: body.creadaOffline ?? false,
      motivoPesoManual:
        origenPesoIngreso === 'Manual'
          ? (body.motivoPesoManual as MotivoPesoManual)
          : null,
      motivoPesoManualDetalle:
        origenPesoIngreso === 'Manual' ? (body.motivoPesoManualDetalle ?? null) : null,
      valores,
    })

    res.status(201).json(boleta)
  })

  app.post('/boletas/:id/cerrar', (req, res) => {
    const {
      pesoSalida,
      origenPesoSalida,
      usuarioSalida,
      basculaSalidaId,
      motivoPesoManual,
      motivoPesoManualDetalle,
    } = req.body as {
      pesoSalida?: number
      origenPesoSalida?: OrigenPesoLocal
      usuarioSalida?: string
      basculaSalidaId?: string | null
      motivoPesoManual?: string
      motivoPesoManualDetalle?: string
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

    const origenSalida = origenPesoSalida ?? 'Bascula'

    // Gate de ingreso manual en el segundo pesaje (mismo criterio que en
    // `POST /boletas`): flag → motivo/catálogo → Otro⇒detalle → rango, todo 422.
    if (origenSalida === 'Manual') {
      const errorManual = validarPesoManualLocal(
        pesoSalida,
        motivoPesoManual,
        motivoPesoManualDetalle,
      )
      if (errorManual) {
        res.status(errorManual.status).json({ error: errorManual.error })
        return
      }
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
      origenPesoSalida: origenSalida,
      usuarioSalida: usuarioSalida ?? '',
      basculaSalidaId,
      motivoPesoManual:
        origenSalida === 'Manual' ? (motivoPesoManual as MotivoPesoManual) : null,
      motivoPesoManualDetalle:
        origenSalida === 'Manual' ? (motivoPesoManualDetalle ?? null) : null,
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

  // Alerta del operador (M4b / decisión de producto 4): eventos
  // `MaestroProvisional` trabados a 5+ intentos. La pantalla de pesaje (M5b) lo
  // consulta en su intervalo y muestra el banner mientras `hayAlertaProvisional`
  // sea true; el pesaje sigue habilitado bajo el banner. Predicado derivado de
  // `OutboxLocal.Intentos` (sin columna nueva, M-D3).
  app.get('/outbox/alertas', (_req, res) => {
    const trabados = listarEventosTrabados()
    res.json({
      hayAlertaProvisional: trabados.length > 0,
      eventos: trabados.map((t) => ({
        entidadId: t.entidadId,
        tipoCatalogo: t.tipoCatalogo,
        nombre: t.nombre,
        intentos: t.intentos,
      })),
    })
  })

  // Maestros — read path local de los combos de Pesaje (ver
  // listarMaestrosLocal en db.ts: siempre Activo=1). Es lo que la pantalla
  // llama en vez de pegarle directo a Central (MaestrosService), así que
  // sigue andando con Central caído.
  app.get('/maestros', (req, res) => {
    const tipoCatalogo = req.query.tipoCatalogo as string | undefined
    res.json(listarMaestrosLocal(tipoCatalogo))
  })

  // Allow-list de tipos de catálogo que se pueden coinar como provisional
  // offline (M1 / decisión de producto 1). El renderer la usa para decidir si
  // muestra el "+ Crear provisional" junto a un combo `ReferenciaMaestro`.
  app.get('/maestros/tipos-provisionables', (_req, res) => {
    res.json({ tipos: tiposProvisionalesHabilitados() })
  })

  // Creación provisional offline (M1): la báscula coina un `Maestro`
  // `Estado=Provisional` + un evento `MaestroProvisional`/`Crear` del OutboxLocal
  // en una sola transacción. `tipoCatalogo` se valida contra la allow-list (403
  // si no está); `nombre` debe ser no vacío (400). El `GET /maestros` de arriba
  // ya filtra `Activo=1`, así que el nuevo provisional aparece en el combo al
  // instante.
  app.post('/maestros', (req, res) => {
    const body = req.body as {
      id?: string
      tipoCatalogo?: string
      nombre?: string
      datosAdicionales?: string | null
    }

    const tipoCatalogo = typeof body.tipoCatalogo === 'string' ? body.tipoCatalogo : ''
    const nombre = typeof body.nombre === 'string' ? body.nombre.trim() : ''

    if (!tiposProvisionalesHabilitados().includes(tipoCatalogo)) {
      res.status(403).json({
        mensaje: `El tipo de catálogo "${tipoCatalogo}" no está habilitado para creación provisional offline.`,
      })
      return
    }

    if (nombre.length === 0) {
      res.status(400).json({ mensaje: 'El nombre es requerido.' })
      return
    }

    if (!getConfig('BasculaCodigo')) {
      res.status(409).json({ mensaje: 'Esta báscula no tiene código configurado.' })
      return
    }

    const maestro = crearMaestroProvisionalLocal({
      id: typeof body.id === 'string' && body.id.length > 0 ? body.id : undefined,
      tipoCatalogo,
      nombre,
      datosAdicionales: typeof body.datosAdicionales === 'string' ? body.datosAdicionales : null,
    })
    res.status(201).json(maestro)
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
      permiteIngresoManual?: boolean
      pesoMinimoManual?: number | null
      pesoMaximoManual?: number | null
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

    // Cold-start seed del trío de ingreso manual — S1a lo sumó al
    // `AprovisionamientoDto` central para que la terminal quede correcta al
    // segundo 0 en vez de esperar hasta 60s al primer tick de config-sync.
    guardarConfigIngresoManual(getDb(), {
      permiteIngresoManual: Boolean(dto.permiteIngresoManual),
      pesoMinimoManual: dto.pesoMinimoManual ?? null,
      pesoMaximoManual: dto.pesoMaximoManual ?? null,
    })

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
