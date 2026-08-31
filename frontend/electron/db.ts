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
      CreadaOffline INTEGER NOT NULL,
      HabilitaCalidad INTEGER NOT NULL DEFAULT 0,
      HabilitaDetalleFruta INTEGER NOT NULL DEFAULT 0,
      HabilitaCompostera INTEGER NOT NULL DEFAULT 0
    );

    -- Extensiones de Boleta (mismo shape que backend/Domain/Boletas/Extensiones):
    -- BoletaCalidad y BoletaCompostera son 1:1 (UNIQUE en BoletaId, igual que
    -- el HasIndex(...).IsUnique() del central), BoletaDetalleFruta y
    -- BoletaCaracteristica son 1:N. Sin FK declarada hacia Boleta a propósito
    -- — igual que el resto de este archivo, SQLite acá no fuerza integridad
    -- referencial entre tablas propias; la relación la sostiene el código.
    CREATE TABLE IF NOT EXISTS BoletaCalidad (
      Id TEXT PRIMARY KEY,
      BoletaId TEXT NOT NULL UNIQUE,
      Acidez REAL,
      DOBI REAL,
      Humedad REAL,
      Temperatura REAL,
      NumeroRevisionQA TEXT
    );

    CREATE TABLE IF NOT EXISTS BoletaDetalleFruta (
      Id TEXT PRIMARY KEY,
      BoletaId TEXT NOT NULL,
      RacimosVerdes INTEGER NOT NULL,
      RacimosMaduros INTEGER NOT NULL,
      RacimosSobreMaduros INTEGER NOT NULL,
      RacimosPasados INTEGER NOT NULL,
      PedunculoLargo INTEGER NOT NULL,
      Sacos REAL NOT NULL,
      Jornales REAL NOT NULL,
      Hectareas REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS BoletaCompostera (
      Id TEXT PRIMARY KEY,
      BoletaId TEXT NOT NULL UNIQUE,
      CUI TEXT NOT NULL,
      CamaId TEXT NOT NULL,
      SeccionId TEXT NOT NULL,
      CicloId TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS BoletaCaracteristica (
      Id TEXT PRIMARY KEY,
      BoletaId TEXT NOT NULL,
      Clave TEXT NOT NULL,
      Valor TEXT NOT NULL,
      TipoDato TEXT NOT NULL
    );

    -- Outbox local del patrón Outbox (ver diseño, sección #sincronizacion):
    -- cada mutación de Boleta (crear/cerrar/anular) escribe acá, en la MISMA
    -- transacción que la escritura de Boleta — así una boleta nunca puede
    -- existir sin su evento de sync pendiente. Esta tabla es OutboxLocal
    -- (de esta báscula), no OutboxD365 (esa es central-side, no se toca acá).
    -- Solo el escritor (crear/cerrar/anularBoletaLocal) y el lector
    -- (listarOutboxLocal) viven en este archivo — el dispatcher que de verdad
    -- envía estos eventos al backend central es una tarea aparte, todavía no
    -- implementada.
    CREATE TABLE IF NOT EXISTS OutboxLocal (
      Id TEXT PRIMARY KEY,
      Secuencia INTEGER NOT NULL,
      TipoEntidad TEXT NOT NULL,
      EntidadId TEXT NOT NULL,
      Operacion TEXT NOT NULL,
      Payload TEXT NOT NULL,
      Estado TEXT NOT NULL,
      Intentos INTEGER NOT NULL DEFAULT 0,
      UltimoError TEXT,
      FechaCreacion TEXT NOT NULL,
      FechaEnviado TEXT
    );

    CREATE INDEX IF NOT EXISTS IX_OutboxLocal_Estado ON OutboxLocal(Estado);

    -- Contador monotónico global de Secuencia para OutboxLocal — a
    -- diferencia de Correlativo (una fila por Prefijo), acá solo existe UNA
    -- secuencia para todo el outbox de esta báscula, así que es una tabla de
    -- una sola fila, con Id fijado a 1 vía CHECK.
    CREATE TABLE IF NOT EXISTS OutboxLocalSecuencia (
      Id INTEGER PRIMARY KEY CHECK (Id = 1),
      Valor INTEGER NOT NULL DEFAULT 0
    );
  `)

  // CREATE TABLE IF NOT EXISTS no toca una tabla Boleta que ya existía de una
  // instalación previa (no cambia su esquema) — así que las 3 columnas nuevas
  // de arriba necesitan su propio ALTER TABLE para llegar a instalaciones que
  // ya tenían el archivo .sqlite creado. Son la versión denormalizada de
  // TipoMovimiento.HabilitaCalidad/HabilitaDetalleFruta/HabilitaCompostera:
  // la Pesaje screen ya tiene el TipoMovimiento completo en memoria al crear
  // la boleta (lo necesita para el prefijo del correlativo), así que copia
  // esos 3 flags acá mismo — la boleta "recuerda" qué secciones tiene
  // habilitadas sin volver a consultar TipoMovimiento (que ni siquiera existe
  // como tabla local todavía), y el gate de las rutas de abajo funciona 100%
  // offline.
  try {
    db.exec('ALTER TABLE Boleta ADD COLUMN HabilitaCalidad INTEGER NOT NULL DEFAULT 0')
  } catch {
    /* la columna ya existe en instalaciones previas */
  }
  try {
    db.exec('ALTER TABLE Boleta ADD COLUMN HabilitaDetalleFruta INTEGER NOT NULL DEFAULT 0')
  } catch {
    /* la columna ya existe en instalaciones previas */
  }
  try {
    db.exec('ALTER TABLE Boleta ADD COLUMN HabilitaCompostera INTEGER NOT NULL DEFAULT 0')
  } catch {
    /* la columna ya existe en instalaciones previas */
  }

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

/**
 * Siguiente valor de Secuencia para OutboxLocal — mismo patrón que
 * siguienteCorrelativo de arriba (tabla contador + incremento dentro de una
 * transacción SQLite para cerrar la ventana de carrera), pero más simple:
 * acá no hay Prefijo, es un único contador global para todo el outbox de
 * esta báscula. No se exporta — solo la usan crearBoletaLocal,
 * cerrarBoletaLocal y anularBoletaLocal al escribir su evento de outbox.
 */
function siguienteSecuenciaOutbox(): number {
  const incrementar = getDb().transaction((): number => {
    getDb()
      .prepare('INSERT INTO OutboxLocalSecuencia (Id, Valor) VALUES (1, 0) ON CONFLICT(Id) DO NOTHING')
      .run()

    getDb().prepare('UPDATE OutboxLocalSecuencia SET Valor = Valor + 1 WHERE Id = 1').run()

    const row = getDb().prepare('SELECT Valor FROM OutboxLocalSecuencia WHERE Id = 1').get() as {
      Valor: number
    }
    return row.Valor
  })

  return incrementar()
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
  habilitaCalidad: boolean
  habilitaDetalleFruta: boolean
  habilitaCompostera: boolean
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
  HabilitaCalidad: number
  HabilitaDetalleFruta: number
  HabilitaCompostera: number
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
    habilitaCalidad: Boolean(row.HabilitaCalidad),
    habilitaDetalleFruta: Boolean(row.HabilitaDetalleFruta),
    habilitaCompostera: Boolean(row.HabilitaCompostera),
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

// ---------------------------------------------------------------------------
// OutboxLocal — ver el CREATE TABLE en getDb() para el porqué de cada
// columna. Acá solo va el read path (listarOutboxLocal, para un futuro
// dispatcher y para verificar esto ahora) y el helper privado de escritura
// que usan crearBoletaLocal/cerrarBoletaLocal/anularBoletaLocal dentro de su
// propia transacción — marcar Enviado/Error es trabajo del dispatcher,
// todavía no implementado, así que no hay función de mutación acá.
// ---------------------------------------------------------------------------

export type TipoEntidadOutboxLocal = 'Boleta' | 'MaestroProvisional'
export type OperacionOutboxLocal = 'Crear' | 'Cerrar' | 'Anular'
export type EstadoOutboxLocal = 'Pendiente' | 'Enviado' | 'Error'

export interface OutboxLocalEvento {
  id: string
  secuencia: number
  tipoEntidad: TipoEntidadOutboxLocal
  entidadId: string
  operacion: OperacionOutboxLocal
  payload: string // JSON crudo — el consumidor decide cuándo parsearlo
  estado: EstadoOutboxLocal
  intentos: number
  ultimoError: string | null
  fechaCreacion: string
  fechaEnviado: string | null
}

interface OutboxLocalRow {
  Id: string
  Secuencia: number
  TipoEntidad: TipoEntidadOutboxLocal
  EntidadId: string
  Operacion: OperacionOutboxLocal
  Payload: string
  Estado: EstadoOutboxLocal
  Intentos: number
  UltimoError: string | null
  FechaCreacion: string
  FechaEnviado: string | null
}

function filaAOutboxLocalEvento(row: OutboxLocalRow): OutboxLocalEvento {
  return {
    id: row.Id,
    secuencia: row.Secuencia,
    tipoEntidad: row.TipoEntidad,
    entidadId: row.EntidadId,
    operacion: row.Operacion,
    payload: row.Payload,
    estado: row.Estado,
    intentos: row.Intentos,
    ultimoError: row.UltimoError,
    fechaCreacion: row.FechaCreacion,
    fechaEnviado: row.FechaEnviado,
  }
}

/** Orden por Secuencia ASC — el más viejo primero, el orden natural de despacho de un futuro dispatcher. */
export function listarOutboxLocal(estado?: EstadoOutboxLocal): OutboxLocalEvento[] {
  const rows = estado
    ? (getDb()
        .prepare('SELECT * FROM OutboxLocal WHERE Estado = ? ORDER BY Secuencia ASC')
        .all(estado) as OutboxLocalRow[])
    : (getDb().prepare('SELECT * FROM OutboxLocal ORDER BY Secuencia ASC').all() as OutboxLocalRow[])
  return rows.map(filaAOutboxLocalEvento)
}

/**
 * Inserta el evento de OutboxLocal — SIEMPRE se llama desde dentro de la
 * misma transacción que la escritura de Boleta (ver
 * crearBoletaLocal/cerrarBoletaLocal/anularBoletaLocal), nunca suelta, para
 * sostener la garantía central del patrón Outbox: una boleta no puede existir
 * sin su evento de sync pendiente.
 */
function registrarEventoOutboxLocal(
  tipoEntidad: TipoEntidadOutboxLocal,
  entidadId: string,
  operacion: OperacionOutboxLocal,
  payload: string,
): void {
  getDb()
    .prepare(
      `INSERT INTO OutboxLocal (
        Id, Secuencia, TipoEntidad, EntidadId, Operacion, Payload,
        Estado, Intentos, FechaCreacion
      ) VALUES (
        @id, @secuencia, @tipoEntidad, @entidadId, @operacion, @payload,
        'Pendiente', 0, @fechaCreacion
      )`,
    )
    .run({
      id: crypto.randomUUID(),
      secuencia: siguienteSecuenciaOutbox(),
      tipoEntidad,
      entidadId,
      operacion,
      payload,
      fechaCreacion: new Date().toISOString(),
    })
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
  const fechaHoraIngreso = new Date().toISOString()

  // Todo dentro de una sola transacción SQLite (mismo patrón que
  // siguienteCorrelativo más arriba): el INSERT de Boleta y el evento de
  // OutboxLocal comitean o se revierten juntos — así una boleta nunca puede
  // quedar creada sin su evento 'Crear' pendiente (la garantía central del
  // patrón Outbox, ver diseño #sincronizacion). siguienteCorrelativo va
  // adentro también, no antes: si el INSERT de Boleta fallara después de
  // haber consumido un Secuencial, ese hueco quedaría revertido junto con
  // todo lo demás en vez de perderse silenciosamente.
  const ejecutar = getDb().transaction((): void => {
    const secuencial = siguienteCorrelativo(input.prefijo)
    const numeroBoleta = `${input.prefijo}-${input.codigoBascula}-${String(secuencial).padStart(6, '0')}`

    getDb()
      .prepare(
        `INSERT INTO Boleta (
          Id, NumeroBoleta, TipoMovimientoId, Estado, EstadoSync,
          EquipoId, TransportistaId, PilotoId, TerceroId, ProductoId,
          AlmacenOrigenId, AlmacenDestinoId,
          PesoIngreso, OrigenPesoIngreso,
          FechaHoraIngreso, UsuarioIngreso, CreadaOffline,
          HabilitaCalidad, HabilitaDetalleFruta, HabilitaCompostera
        ) VALUES (
          @id, @numeroBoleta, @tipoMovimientoId, @estado, @estadoSync,
          @equipoId, @transportistaId, @pilotoId, @terceroId, @productoId,
          @almacenOrigenId, @almacenDestinoId,
          @pesoIngreso, @origenPesoIngreso,
          @fechaHoraIngreso, @usuarioIngreso, @creadaOffline,
          @habilitaCalidad, @habilitaDetalleFruta, @habilitaCompostera
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
        habilitaCalidad: input.habilitaCalidad ? 1 : 0,
        habilitaDetalleFruta: input.habilitaDetalleFruta ? 1 : 0,
        habilitaCompostera: input.habilitaCompostera ? 1 : 0,
      })

    // El payload es la Boleta completa tal como queda en ese instante — si en
    // el futuro esto necesita incluir las extensiones (Calidad/DetalleFruta/
    // Compostera/Características), ese es un cambio de diseño pendiente, no
    // resuelto acá; hoy el payload solo cubre lo que Boleta sabe de sí misma.
    const payload = JSON.stringify(obtenerBoletaLocal(id))
    registrarEventoOutboxLocal('Boleta', id, 'Crear', payload)
  })

  ejecutar()
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

  // Misma razón que en crearBoletaLocal: el UPDATE de Boleta y el evento
  // OutboxLocal 'Cerrar' van en una sola transacción.
  const ejecutar = getDb().transaction((): void => {
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

    // Ver el comentario en crearBoletaLocal sobre el alcance del payload.
    const payload = JSON.stringify(obtenerBoletaLocal(id))
    registrarEventoOutboxLocal('Boleta', id, 'Cerrar', payload)
  })

  ejecutar()
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

  // Misma razón que en crearBoletaLocal: el UPDATE de Boleta y el evento
  // OutboxLocal 'Anular' van en una sola transacción.
  const ejecutar = getDb().transaction((): void => {
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

    // Ver el comentario en crearBoletaLocal sobre el alcance del payload.
    const payload = JSON.stringify(obtenerBoletaLocal(id))
    registrarEventoOutboxLocal('Boleta', id, 'Anular', payload)
  })

  ejecutar()
  return obtenerBoletaLocal(id)
}

// ---------------------------------------------------------------------------
// Extensiones de Boleta — Calidad, DetalleFruta, Compostera, Caracteristica.
// Mismos campos que backend/Domain/Boletas/Extensiones (ver *.cs), en
// camelCase. El gate de TipoMovimiento.Habilita* vive en local-server.ts
// (lee Boleta.HabilitaCalidad/HabilitaDetalleFruta/HabilitaCompostera, ya
// denormalizadas en la fila — ver el comentario junto al ALTER TABLE de
// arriba), no acá: estas funciones solo leen/escriben, no deciden si el
// caller tiene permiso.
// ---------------------------------------------------------------------------

export interface BoletaCalidadLocal {
  id: string
  boletaId: string
  acidez: number | null
  dobi: number | null
  humedad: number | null
  temperatura: number | null
  numeroRevisionQA: string | null
}

interface BoletaCalidadRow {
  Id: string
  BoletaId: string
  Acidez: number | null
  DOBI: number | null
  Humedad: number | null
  Temperatura: number | null
  NumeroRevisionQA: string | null
}

function filaABoletaCalidadLocal(row: BoletaCalidadRow): BoletaCalidadLocal {
  return {
    id: row.Id,
    boletaId: row.BoletaId,
    acidez: row.Acidez,
    dobi: row.DOBI,
    humedad: row.Humedad,
    temperatura: row.Temperatura,
    numeroRevisionQA: row.NumeroRevisionQA,
  }
}

export function obtenerBoletaCalidadLocal(boletaId: string): BoletaCalidadLocal | null {
  const row = getDb()
    .prepare('SELECT * FROM BoletaCalidad WHERE BoletaId = ?')
    .get(boletaId) as BoletaCalidadRow | undefined
  return row ? filaABoletaCalidadLocal(row) : null
}

/** Upsert — a lo sumo una fila de Calidad por boleta (BoletaId UNIQUE). */
export function guardarBoletaCalidadLocal(
  boletaId: string,
  input: Omit<BoletaCalidadLocal, 'id' | 'boletaId'>,
): BoletaCalidadLocal {
  getDb()
    .prepare(
      `INSERT INTO BoletaCalidad (Id, BoletaId, Acidez, DOBI, Humedad, Temperatura, NumeroRevisionQA)
       VALUES (@id, @boletaId, @acidez, @dobi, @humedad, @temperatura, @numeroRevisionQA)
       ON CONFLICT(BoletaId) DO UPDATE SET
         Acidez = excluded.Acidez,
         DOBI = excluded.DOBI,
         Humedad = excluded.Humedad,
         Temperatura = excluded.Temperatura,
         NumeroRevisionQA = excluded.NumeroRevisionQA`,
    )
    .run({
      id: crypto.randomUUID(),
      boletaId,
      acidez: input.acidez,
      dobi: input.dobi,
      humedad: input.humedad,
      temperatura: input.temperatura,
      numeroRevisionQA: input.numeroRevisionQA,
    })

  return obtenerBoletaCalidadLocal(boletaId)!
}

export interface BoletaComposteraLocal {
  id: string
  boletaId: string
  cui: string
  camaId: string
  seccionId: string
  cicloId: string
}

interface BoletaComposteraRow {
  Id: string
  BoletaId: string
  CUI: string
  CamaId: string
  SeccionId: string
  CicloId: string
}

function filaABoletaComposteraLocal(row: BoletaComposteraRow): BoletaComposteraLocal {
  return {
    id: row.Id,
    boletaId: row.BoletaId,
    cui: row.CUI,
    camaId: row.CamaId,
    seccionId: row.SeccionId,
    cicloId: row.CicloId,
  }
}

export function obtenerBoletaComposteraLocal(boletaId: string): BoletaComposteraLocal | null {
  const row = getDb()
    .prepare('SELECT * FROM BoletaCompostera WHERE BoletaId = ?')
    .get(boletaId) as BoletaComposteraRow | undefined
  return row ? filaABoletaComposteraLocal(row) : null
}

/** Upsert — a lo sumo una fila de Compostera por boleta (BoletaId UNIQUE). */
export function guardarBoletaComposteraLocal(
  boletaId: string,
  input: Omit<BoletaComposteraLocal, 'id' | 'boletaId'>,
): BoletaComposteraLocal {
  getDb()
    .prepare(
      `INSERT INTO BoletaCompostera (Id, BoletaId, CUI, CamaId, SeccionId, CicloId)
       VALUES (@id, @boletaId, @cui, @camaId, @seccionId, @cicloId)
       ON CONFLICT(BoletaId) DO UPDATE SET
         CUI = excluded.CUI,
         CamaId = excluded.CamaId,
         SeccionId = excluded.SeccionId,
         CicloId = excluded.CicloId`,
    )
    .run({
      id: crypto.randomUUID(),
      boletaId,
      cui: input.cui,
      camaId: input.camaId,
      seccionId: input.seccionId,
      cicloId: input.cicloId,
    })

  return obtenerBoletaComposteraLocal(boletaId)!
}

export interface BoletaDetalleFrutaLocal {
  id: string
  boletaId: string
  racimosVerdes: number
  racimosMaduros: number
  racimosSobreMaduros: number
  racimosPasados: number
  pedunculoLargo: number
  sacos: number
  jornales: number
  hectareas: number
}

interface BoletaDetalleFrutaRow {
  Id: string
  BoletaId: string
  RacimosVerdes: number
  RacimosMaduros: number
  RacimosSobreMaduros: number
  RacimosPasados: number
  PedunculoLargo: number
  Sacos: number
  Jornales: number
  Hectareas: number
}

function filaABoletaDetalleFrutaLocal(row: BoletaDetalleFrutaRow): BoletaDetalleFrutaLocal {
  return {
    id: row.Id,
    boletaId: row.BoletaId,
    racimosVerdes: row.RacimosVerdes,
    racimosMaduros: row.RacimosMaduros,
    racimosSobreMaduros: row.RacimosSobreMaduros,
    racimosPasados: row.RacimosPasados,
    pedunculoLargo: row.PedunculoLargo,
    sacos: row.Sacos,
    jornales: row.Jornales,
    hectareas: row.Hectareas,
  }
}

export function listarBoletaDetalleFrutaLocal(boletaId: string): BoletaDetalleFrutaLocal[] {
  const rows = getDb()
    .prepare('SELECT * FROM BoletaDetalleFruta WHERE BoletaId = ?')
    .all(boletaId) as BoletaDetalleFrutaRow[]
  return rows.map(filaABoletaDetalleFrutaLocal)
}

export function agregarBoletaDetalleFrutaLocal(
  boletaId: string,
  input: Omit<BoletaDetalleFrutaLocal, 'id' | 'boletaId'>,
): BoletaDetalleFrutaLocal {
  const id = crypto.randomUUID()

  getDb()
    .prepare(
      `INSERT INTO BoletaDetalleFruta (
        Id, BoletaId, RacimosVerdes, RacimosMaduros, RacimosSobreMaduros,
        RacimosPasados, PedunculoLargo, Sacos, Jornales, Hectareas
      ) VALUES (
        @id, @boletaId, @racimosVerdes, @racimosMaduros, @racimosSobreMaduros,
        @racimosPasados, @pedunculoLargo, @sacos, @jornales, @hectareas
      )`,
    )
    .run({ id, boletaId, ...input })

  const row = getDb()
    .prepare('SELECT * FROM BoletaDetalleFruta WHERE Id = ?')
    .get(id) as BoletaDetalleFrutaRow
  return filaABoletaDetalleFrutaLocal(row)
}

/** true si existía y se borró. */
export function eliminarBoletaDetalleFrutaLocal(boletaId: string, id: string): boolean {
  const resultado = getDb()
    .prepare('DELETE FROM BoletaDetalleFruta WHERE Id = ? AND BoletaId = ?')
    .run(id, boletaId)
  return resultado.changes > 0
}

export interface BoletaCaracteristicaLocal {
  id: string
  boletaId: string
  clave: string
  valor: string
  tipoDato: string
}

interface BoletaCaracteristicaRow {
  Id: string
  BoletaId: string
  Clave: string
  Valor: string
  TipoDato: string
}

function filaABoletaCaracteristicaLocal(row: BoletaCaracteristicaRow): BoletaCaracteristicaLocal {
  return {
    id: row.Id,
    boletaId: row.BoletaId,
    clave: row.Clave,
    valor: row.Valor,
    tipoDato: row.TipoDato,
  }
}

export function listarBoletaCaracteristicaLocal(boletaId: string): BoletaCaracteristicaLocal[] {
  const rows = getDb()
    .prepare('SELECT * FROM BoletaCaracteristica WHERE BoletaId = ?')
    .all(boletaId) as BoletaCaracteristicaRow[]
  return rows.map(filaABoletaCaracteristicaLocal)
}

export function agregarBoletaCaracteristicaLocal(
  boletaId: string,
  input: Omit<BoletaCaracteristicaLocal, 'id' | 'boletaId'>,
): BoletaCaracteristicaLocal {
  const id = crypto.randomUUID()

  getDb()
    .prepare(
      `INSERT INTO BoletaCaracteristica (Id, BoletaId, Clave, Valor, TipoDato)
       VALUES (@id, @boletaId, @clave, @valor, @tipoDato)`,
    )
    .run({ id, boletaId, ...input })

  const row = getDb()
    .prepare('SELECT * FROM BoletaCaracteristica WHERE Id = ?')
    .get(id) as BoletaCaracteristicaRow
  return filaABoletaCaracteristicaLocal(row)
}

/** true si existía y se borró. */
export function eliminarBoletaCaracteristicaLocal(boletaId: string, id: string): boolean {
  const resultado = getDb()
    .prepare('DELETE FROM BoletaCaracteristica WHERE Id = ? AND BoletaId = ?')
    .run(id, boletaId)
  return resultado.changes > 0
}
