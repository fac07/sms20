import cors from 'cors'
import express from 'express'
import type { Server } from 'node:http'
import {
  anularBoletaLocal,
  cerrarBoletaLocal,
  crearBoletaLocal,
  getConfig,
  listarBoletasLocal,
  obtenerBoletaLocal,
  setConfig,
} from './db'
import type { OrigenPesoLocal } from './db'
import { crearPesoProvider, PesoProviderSimulado } from './peso-provider'
import type { OrigenPeso } from './peso-provider'

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

  app.post('/aprovisionamiento', async (req, res) => {
    const { codigo } = req.body as { codigo?: string }
    if (!codigo) {
      res.status(400).json({ error: 'Falta el código de aprovisionamiento.' })
      return
    }

    // TODO: reemplazar por la llamada real al backend central
    // (POST /api/basculas/aprovisionar con el código) una vez exista el
    // cliente HTTP hacia sms-central-api. Por ahora deja la app lista para
    // enchufar esa respuesta sin tocar el resto del flujo.
    res.status(501).json({
      error: 'Aprovisionamiento contra el backend central todavía no implementado.',
    })
  })

  server = app.listen(port, '127.0.0.1')
  return server
}

export function stopLocalServer(): void {
  server?.close()
  server = null
}
