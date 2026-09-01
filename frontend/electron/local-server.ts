import cors from 'cors'
import express from 'express'
import type { Server } from 'node:http'
import {
  agregarBoletaCaracteristicaLocal,
  anularBoletaLocal,
  cerrarBoletaLocal,
  crearBoletaLocal,
  eliminarBoletaCaracteristicaLocal,
  getConfig,
  guardarBoletaCalidadLocal,
  guardarBoletaComposteraLocal,
  guardarBoletaDetalleFrutaLocal,
  listarBoletaCaracteristicaLocal,
  listarBoletasLocal,
  listarMaestrosLocal,
  listarOutboxLocal,
  obtenerBoletaCalidadLocal,
  obtenerBoletaComposteraLocal,
  obtenerBoletaDetalleFrutaLocal,
  obtenerBoletaLocal,
  setConfig,
} from './db'
import type { EstadoOutboxLocal, OrigenPesoLocal } from './db'
import { crearPesoProvider, PesoProviderSimulado } from './peso-provider'
import type { OrigenPeso } from './peso-provider'
import { despacharOutboxPendiente } from './outbox-dispatcher'
import { sincronizarMaestros } from './maestros-sync'

// Mismo origen hardcodeado que ya usan outbox-dispatcher.ts y los servicios
// Angular — cada archivo tiene su propia copia a propósito (no hay un módulo
// de config compartido en este repo todavía, no vale la pena inventarlo acá).
const CENTRAL_API_URL = 'http://localhost:5094'

let server: Server | null = null

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
      equipoId?: string
      transportistaId?: string
      pilotoId?: string
      terceroId?: string
      productoId?: string
      almacenOrigenId?: string | null
      almacenDestinoId?: string | null
      pesoIngreso?: number
      origenPesoIngreso?: OrigenPesoLocal
      usuarioIngreso?: string
      creadaOffline?: boolean
      habilitaCalidad?: boolean
      habilitaDetalleFruta?: boolean
      habilitaCompostera?: boolean
    }

    if (typeof body.pesoIngreso !== 'number' || !Number.isFinite(body.pesoIngreso)) {
      res.status(400).json({ error: 'El peso debe ser un número finito.' })
      return
    }

    const boleta = crearBoletaLocal({
      prefijo: body.numeroBoletaPrefijo ?? '',
      codigoBascula: body.codigoBascula ?? '',
      tipoMovimientoId: body.tipoMovimientoId ?? '',
      equipoId: body.equipoId ?? '',
      transportistaId: body.transportistaId ?? '',
      pilotoId: body.pilotoId ?? '',
      terceroId: body.terceroId ?? '',
      productoId: body.productoId ?? '',
      almacenOrigenId: body.almacenOrigenId ?? null,
      almacenDestinoId: body.almacenDestinoId ?? null,
      pesoIngreso: body.pesoIngreso,
      origenPesoIngreso: body.origenPesoIngreso ?? 'Bascula',
      // crearBoletaLocal siempre pisa este valor con la hora real de
      // creación — queda acá solo porque BoletaLocal no lo excluye del
      // input (a diferencia de FechaHoraSalida, que sí se excluye).
      fechaHoraIngreso: new Date().toISOString(),
      usuarioIngreso: body.usuarioIngreso ?? '',
      creadaOffline: body.creadaOffline ?? false,
      // Denormalizado desde el TipoMovimiento que la pantalla de Pesaje ya
      // tiene en memoria al momento de crear la boleta (ver el comentario
      // junto al ALTER TABLE en db.ts) — default false para no romper
      // callers viejos que todavía no mandan estos tres campos.
      habilitaCalidad: body.habilitaCalidad ?? false,
      habilitaDetalleFruta: body.habilitaDetalleFruta ?? false,
      habilitaCompostera: body.habilitaCompostera ?? false,
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

    if (typeof pesoSalida !== 'number' || !Number.isFinite(pesoSalida)) {
      res.status(400).json({ error: 'El peso debe ser un número finito.' })
      return
    }

    try {
      const boleta = cerrarBoletaLocal(req.params.id, {
        pesoSalida,
        origenPesoSalida: origenPesoSalida ?? 'Bascula',
        usuarioSalida: usuarioSalida ?? '',
        basculaSalidaId,
      })
      if (!boleta) {
        res.status(404).json({ error: 'No existe esa boleta.' })
        return
      }
      res.json(boleta)
    } catch (err) {
      res.status(409).json({ error: (err as Error).message })
    }
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

  // Extensiones de Boleta (Calidad, DetalleFruta, Compostera, Caracteristica)
  // — mismo shape de rutas que backend/Domain/Boletas/Extensiones
  // (BoletaExtensionesEndpoints.cs), sin el prefijo /api por el mismo motivo
  // que el resto de este archivo. El "motor" de gate central resuelve
  // TipoMovimiento con un lookup en vivo; acá no hay tabla TipoMovimiento
  // local (solo Boleta y Correlativo), así que el gate lee los 3 flags
  // Habilita* que crearBoletaLocal ya denormalizó sobre la fila de Boleta —
  // ver el comentario junto al ALTER TABLE en db.ts.
  const boletaHabilita = (
    boletaId: string,
    campo: 'habilitaCalidad' | 'habilitaDetalleFruta' | 'habilitaCompostera',
  ): boolean | null => {
    const boleta = obtenerBoletaLocal(boletaId)
    return boleta ? boleta[campo] : null
  }

  const esNumeroONulo = (v: unknown): v is number | null | undefined =>
    v === null || v === undefined || (typeof v === 'number' && Number.isFinite(v))

  app.get('/boletas/:id/calidad', (req, res) => {
    if (!obtenerBoletaLocal(req.params.id)) {
      res.status(404).json({ error: 'No existe esa boleta.' })
      return
    }

    const calidad = obtenerBoletaCalidadLocal(req.params.id)
    if (!calidad) {
      res.status(404).json({ error: 'Esta boleta no tiene datos de calidad.' })
      return
    }
    res.json(calidad)
  })

  app.put('/boletas/:id/calidad', (req, res) => {
    const habilitada = boletaHabilita(req.params.id, 'habilitaCalidad')
    if (habilitada === null) {
      res.status(404).json({ error: 'No existe esa boleta.' })
      return
    }
    if (!habilitada) {
      res.status(400).json({ error: 'Este TipoMovimiento no tiene habilitada la sección Calidad.' })
      return
    }

    const { acidez, luz, dobi, humedad, temperatura, numeroRevisionQA } = req.body as {
      acidez?: number | null
      luz?: number | null
      dobi?: number | null
      humedad?: number | null
      temperatura?: number | null
      numeroRevisionQA?: string | null
    }

    if (
      !esNumeroONulo(acidez) ||
      !esNumeroONulo(luz) ||
      !esNumeroONulo(dobi) ||
      !esNumeroONulo(humedad) ||
      !esNumeroONulo(temperatura)
    ) {
      res
        .status(400)
        .json({ error: 'Acidez, Luz, DOBI, Humedad y Temperatura deben ser números o nulos.' })
      return
    }

    const calidad = guardarBoletaCalidadLocal(req.params.id, {
      acidez: acidez ?? null,
      luz: luz ?? null,
      dobi: dobi ?? null,
      humedad: humedad ?? null,
      temperatura: temperatura ?? null,
      numeroRevisionQA: numeroRevisionQA ?? null,
    })
    res.json(calidad)
  })

  app.get('/boletas/:id/compostera', (req, res) => {
    if (!obtenerBoletaLocal(req.params.id)) {
      res.status(404).json({ error: 'No existe esa boleta.' })
      return
    }

    const compostera = obtenerBoletaComposteraLocal(req.params.id)
    if (!compostera) {
      res.status(404).json({ error: 'Esta boleta no tiene datos de compostera.' })
      return
    }
    res.json(compostera)
  })

  app.put('/boletas/:id/compostera', (req, res) => {
    const habilitada = boletaHabilita(req.params.id, 'habilitaCompostera')
    if (habilitada === null) {
      res.status(404).json({ error: 'No existe esa boleta.' })
      return
    }
    if (!habilitada) {
      res.status(400).json({ error: 'Este TipoMovimiento no tiene habilitada la sección Compostera.' })
      return
    }

    const { cui, camaId, seccionId, cicloId } = req.body as {
      cui?: string
      camaId?: string
      seccionId?: string
      cicloId?: string
    }

    if (!cui || !camaId || !seccionId || !cicloId) {
      res.status(400).json({ error: 'Faltan cui, camaId, seccionId y/o cicloId.' })
      return
    }

    const compostera = guardarBoletaComposteraLocal(req.params.id, { cui, camaId, seccionId, cicloId })
    res.json(compostera)
  })

  app.get('/boletas/:id/detalle-fruta', (req, res) => {
    if (!obtenerBoletaLocal(req.params.id)) {
      res.status(404).json({ error: 'No existe esa boleta.' })
      return
    }

    const detalle = obtenerBoletaDetalleFrutaLocal(req.params.id)
    if (!detalle) {
      res.status(404).json({ error: 'Esta boleta no tiene datos de detalle de fruta.' })
      return
    }
    res.json(detalle)
  })

  app.put('/boletas/:id/detalle-fruta', (req, res) => {
    const habilitada = boletaHabilita(req.params.id, 'habilitaDetalleFruta')
    if (habilitada === null) {
      res.status(404).json({ error: 'No existe esa boleta.' })
      return
    }
    if (!habilitada) {
      res.status(400).json({ error: 'Este TipoMovimiento no tiene habilitada la sección DetalleFruta.' })
      return
    }

    const body = req.body as {
      racimosVerdes?: number
      racimosMaduros?: number
      racimosSobreMaduros?: number
      racimosPasados?: number
      pedunculoLargo?: number
    }

    const campos = [
      body.racimosVerdes,
      body.racimosMaduros,
      body.racimosSobreMaduros,
      body.racimosPasados,
      body.pedunculoLargo,
    ]
    if (campos.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
      res.status(400).json({
        error:
          'racimosVerdes, racimosMaduros, racimosSobreMaduros, racimosPasados y pedunculoLargo deben ser números.',
      })
      return
    }

    const detalle = guardarBoletaDetalleFrutaLocal(req.params.id, {
      racimosVerdes: body.racimosVerdes!,
      racimosMaduros: body.racimosMaduros!,
      racimosSobreMaduros: body.racimosSobreMaduros!,
      racimosPasados: body.racimosPasados!,
      pedunculoLargo: body.pedunculoLargo!,
    })
    res.json(detalle)
  })

  // Ungated — Caracteristica es el escape hatch genérico, igual que en el
  // backend central: no depende de ningún Habilita*.
  app.get('/boletas/:id/caracteristicas', (req, res) => {
    if (!obtenerBoletaLocal(req.params.id)) {
      res.status(404).json({ error: 'No existe esa boleta.' })
      return
    }
    res.json(listarBoletaCaracteristicaLocal(req.params.id))
  })

  app.post('/boletas/:id/caracteristicas', (req, res) => {
    if (!obtenerBoletaLocal(req.params.id)) {
      res.status(404).json({ error: 'No existe esa boleta.' })
      return
    }

    const { caracteristicaId, cantidad } = req.body as { caracteristicaId?: string; cantidad?: number }
    if (!caracteristicaId || typeof caracteristicaId !== 'string') {
      res.status(400).json({ error: 'Falta caracteristicaId.' })
      return
    }
    if (typeof cantidad !== 'number' || !Number.isFinite(cantidad)) {
      res.status(400).json({ error: 'Falta cantidad, o no es un número válido.' })
      return
    }

    const caracteristica = agregarBoletaCaracteristicaLocal(req.params.id, { caracteristicaId, cantidad })
    res.status(201).json(caracteristica)
  })

  app.delete('/boletas/:id/caracteristicas/:caracteristicaId', (req, res) => {
    const borrado = eliminarBoletaCaracteristicaLocal(req.params.id, req.params.caracteristicaId)
    if (!borrado) {
      res.status(404).json({ error: 'No existe esa característica.' })
      return
    }
    res.status(204).end()
  })

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
