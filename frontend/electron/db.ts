import Database from 'better-sqlite3'
import path from 'node:path'
import { app } from 'electron'

let db: Database.Database | null = null

// Forma "Encabezado" de la Boleta local — espejo del Encabezado EAV del central
// (backend/Domain/Boletas/Boleta.cs). Ya NO trae las 7 FKs de rol a Maestro
// (equipo/transportista/piloto/tercero/producto/almacén origen/destino) ni los 3
// flags Habilita* denormalizados: ese contexto de negocio ahora son valores
// configurables (BoletaValorCampo) resueltos por sección/campo.
//
// Sin BasculaId a propósito: este archivo SQLite es de UNA sola báscula (una
// instalación = una báscula física), así que la báscula de una fila local
// siempre es "esta báscula" — es implícito. El espejo central sí tiene BasculaId
// porque agrega boletas de todas las básculas; el Outbox de sync lo completa
// leyendo la config local al subir la boleta.
//
// EstadoSync acá SIEMPRE arranca en 'Local' — hay un paso real de sync pendiente
// (Outbox), así que 'Local' es el estado inicial honesto.
const SQL_CREAR_BOLETA = `
  CREATE TABLE IF NOT EXISTS Boleta (
    Id TEXT PRIMARY KEY,
    NumeroBoleta TEXT NOT NULL UNIQUE,
    TipoMovimientoId TEXT NOT NULL,
    Estado TEXT NOT NULL,
    EstadoSync TEXT NOT NULL,
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
    FechaHoraAnulacion TEXT,
    PreIngresoId TEXT,
    BoletaReemplazoId TEXT,
    BoletaOrigenId TEXT,
    BasculaSalidaId TEXT,
    RespuestaD365Id TEXT,
    CreadaOffline INTEGER NOT NULL
  );
`

// Versión del esquema SQLite local. v2 = Boleta pasa de la forma vieja (FKs de
// rol a Maestro + Habilita*) al Encabezado EAV, y las tablas de extensión legacy
// (BoletaCalidad/DetalleFruta/Compostera/Caracteristica) se descartan.
const ESQUEMA_LOCAL_VERSION = '2'

/**
 * Guardia de versión del esquema local (decisión de diseño D2). SQLite no
 * permite dropear varias columnas de forma razonable y CREATE TABLE IF NOT
 * EXISTS no toca una Boleta vieja preexistente, así que el salto al Encabezado
 * EAV se hace recreando la tabla. NO hay datos de producción en básculas: las
 * boletas locales en tránsito se PIERDEN — costo aceptado del rollout (ver
 * README, "Reset del SQLite local de la báscula"). El bump de versión hace que
 * borrar el .sqlite a mano sea opcional para la mayoría.
 */
function aplicarReshapeEsquemaLocal(database: Database.Database): void {
  const fila = database
    .prepare(`SELECT Valor FROM ConfiguracionLocal WHERE Clave = 'EsquemaLocalVersion'`)
    .get() as { Valor: string } | undefined
  if (fila?.Valor === ESQUEMA_LOCAL_VERSION) return

  const sellarVersion = (): void => {
    database
      .prepare(
        `INSERT INTO ConfiguracionLocal (Clave, Valor) VALUES ('EsquemaLocalVersion', ?)
         ON CONFLICT(Clave) DO UPDATE SET Valor = excluded.Valor`,
      )
      .run(ESQUEMA_LOCAL_VERSION)
  }

  // Las instalaciones previas nunca sellaron EsquemaLocalVersion, así que no
  // alcanza con mirar la clave: se inspecciona la forma real de la tabla Boleta.
  // Si todavía tiene alguna columna de la forma vieja (FK de rol a Maestro o un
  // flag Habilita*), es una DB v1 que hay que reshapear. Una DB nueva ya nació
  // con la forma Encabezado y solo necesita que se selle la versión.
  const columnasBoleta = database.prepare(`PRAGMA table_info(Boleta)`).all() as { name: string }[]
  const tieneFormaVieja = columnasBoleta.some(
    (c) => c.name === 'HabilitaCalidad' || c.name === 'EquipoId',
  )

  if (tieneFormaVieja) {
    console.warn(
      '[db] Migrando el esquema SQLite local a v2: se recrea Boleta con la ' +
        'forma Encabezado (EAV) y se descartan las tablas de extensión legacy ' +
        '(BoletaCalidad/DetalleFruta/Compostera/Caracteristica). Las boletas ' +
        'locales EN TRÁNSITO SE PIERDEN — no hay datos de producción en básculas.',
    )
    database.exec(`
      DROP TABLE IF EXISTS Boleta;
      DROP TABLE IF EXISTS BoletaCalidad;
      DROP TABLE IF EXISTS BoletaDetalleFruta;
      DROP TABLE IF EXISTS BoletaCompostera;
      DROP TABLE IF EXISTS BoletaCaracteristica;
    `)
    database.exec(SQL_CREAR_BOLETA)
  }

  sellarVersion()
}

// Un archivo SQLite embebido por instalación de báscula — sin servidor, sin
// nada que configurar aparte de correr el instalador de Electron.
export function getDb(): Database.Database {
  if (db) return db

  const dbPath = path.join(app.getPath('userData'), 'bascula.sqlite')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')

  // Todo lo que sea puro CREATE TABLE IF NOT EXISTS vive en este bloque; el
  // reshape de Boleta al Encabezado EAV (que SÍ necesita DROP) lo maneja
  // aplicarReshapeEsquemaLocal() más abajo.
  db.exec(`
    CREATE TABLE IF NOT EXISTS ConfiguracionLocal (
      Clave TEXT PRIMARY KEY,
      Valor TEXT
    );

    CREATE TABLE IF NOT EXISTS Correlativo (
      Prefijo TEXT PRIMARY KEY,
      Secuencial INTEGER NOT NULL DEFAULT 0
    );

    ${SQL_CREAR_BOLETA}

    -- Espejo local de la configuración central de secciones/campos
    -- (backend/Domain/Configuracion + backend/Domain/Boletas/Valores).
    -- Column-for-column con el esquema central v7: Id como TEXT (Guid verbatim),
    -- enums y timestamps como TEXT ISO-8601. Se llenan por config-sync (todavía
    -- no implementado, slice D2) con ?modificadoDesde=MAX(FechaModificacion) por
    -- tabla — mismo patrón de marca de agua que Maestro, sin watermark
    -- almacenado.
    CREATE TABLE IF NOT EXISTS Seccion (
      Id TEXT PRIMARY KEY,
      Clave TEXT NOT NULL UNIQUE,
      Nombre TEXT NOT NULL,
      Cardinalidad TEXT NOT NULL,
      Reportable INTEGER NOT NULL,
      Estandar INTEGER NOT NULL,
      Orden INTEGER NOT NULL,
      Activa INTEGER NOT NULL,
      FechaModificacion TEXT NOT NULL
    );

    -- Campo es versionado: una fila nueva (nuevo Id, misma Clave) reemplaza a la
    -- anterior, a la que se le pone VigenteHasta. Por eso (SeccionId, Clave)
    -- solo es único entre versiones vigentes — índice parcial, igual que el
    -- filtered unique index central.
    CREATE TABLE IF NOT EXISTS Campo (
      Id TEXT PRIMARY KEY,
      SeccionId TEXT NOT NULL,
      Clave TEXT NOT NULL,
      Etiqueta TEXT NOT NULL,
      TipoCampo TEXT NOT NULL,
      TipoCatalogoRef TEXT,
      Requerido INTEGER NOT NULL,
      Configuracion TEXT,
      Orden INTEGER NOT NULL,
      VigenteDesde TEXT NOT NULL,
      VigenteHasta TEXT,
      FechaModificacion TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS IX_Campo_Seccion_Clave_Vigente
      ON Campo(SeccionId, Clave) WHERE VigenteHasta IS NULL;
    CREATE INDEX IF NOT EXISTS IX_Campo_Seccion_Orden ON Campo(SeccionId, Orden);

    -- Puente temporal TipoMovimiento↔Seccion. VigenteDesde entra a la PK (igual
    -- que el central, que se desvió de la PK de 2 columnas del v7 §03) para que
    -- reasignar una sección no choque con la fila cerrada. El índice parcial
    -- garantiza una sola asignación abierta por par.
    CREATE TABLE IF NOT EXISTS TipoMovimientoSeccion (
      TipoMovimientoId TEXT NOT NULL,
      SeccionId TEXT NOT NULL,
      VigenteDesde TEXT NOT NULL,
      VigenteHasta TEXT,
      Requerida INTEGER NOT NULL,
      Orden INTEGER NOT NULL,
      FechaModificacion TEXT NOT NULL,
      PRIMARY KEY (TipoMovimientoId, SeccionId, VigenteDesde)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS IX_TipoMovimientoSeccion_Vigente
      ON TipoMovimientoSeccion(TipoMovimientoId, SeccionId) WHERE VigenteHasta IS NULL;

    -- Valores capturados en una boleta (EAV tipado), espejo de
    -- backend/Domain/Boletas/Valores/BoletaValorCampo. Exactamente una columna
    -- Valor* poblada por fila — mismo check constraint que el central
    -- (CK_BoletaValorCampo_UnSoloValor). ValorNumero se guarda como TEXT para no
    -- perder precisión decimal (central: decimal(18,4)); el motor lo parsea.
    -- SeccionId es denormalizado server-side desde Campo.SeccionId, nunca del
    -- cliente.
    CREATE TABLE IF NOT EXISTS BoletaValorCampo (
      BoletaId TEXT NOT NULL,
      CampoId TEXT NOT NULL,
      Ocurrencia INTEGER NOT NULL,
      SeccionId TEXT NOT NULL,
      ValorTexto TEXT,
      ValorNumero TEXT,
      ValorFecha TEXT,
      ValorBooleano INTEGER,
      ValorMaestroId TEXT,
      PRIMARY KEY (BoletaId, CampoId, Ocurrencia),
      CONSTRAINT CK_BoletaValorCampo_UnSoloValor CHECK (
        (CASE WHEN ValorTexto IS NULL THEN 0 ELSE 1 END
         + CASE WHEN ValorNumero IS NULL THEN 0 ELSE 1 END
         + CASE WHEN ValorFecha IS NULL THEN 0 ELSE 1 END
         + CASE WHEN ValorBooleano IS NULL THEN 0 ELSE 1 END
         + CASE WHEN ValorMaestroId IS NULL THEN 0 ELSE 1 END) = 1
      )
    );

    CREATE INDEX IF NOT EXISTS IX_BoletaValorCampo_Boleta_Seccion
      ON BoletaValorCampo(BoletaId, SeccionId);
    CREATE INDEX IF NOT EXISTS IX_BoletaValorCampo_ValorMaestroId
      ON BoletaValorCampo(ValorMaestroId);

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

    -- Snapshot local de Maestro, alimentado por el aprovisionamiento inicial
    -- (descarga completa) y el sync incremental de ahí en adelante
    -- (modificadoDesde, ver maestros-sync.ts) — este cache es lo que le
    -- permite a Pesaje llenar sus combos sin conexión.
    CREATE TABLE IF NOT EXISTS Maestro (
      Id TEXT PRIMARY KEY,
      TipoCatalogo TEXT NOT NULL,
      Codigo TEXT NOT NULL,
      Nombre TEXT NOT NULL,
      DatosAdicionales TEXT,
      Estado TEXT NOT NULL,
      FusionadoConId TEXT,
      FechaModificacion TEXT NOT NULL,
      Activo INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS IX_Maestro_TipoCatalogo ON Maestro(TipoCatalogo);
  `)

  aplicarReshapeEsquemaLocal(db)

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

// Encabezado de la Boleta local, en camelCase — espejo del Encabezado EAV del
// central. Ver el comentario junto a SQL_CREAR_BOLETA para el porqué de las
// columnas que ya no están (FKs de rol a Maestro, Habilita*, BasculaId).
export interface BoletaLocal {
  id: string
  numeroBoleta: string
  tipoMovimientoId: string
  estado: EstadoBoletaLocal
  estadoSync: EstadoSyncBoletaLocal
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
  fechaHoraAnulacion: string | null
  preIngresoId: string | null
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
  FechaHoraAnulacion: string | null
  PreIngresoId: string | null
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
    fechaHoraAnulacion: row.FechaHoraAnulacion,
    preIngresoId: row.PreIngresoId,
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
 * Marca el resultado de un intento de despacho — la usa el dispatcher
 * (outbox-dispatcher.ts), nunca los escritores de Boleta. A diferencia de
 * registrarEventoOutboxLocal, no corre dentro de una transacción compartida
 * con ninguna otra escritura: es un solo UPDATE independiente, no hay nada
 * más con lo que deba comitear o revertirse junto.
 */
export function marcarOutboxLocalResultado(
  id: string,
  resultado: { estado: 'Enviado' } | { estado: 'Pendiente' | 'Error'; ultimoError: string },
): void {
  if (resultado.estado === 'Enviado') {
    getDb()
      .prepare(`UPDATE OutboxLocal SET Estado = 'Enviado', FechaEnviado = @fechaEnviado WHERE Id = @id`)
      .run({ id, fechaEnviado: new Date().toISOString() })
    return
  }

  getDb()
    .prepare(
      `UPDATE OutboxLocal SET
        Estado = @estado,
        Intentos = Intentos + 1,
        UltimoError = @ultimoError
      WHERE Id = @id`,
    )
    .run({ id, estado: resultado.estado, ultimoError: resultado.ultimoError })
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
    | 'fechaHoraAnulacion'
    | 'preIngresoId'
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
          PesoIngreso, OrigenPesoIngreso,
          FechaHoraIngreso, UsuarioIngreso, CreadaOffline
        ) VALUES (
          @id, @numeroBoleta, @tipoMovimientoId, @estado, @estadoSync,
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
        pesoIngreso: input.pesoIngreso,
        origenPesoIngreso: input.origenPesoIngreso,
        fechaHoraIngreso,
        usuarioIngreso: input.usuarioIngreso,
        creadaOffline: input.creadaOffline ? 1 : 0,
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
          MotivoAnulacion = @motivoAnulacion,
          FechaHoraAnulacion = @fechaHoraAnulacion
        WHERE Id = @id`,
      )
      .run({ id, ...input, fechaHoraAnulacion: new Date().toISOString() })

    // Ver el comentario en crearBoletaLocal sobre el alcance del payload.
    const payload = JSON.stringify(obtenerBoletaLocal(id))
    registrarEventoOutboxLocal('Boleta', id, 'Anular', payload)
  })

  ejecutar()
  return obtenerBoletaLocal(id)
}

// ---------------------------------------------------------------------------
// Espejo local de la configuración central (Seccion, Campo,
// TipoMovimientoSeccion, BoletaValorCampo). Ver los CREATE TABLE en getDb()
// para el porqué de cada columna. Este slice (D1) solo agrega el esquema y los
// tipos de fila; los helpers de lectura/escritura y el sync entran en D2/D3/D4.
// Las tablas de extensión legacy (BoletaCalidad/DetalleFruta/Compostera/
// Caracteristica) y sus helpers se eliminaron: ese contexto ahora vive como
// BoletaValorCampo resuelto por sección/campo configurable.
// ---------------------------------------------------------------------------

/** Fila cruda de `Seccion` (columnas PascalCase, booleanos 0/1). */
export interface SeccionRow {
  Id: string
  Clave: string
  Nombre: string
  Cardinalidad: string
  Reportable: number
  Estandar: number
  Orden: number
  Activa: number
  FechaModificacion: string
}

/** Fila cruda de `Campo`. `VigenteHasta` null = versión vigente. */
export interface CampoRow {
  Id: string
  SeccionId: string
  Clave: string
  Etiqueta: string
  TipoCampo: string
  TipoCatalogoRef: string | null
  Requerido: number
  Configuracion: string | null
  Orden: number
  VigenteDesde: string
  VigenteHasta: string | null
  FechaModificacion: string
}

/** Fila cruda de `TipoMovimientoSeccion`. PK (TipoMovimientoId, SeccionId, VigenteDesde). */
export interface TipoMovimientoSeccionRow {
  TipoMovimientoId: string
  SeccionId: string
  VigenteDesde: string
  VigenteHasta: string | null
  Requerida: number
  Orden: number
  FechaModificacion: string
}

/**
 * Fila cruda de `BoletaValorCampo` (EAV tipado). Exactamente una columna
 * `Valor*` no nula por fila (check constraint). `ValorNumero` se guarda como
 * TEXT para no perder precisión decimal.
 */
export interface BoletaValorCampoRow {
  BoletaId: string
  CampoId: string
  Ocurrencia: number
  SeccionId: string
  ValorTexto: string | null
  ValorNumero: string | null
  ValorFecha: string | null
  ValorBooleano: number | null
  ValorMaestroId: string | null
}

// ---------------------------------------------------------------------------
// Maestro — snapshot local del catálogo central (ver el CREATE TABLE en
// getDb() para el porqué). El escritor (upsertMaestrosLocal) lo usan el
// aprovisionamiento inicial y el sync incremental (maestros-sync.ts); el
// lector (listarMaestrosLocal) es lo que alimenta los combos de Pesaje.
// ---------------------------------------------------------------------------

export interface MaestroLocal {
  id: string
  tipoCatalogo: string
  codigo: string
  nombre: string
  datosAdicionales: string | null
  estado: string
  fusionadoConId: string | null
  fechaModificacion: string
  activo: boolean
}

interface MaestroRow {
  Id: string
  TipoCatalogo: string
  Codigo: string
  Nombre: string
  DatosAdicionales: string | null
  Estado: string
  FusionadoConId: string | null
  FechaModificacion: string
  Activo: number
}

function filaAMaestroLocal(row: MaestroRow): MaestroLocal {
  return {
    id: row.Id,
    tipoCatalogo: row.TipoCatalogo,
    codigo: row.Codigo,
    nombre: row.Nombre,
    datosAdicionales: row.DatosAdicionales,
    estado: row.Estado,
    fusionadoConId: row.FusionadoConId,
    fechaModificacion: row.FechaModificacion,
    activo: Boolean(row.Activo),
  }
}

/**
 * Upsert en bloque — TODAS las filas comitean juntas o ninguna (mismo
 * espíritu transaccional que crearBoletaLocal/OutboxLocal, aplicado acá a
 * una tanda de descarga en vez de a una sola escritura). Sin filas, no vale
 * la pena ni abrir la transacción.
 */
export function upsertMaestrosLocal(maestros: MaestroLocal[]): void {
  if (maestros.length === 0) return

  const upsert = getDb().prepare(
    `INSERT INTO Maestro (
      Id, TipoCatalogo, Codigo, Nombre, DatosAdicionales, Estado, FusionadoConId, FechaModificacion, Activo
    ) VALUES (
      @id, @tipoCatalogo, @codigo, @nombre, @datosAdicionales, @estado, @fusionadoConId, @fechaModificacion, @activo
    )
    ON CONFLICT(Id) DO UPDATE SET
      TipoCatalogo = excluded.TipoCatalogo,
      Codigo = excluded.Codigo,
      Nombre = excluded.Nombre,
      DatosAdicionales = excluded.DatosAdicionales,
      Estado = excluded.Estado,
      FusionadoConId = excluded.FusionadoConId,
      FechaModificacion = excluded.FechaModificacion,
      Activo = excluded.Activo`,
  )

  const ejecutar = getDb().transaction((filas: MaestroLocal[]): void => {
    for (const m of filas) {
      upsert.run({
        id: m.id,
        tipoCatalogo: m.tipoCatalogo,
        codigo: m.codigo,
        nombre: m.nombre,
        datosAdicionales: m.datosAdicionales,
        estado: m.estado,
        fusionadoConId: m.fusionadoConId,
        fechaModificacion: m.fechaModificacion,
        activo: m.activo ? 1 : 0,
      })
    }
  })

  ejecutar(maestros)
}

/**
 * Read path de los combos de Pesaje — SIEMPRE filtra Activo=1: un Maestro
 * desactivado tiene que desaparecer del combo offline exactamente igual que
 * ya desaparece de los listados centrales.
 */
export function listarMaestrosLocal(tipoCatalogo?: string): MaestroLocal[] {
  const rows = tipoCatalogo
    ? (getDb()
        .prepare('SELECT * FROM Maestro WHERE Activo = 1 AND TipoCatalogo = ? ORDER BY Nombre')
        .all(tipoCatalogo) as MaestroRow[])
    : (getDb().prepare('SELECT * FROM Maestro WHERE Activo = 1 ORDER BY Nombre').all() as MaestroRow[])
  return rows.map(filaAMaestroLocal)
}

/** Watermark del sync incremental — null si esta báscula nunca sincronizó nada todavía. */
export function obtenerUltimaSincronizacionMaestros(): string | null {
  const row = getDb().prepare('SELECT MAX(FechaModificacion) as maximo FROM Maestro').get() as {
    maximo: string | null
  }
  return row.maximo
}
