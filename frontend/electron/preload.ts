import { contextBridge } from 'electron'

// contextIsolation está activo (webPreferences en main.ts) — el renderer no
// tiene acceso directo a Node ni a Electron. Lo único que expone este
// preload es la puerta de entrada al servidor HTTP local; todo lo demás
// (SQLite, puerto serial) el renderer lo pide por fetch a ese servidor,
// nunca por IPC directo a esas capas.
contextBridge.exposeInMainWorld('sms', {
  localServerUrl: 'http://127.0.0.1:4127',
})
