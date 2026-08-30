import express from 'express'
import type { Server } from 'node:http'
import { getConfig } from './db.js'

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
export function startLocalServer(port: number): Server {
  const app = express()
  app.use(express.json())

  app.get('/estado', (_req, res) => {
    const basculaId = getConfig('BasculaId')
    res.json({ aprovisionada: Boolean(basculaId), basculaId: basculaId ?? null })
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
