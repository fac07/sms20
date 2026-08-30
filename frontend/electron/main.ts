import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startLocalServer } from './local-server.js'
import { getDb } from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// La UI (renderer) no toca SQLite ni el puerto serial directamente — todo pasa
// por este servidor HTTP local. Es el mismo contrato que usará el backend
// central cuando haya conexión, así que el renderer no necesita lógica
// distinta para offline vs online.
const LOCAL_SERVER_PORT = 4127

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  // Abre la base local (crea el archivo si es el primer arranque de esta báscula)
  // y arranca el servidor HTTP local antes de mostrar la ventana.
  getDb()
  startLocalServer(LOCAL_SERVER_PORT)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
