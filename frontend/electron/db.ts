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
  // El resto del esquema (Maestro, Outbox, ...) se agrega cuando arranque la
  // implementación real — esto solo prueba el patrón de acceso.
  db.exec(`
    CREATE TABLE IF NOT EXISTS ConfiguracionLocal (
      Clave TEXT PRIMARY KEY,
      Valor TEXT
    );

    CREATE TABLE IF NOT EXISTS Correlativo (
      Prefijo TEXT PRIMARY KEY,
      Secuencial INTEGER NOT NULL DEFAULT 0
    );

    -- Sin BasculaId a propósito: este archivo SQLite es de UNA sola báscula
    -- (una instalación = una báscula física), así que la báscula de una fila
    -- local siempre es "esta báscula" — es implícito, no hace falta guardarlo.
    -- El espejo central (backend/Domain/Boletas) sí tiene BasculaId porque
    -- agrega boletas de todas las básculas; cuando exista el Outbox de sync,
    -- ese proceso completa BasculaId leyendo la config local en el momento
    -- de subir la boleta. Nada de eso se resuelve acá todavía.
    --
    -- EstadoSync acá SIEMPRE arranca en 'Local' — a diferencia del endpoint
    -- central de prueba (POST /api/boletas), que la marca directo como
    -- SincronizadoCentral porque hoy no tiene otro origen posible. Acá sí
    -- hay un paso real de sincronización pendiente (Outbox, todavía no
    -- implementado), así que 'Local' es el estado inicial honesto.
    CREATE TABLE IF NOT EXISTS Boleta (
      Id TEXT PRIMARY KEY,
      NumeroBoleta TEXT NOT NULL UNIQUE,
      TipoMovimientoId TEXT NOT NULL,
      Estado TEXT NOT NULL,
      EstadoSync TEXT NOT NULL,
      EquipoId TEXT NOT NULL,
      TransportistaId TEXT NOT NULL,
      PilotoId TEXT NOT NULL,
      TerceroId TEXT NOT NULL,
      ProductoId TEXT NOT NULL,
      AlmacenOrigenId TEXT,
      AlmacenDestinoId TEXT,
      PesoIngreso REAL NOT NULL,
      PesoSalida REAL,
      PesoNeto REAL,
      OrigenPesoIngreso TEXT NOT NULL,
      OrigenPesoSalida TEXT,
      FechaHoraIngreso TEXT NOT NULL,
      FechaHoraSalida TEXT,
      UsuarioIngreso TEXT NOT NULL,
      UsuarioSalida TEXT,
      UsuarioAnula TEXT,
      UsuarioAutoriza TEXT,
      MotivoAnulacion TEXT,
      BoletaReemplazoId TEXT,
      BoletaOrigenId TEXT,
      BasculaSalidaId TEXT,
      RespuestaD365Id TEXT,
      CreadaOffline INTEGER NOT NULL
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

/**
 * Devuelve el siguiente número de secuencia para un prefijo de correlativo
 * (REC, ENV, TRF, OC, OV — uno por TipoMovimiento, ver TipoMovimiento.Prefijo).
 *
 * Cierra la ventana de carrera que tenía el legacy (SELECT MAX + INSERT en
 * dos pasos separados, con la lectura y la escritura sin nada que las
 * atara entre sí) — acá todo el incremento vive en una sola transacción
 * SQLite, así que dos ingresos concurrentes contra el mismo prefijo nunca
 * pueden leer el mismo Secuencial.
 */
export function siguienteCorrelativo(prefijo: string): number {
  const incrementar = getDb().transaction((p: string): number => {
    getDb()
      .prepare(
        'INSERT INTO Correlativo (Prefijo, Secuencial) VALUES (?, 0) ' +
          'ON CONFLICT(Prefijo) DO NOTHING',
      )
      .run(p)

    getDb()
      .prepare('UPDATE Correlativo SET Secuencial = Secuencial + 1 WHERE Prefijo = ?')
      .run(p)

    const row = getDb()
      .prepare('SELECT Secuencial FROM Correlativo WHERE Prefijo = ?')
      .get(p) as { Secuencial: number }
    return row.Secuencial
  })

  return incrementar(prefijo)
}

export type EstadoBoletaLocal = 'EnTransito' | 'Cerrada' | 'Anulada' | 'Reemitida'

export type EstadoSyncBoletaLocal =
  | 'Local'
  | 'SincronizadoCentral'
  | 'ErrorCentral'
  | 'SincronizadoD365'
  | 'ErrorD365'

export type OrigenPesoLocal = 'Bascula' | 'Manual'

// Mismos campos que la tabla Boleta de arriba, en camelCase y sin BasculaId
// (ver el comentario junto al CREATE TABLE: acá es implícito).
export interface BoletaLocal {
  id: string
  numeroBoleta: string
  tipoMovimientoId: string
  estado: EstadoBoletaLocal
  estadoSync: EstadoSyncBoletaLocal
  equipoId: string
  transportistaId: string
  pilotoId: string
  terceroId: string
  productoId: string
  almacenOrigenId: string | null
  almacenDestinoId: string | null
  pesoIngreso: number
  pesoSalida: number | null
  pesoNeto: number | null
  origenPesoIngreso: OrigenPesoLocal
  origenPesoSalida: OrigenPesoLocal | null
  fechaHoraIngreso: string
  fechaHoraSalida: string | null
  usuarioIngreso: string
  usuarioSalida: string | null
  usuarioAnula: string | null
  usuarioAutoriza: string | null
  motivoAnulacion: string | null
  boletaReemplazoId: string | null
  boletaOrigenId: string | null
  basculaSalidaId: string | null
  respuestaD365Id: string | null
  creadaOffline: boolean
}

// Forma cruda de la fila tal como sale de better-sqlite3 (columnas
// PascalCase, CreadaOffline como 0/1) — nunca se expone fuera de este archivo.
interface BoletaRow {
  Id: string
  NumeroBoleta: string
  TipoMovimientoId: string
  Estado: EstadoBoletaLocal
  EstadoSync: EstadoSyncBoletaLocal
  EquipoId: string
  TransportistaId: string
  PilotoId: string
  TerceroId: string
  ProductoId: string
  AlmacenOrigenId: string | null
  AlmacenDestinoId: string | null
  PesoIngreso: number
  PesoSalida: number | null
  PesoNeto: number | null
  OrigenPesoIngreso: OrigenPesoLocal
  OrigenPesoSalida: OrigenPesoLocal | null
  FechaHoraIngreso: string
  FechaHoraSalida: string | null
  UsuarioIngreso: string
  UsuarioSalida: string | null
  UsuarioAnula: string | null
  UsuarioAutoriza: string | null
  MotivoAnulacion: string | null
  BoletaReemplazoId: string | null
  BoletaOrigenId: string | null
  BasculaSalidaId: string | null
  RespuestaD365Id: string | null
  CreadaOffline: number
}

function filaABoletaLocal(row: BoletaRow): BoletaLocal {
  return {
    id: row.Id,
    numeroBoleta: row.NumeroBoleta,
    tipoMovimientoId: row.TipoMovimientoId,
    estado: row.Estado,
    estadoSync: row.EstadoSync,
    equipoId: row.EquipoId,
    transportistaId: row.TransportistaId,
    pilotoId: row.PilotoId,
    terceroId: row.TerceroId,
    productoId: row.ProductoId,
    almacenOrigenId: row.AlmacenOrigenId,
    almacenDestinoId: row.AlmacenDestinoId,
    pesoIngreso: row.PesoIngreso,
    pesoSalida: row.PesoSalida,
    pesoNeto: row.PesoNeto,
    origenPesoIngreso: row.OrigenPesoIngreso,
    origenPesoSalida: row.OrigenPesoSalida,
    fechaHoraIngreso: row.FechaHoraIngreso,
    fechaHoraSalida: row.FechaHoraSalida,
    usuarioIngreso: row.UsuarioIngreso,
    usuarioSalida: row.UsuarioSalida,
    usuarioAnula: row.UsuarioAnula,
    usuarioAutoriza: row.UsuarioAutoriza,
    motivoAnulacion: row.MotivoAnulacion,
    boletaReemplazoId: row.BoletaReemplazoId,
    boletaOrigenId: row.BoletaOrigenId,
    basculaSalidaId: row.BasculaSalidaId,
    respuestaD365Id: row.RespuestaD365Id,
    creadaOffline: Boolean(row.CreadaOffline),
  }
}

export function obtenerBoletaLocal(id: string): BoletaLocal | null {
  const row = getDb().prepare('SELECT * FROM Boleta WHERE Id = ?').get(id) as BoletaRow | undefined
  return row ? filaABoletaLocal(row) : null
}

export function listarBoletasLocal(estado?: string): BoletaLocal[] {
  const rows = estado
    ? (getDb()
        .prepare('SELECT * FROM Boleta WHERE Estado = ? ORDER BY FechaHoraIngreso DESC')
        .all(estado) as BoletaRow[])
    : (getDb().prepare('SELECT * FROM Boleta ORDER BY FechaHoraIngreso DESC').all() as BoletaRow[])
  return rows.map(filaABoletaLocal)
}

/**
 * Ingreso — abre la boleta con el primer pesaje. Arma NumeroBoleta como
 * `{prefijo}-{codigoBascula}-{secuencial}` (ver Correlativo en el diseño),
 * usando el Prefijo del TipoMovimiento (no su Codigo de catálogo) y el
 * CodigoBascula de esta instalación.
 */
export function crearBoletaLocal(
  input: Omit<
    BoletaLocal,
    | 'id'
    | 'numeroBoleta'
    | 'estado'
    | 'estadoSync'
    | 'pesoSalida'
    | 'pesoNeto'
    | 'origenPesoSalida'
    | 'fechaHoraSalida'
    | 'usuarioSalida'
    | 'usuarioAnula'
    | 'usuarioAutoriza'
    | 'motivoAnulacion'
    | 'boletaReemplazoId'
    | 'boletaOrigenId'
    | 'basculaSalidaId'
    | 'respuestaD365Id'
  > & { prefijo: string; codigoBascula: string },
): BoletaLocal {
  const id = crypto.randomUUID()
  const secuencial = siguienteCorrelativo(input.prefijo)
  const numeroBoleta = `${input.prefijo}-${input.codigoBascula}-${String(secuencial).padStart(6, '0')}`
  const fechaHoraIngreso = new Date().toISOString()

  getDb()
    .prepare(
      `INSERT INTO Boleta (
        Id, NumeroBoleta, TipoMovimientoId, Estado, EstadoSync,
        EquipoId, TransportistaId, PilotoId, TerceroId, ProductoId,
        AlmacenOrigenId, AlmacenDestinoId,
        PesoIngreso, OrigenPesoIngreso,
        FechaHoraIngreso, UsuarioIngreso, CreadaOffline
      ) VALUES (
        @id, @numeroBoleta, @tipoMovimientoId, @estado, @estadoSync,
        @equipoId, @transportistaId, @pilotoId, @terceroId, @productoId,
        @almacenOrigenId, @almacenDestinoId,
        @pesoIngreso, @origenPesoIngreso,
        @fechaHoraIngreso, @usuarioIngreso, @creadaOffline
      )`,
    )
    .run({
      id,
      numeroBoleta,
      tipoMovimientoId: input.tipoMovimientoId,
      estado: 'EnTransito',
      estadoSync: 'Local',
      equipoId: input.equipoId,
      transportistaId: input.transportistaId,
      pilotoId: input.pilotoId,
      terceroId: input.terceroId,
      productoId: input.productoId,
      almacenOrigenId: input.almacenOrigenId,
      almacenDestinoId: input.almacenDestinoId,
      pesoIngreso: input.pesoIngreso,
      origenPesoIngreso: input.origenPesoIngreso,
      fechaHoraIngreso,
      usuarioIngreso: input.usuarioIngreso,
      creadaOffline: input.creadaOffline ? 1 : 0,
    })

  return obtenerBoletaLocal(id)!
}

/** Salida — segundo pesaje, cierra la boleta y calcula el neto. */
export function cerrarBoletaLocal(
  id: string,
  input: {
    pesoSalida: number
    origenPesoSalida: OrigenPesoLocal
    usuarioSalida: string
    basculaSalidaId?: string | null
  },
): BoletaLocal | null {
  const boleta = obtenerBoletaLocal(id)
  if (!boleta) return null
  if (boleta.estado !== 'EnTransito') {
    throw new Error('Solo se puede cerrar una boleta en estado EnTransito.')
  }

  const pesoNeto = Math.abs(boleta.pesoIngreso - input.pesoSalida)
  const fechaHoraSalida = new Date().toISOString()

  getDb()
    .prepare(
      `UPDATE Boleta SET
        PesoSalida = @pesoSalida,
        PesoNeto = @pesoNeto,
        OrigenPesoSalida = @origenPesoSalida,
        FechaHoraSalida = @fechaHoraSalida,
        UsuarioSalida = @usuarioSalida,
        BasculaSalidaId = @basculaSalidaId,
        Estado = 'Cerrada'
      WHERE Id = @id`,
    )
    .run({
      id,
      pesoSalida: input.pesoSalida,
      pesoNeto,
      origenPesoSalida: input.origenPesoSalida,
      fechaHoraSalida,
      usuarioSalida: input.usuarioSalida,
      basculaSalidaId: input.basculaSalidaId ?? null,
    })

  return obtenerBoletaLocal(id)
}

/**
 * Anulación — doble control (UsuarioAnula + UsuarioAutoriza), igual que el
 * legacy y que el endpoint central. Solo cambia Estado: los pesos de una
 * boleta ya cerrada quedan como registro histórico, no se borran.
 */
export function anularBoletaLocal(
  id: string,
  input: { usuarioAnula: string; usuarioAutoriza: string; motivoAnulacion: string },
): BoletaLocal | null {
  const boleta = obtenerBoletaLocal(id)
  if (!boleta) return null
  if (boleta.estado === 'Anulada') {
    throw new Error('Esta boleta ya está anulada.')
  }

  getDb()
    .prepare(
      `UPDATE Boleta SET
        Estado = 'Anulada',
        UsuarioAnula = @usuarioAnula,
        UsuarioAutoriza = @usuarioAutoriza,
        MotivoAnulacion = @motivoAnulacion
      WHERE Id = @id`,
    )
    .run({ id, ...input })

  return obtenerBoletaLocal(id)
}
