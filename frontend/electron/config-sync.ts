import type Database from 'better-sqlite3'
import { getConfig, getDb } from './db'

// Mismo origen hardcodeado que maestros-sync.ts / outbox-dispatcher.ts — sin
// .env, sin secretos acá.
const CENTRAL_API_URL = 'http://localhost:5094'

/**
 * Fetcher inyectable — en producción es el `fetch` global; los specs pasan un
 * doble que sirve datos de un central falso. Se acota a lo que este módulo usa
 * (`ok` / `status` / `json`), así el `fetch` global encaja sin adaptador.
 */
export type Fetcher = (url: string) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<unknown>
}>

// --- DTOs del central (camelCase, enums como string por JsonStringEnumConverter) ---

interface SeccionDto {
  id: string
  clave: string
  nombre: string
  cardinalidad: string
  reportable: boolean
  estandar: boolean
  orden: number
  activa: boolean
  fechaModificacion: string
}

interface CampoDto {
  id: string
  seccionId: string
  clave: string
  etiqueta: string
  tipoCampo: string
  tipoCatalogoRef: string | null
  requerido: boolean
  configuracion: string | null
  orden: number
  vigenteDesde: string
  vigenteHasta: string | null
  fechaModificacion: string
}

// El DTO central NO trae TipoMovimientoId — la ruta es por-tipo, así que el id
// viene del contexto del request (ver el fan-out en sincronizarConfig).
interface TipoMovimientoSeccionDto {
  seccionId: string
  requerida: boolean
  orden: number
  vigenteDesde: string
  vigenteHasta: string | null
  fechaModificacion: string
}

interface TipoMovimientoDto {
  id: string
  activo: boolean
}

export interface ResultadoConfigSync {
  secciones: number
  campos: number
  tiposMovimientoSeccion: number
}

/**
 * Marca de agua por tabla — `MAX(FechaModificacion)`, mismo patrón que
 * maestros-sync (sin watermark almacenado). `tabla` es un literal interno, no
 * entra nada del exterior.
 */
function watermark(db: Database.Database, tabla: 'Seccion' | 'Campo' | 'TipoMovimientoSeccion'): string | null {
  const fila = db.prepare(`SELECT MAX(FechaModificacion) AS m FROM ${tabla}`).get() as {
    m: string | null
  }
  return fila.m
}

async function pull<T>(fetcher: Fetcher, url: string): Promise<T[]> {
  const respuesta = await fetcher(url)
  if (!respuesta.ok) {
    throw new Error(`config-sync: HTTP ${respuesta.status} en ${url}`)
  }
  return (await respuesta.json()) as T[]
}

function upsertSeccion(db: Database.Database, s: SeccionDto): void {
  db.prepare(
    `INSERT INTO Seccion (
      Id, Clave, Nombre, Cardinalidad, Reportable, Estandar, Orden, Activa, FechaModificacion
    ) VALUES (
      @id, @clave, @nombre, @cardinalidad, @reportable, @estandar, @orden, @activa, @fechaModificacion
    )
    ON CONFLICT(Id) DO UPDATE SET
      Clave = excluded.Clave,
      Nombre = excluded.Nombre,
      Cardinalidad = excluded.Cardinalidad,
      Reportable = excluded.Reportable,
      Estandar = excluded.Estandar,
      Orden = excluded.Orden,
      Activa = excluded.Activa,
      FechaModificacion = excluded.FechaModificacion`,
  ).run({
    id: s.id,
    clave: s.clave,
    nombre: s.nombre,
    cardinalidad: s.cardinalidad,
    reportable: s.reportable ? 1 : 0,
    estandar: s.estandar ? 1 : 0,
    orden: s.orden,
    activa: s.activa ? 1 : 0,
    fechaModificacion: s.fechaModificacion,
  })
}

function upsertCampo(db: Database.Database, c: CampoDto): void {
  db.prepare(
    `INSERT INTO Campo (
      Id, SeccionId, Clave, Etiqueta, TipoCampo, TipoCatalogoRef, Requerido,
      Configuracion, Orden, VigenteDesde, VigenteHasta, FechaModificacion
    ) VALUES (
      @id, @seccionId, @clave, @etiqueta, @tipoCampo, @tipoCatalogoRef, @requerido,
      @configuracion, @orden, @vigenteDesde, @vigenteHasta, @fechaModificacion
    )
    ON CONFLICT(Id) DO UPDATE SET
      SeccionId = excluded.SeccionId,
      Clave = excluded.Clave,
      Etiqueta = excluded.Etiqueta,
      TipoCampo = excluded.TipoCampo,
      TipoCatalogoRef = excluded.TipoCatalogoRef,
      Requerido = excluded.Requerido,
      Configuracion = excluded.Configuracion,
      Orden = excluded.Orden,
      VigenteDesde = excluded.VigenteDesde,
      VigenteHasta = excluded.VigenteHasta,
      FechaModificacion = excluded.FechaModificacion`,
  ).run({
    id: c.id,
    seccionId: c.seccionId,
    clave: c.clave,
    etiqueta: c.etiqueta,
    tipoCampo: c.tipoCampo,
    tipoCatalogoRef: c.tipoCatalogoRef,
    requerido: c.requerido ? 1 : 0,
    configuracion: c.configuracion,
    orden: c.orden,
    vigenteDesde: c.vigenteDesde,
    vigenteHasta: c.vigenteHasta,
    fechaModificacion: c.fechaModificacion,
  })
}

function upsertTipoMovimientoSeccion(
  db: Database.Database,
  tipoMovimientoId: string,
  t: TipoMovimientoSeccionDto,
): void {
  db.prepare(
    `INSERT INTO TipoMovimientoSeccion (
      TipoMovimientoId, SeccionId, VigenteDesde, VigenteHasta, Requerida, Orden, FechaModificacion
    ) VALUES (
      @tipoMovimientoId, @seccionId, @vigenteDesde, @vigenteHasta, @requerida, @orden, @fechaModificacion
    )
    ON CONFLICT(TipoMovimientoId, SeccionId, VigenteDesde) DO UPDATE SET
      VigenteHasta = excluded.VigenteHasta,
      Requerida = excluded.Requerida,
      Orden = excluded.Orden,
      FechaModificacion = excluded.FechaModificacion`,
  ).run({
    tipoMovimientoId,
    seccionId: t.seccionId,
    vigenteDesde: t.vigenteDesde,
    vigenteHasta: t.vigenteHasta,
    requerida: t.requerida ? 1 : 0,
    orden: t.orden,
    fechaModificacion: t.fechaModificacion,
  })
}

// Las filas cerradas (VigenteHasta != null) primero: al versionar un Campo o una
// asignación, el central manda en el mismo delta la fila vieja (recién cerrada)
// y la nueva vigente. Sin este orden, insertar la nueva antes de cerrar la
// vieja choca contra el índice único parcial `WHERE VigenteHasta IS NULL`.
function cerradasPrimero<T>(filas: T[], vigenteHasta: (fila: T) => string | null): T[] {
  return [...filas].sort((a, b) => (vigenteHasta(a) ? 0 : 1) - (vigenteHasta(b) ? 0 : 1))
}

/**
 * Sync de configuración por marca de agua (spec Layer D, "Config sync by
 * watermark"). Para `Seccion` / `Campo` / `TipoMovimientoSeccion`: pide el delta
 * con `?modificadoDesde=<MAX(FechaModificacion) local>`, hace upsert por PK.
 *
 * No hay endpoint global de TipoMovimientoSeccion — el delta es por tipo de
 * movimiento, así que se listan los tipos (`GET /api/tipos-movimiento`) y se
 * hace fan-out con una única marca de agua tomada al inicio de la corrida.
 *
 * TODO el batch se baja ANTES de escribir y se persiste en UNA transacción: si
 * cualquier fetch falla, no se escribió nada y ninguna marca de agua avanzó —
 * idempotente y reanudable, mismo posture que maestros-sync. Un fallo acá nunca
 * bloquea la creación de boletas (el caller — interval de main.ts o la ruta de
 * disparo — captura el error).
 */
export async function sincronizarConfig(
  db: Database.Database,
  opciones: { fetcher?: Fetcher; baseUrl?: string } = {},
): Promise<ResultadoConfigSync> {
  const fetcher = opciones.fetcher ?? (globalThis.fetch as unknown as Fetcher)
  const baseUrl = opciones.baseUrl ?? CENTRAL_API_URL
  const qs = (wm: string | null): string => (wm ? `?modificadoDesde=${encodeURIComponent(wm)}` : '')

  // 1. Bajar todo antes de escribir.
  const secciones = await pull<SeccionDto>(fetcher, `${baseUrl}/api/secciones${qs(watermark(db, 'Seccion'))}`)
  const campos = await pull<CampoDto>(fetcher, `${baseUrl}/api/campos${qs(watermark(db, 'Campo'))}`)

  const tmsWm = watermark(db, 'TipoMovimientoSeccion')
  const tipos = await pull<TipoMovimientoDto>(fetcher, `${baseUrl}/api/tipos-movimiento?incluirInactivos=true`)
  const tms: Array<{ tipoMovimientoId: string; dto: TipoMovimientoSeccionDto }> = []
  for (const tipo of tipos) {
    const filas = await pull<TipoMovimientoSeccionDto>(
      fetcher,
      `${baseUrl}/api/tipos-movimiento/${tipo.id}/secciones${qs(tmsWm)}`,
    )
    for (const dto of filas) {
      tms.push({ tipoMovimientoId: tipo.id, dto })
    }
  }

  // 2. Persistir el batch completo en una sola transacción.
  const persistir = db.transaction((): void => {
    for (const s of secciones) upsertSeccion(db, s)
    for (const c of cerradasPrimero(campos, (c) => c.vigenteHasta)) upsertCampo(db, c)
    for (const t of cerradasPrimero(tms, (x) => x.dto.vigenteHasta)) {
      upsertTipoMovimientoSeccion(db, t.tipoMovimientoId, t.dto)
    }
    db.prepare(
      `INSERT INTO ConfiguracionLocal (Clave, Valor) VALUES ('LastConfigSyncAt', @valor)
       ON CONFLICT(Clave) DO UPDATE SET Valor = excluded.Valor`,
    ).run({ valor: new Date().toISOString() })
  })
  persistir()

  return {
    secciones: secciones.length,
    campos: campos.length,
    tiposMovimientoSeccion: tms.length,
  }
}

/** Wrapper de producción — corre contra la base local real (`getDb()`). */
export function sincronizarConfigLocal(): Promise<ResultadoConfigSync> {
  return sincronizarConfig(getDb())
}

/** Estado del último sync de config para `GET /config/estado` y el indicador de staleness. */
export function obtenerEstadoConfigSync(): { lastConfigSyncAt: string | null } {
  return { lastConfigSyncAt: getConfig('LastConfigSyncAt') ?? null }
}
