import { app, BrowserWindow } from 'electron'
import * as path from 'node:path'
import { startLocalServer } from './local-server'
import { getDb } from './db'
import { despacharOutboxPendiente } from './outbox-dispatcher'
import { sincronizarMaestros } from './maestros-sync'
import { sincronizarConfigLocal } from './config-sync'

// La UI (renderer) no toca SQLite ni el puerto serial directamente — todo pasa
// por este servidor HTTP local. Es el mismo contrato que usará el backend
// central cuando haya conexión, así que el renderer no necesita lógica
// distinta para offline vs online.
const LOCAL_SERVER_PORT = 4127

// Loop de sincronización en segundo plano — reenvía el OutboxLocal pendiente
// al backend central cada 15s. Corre siempre, en dev y en producción por
// igual (a diferencia del simulador de peso, que solo existe en dev): es la
// pieza real de sync, no una herramienta de desarrollo.
const DISPATCH_INTERVAL_MS = 15_000

// Sync de Maestros es más espaciado que el dispatcher del Outbox (60s vs
// 15s) porque es de solo lectura y menos urgente — nada se pierde por
// tardar un minuto en enterarse de un maestro nuevo, a diferencia de una
// boleta pendiente de sincronizar.
const MAESTROS_SYNC_INTERVAL_MS = 60_000

// Sync de configuración (secciones/campos/asignaciones) — misma cadencia y mismo
// criterio que Maestros: es de solo lectura, por marca de agua, y menos urgente
// que el Outbox. Un fallo acá NUNCA bloquea la creación de boletas: la báscula
// sigue trabajando contra el último caché de config bueno.
const CONFIG_SYNC_INTERVAL_MS = 60_000

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const devServerUrl = process.env.ELECTRON_START_URL
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/frontend-ng/browser/index.html'))
  }
}

app.whenReady().then(() => {
  // Abre la base local (crea el archivo si es el primer arranque de esta báscula)
  // y arranca el servidor HTTP local antes de mostrar la ventana.
  getDb()
  startLocalServer(LOCAL_SERVER_PORT, !app.isPackaged)

  // Disparo eager al arrancar: siembra el espejo de configuración (incluido
  // TipoMovimiento) sin esperar el primer tick de 60s — así una instalación
  // recién abierta online tiene el dropdown de Pesaje poblado en segundos.
  // Comparte la guardia `enVuelo` con el interval; un fallo nunca bloquea la
  // creación de boletas.
  sincronizarConfigLocal().catch((err) =>
    console.error('Error en el sync de configuración inicial:', err),
  )

  setInterval(() => {
    despacharOutboxPendiente().catch((err) => console.error('Error despachando outbox:', err))
  }, DISPATCH_INTERVAL_MS)

  setInterval(() => {
    sincronizarMaestros().catch((err) => console.error('Error sincronizando maestros:', err))
  }, MAESTROS_SYNC_INTERVAL_MS)

  setInterval(() => {
    sincronizarConfigLocal().catch((err) => console.error('Error sincronizando configuración:', err))
  }, CONFIG_SYNC_INTERVAL_MS)

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
