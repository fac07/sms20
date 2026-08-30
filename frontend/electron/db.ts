import Database from 'better-sqlite3'
import path from 'node:path'
import { app } from 'electron'

let db: Database.Database | null = null

// Un archivo SQLite embebido por instalación de báscula — sin servidor, sin
// nada que configurar aparte de correr el instalador de Electron.
export function getDb(): Database.Database {
  if (db) return db

  const dbPath = path.join(app.getPath('userData'), 'bascula.sqlite')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')

  // Tabla mínima de arranque: identidad y aprovisionamiento de esta báscula.
  // El resto del esquema (Boleta, Maestro, Outbox, ...) se agrega cuando
  // arranque la implementación real — esto solo prueba el patrón de acceso.
  db.exec(`
    CREATE TABLE IF NOT EXISTS ConfiguracionLocal (
      Clave TEXT PRIMARY KEY,
      Valor TEXT
    );
  `)

  return db
}

export function getConfig(clave: string): string | undefined {
  const row = getDb()
    .prepare('SELECT Valor FROM ConfiguracionLocal WHERE Clave = ?')
    .get(clave) as { Valor: string } | undefined
  return row?.Valor
}

export function setConfig(clave: string, valor: string): void {
  getDb()
    .prepare(
      'INSERT INTO ConfiguracionLocal (Clave, Valor) VALUES (?, ?) ' +
        'ON CONFLICT(Clave) DO UPDATE SET Valor = excluded.Valor',
    )
    .run(clave, valor)
}
