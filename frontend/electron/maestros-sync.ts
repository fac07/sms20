import {
  obtenerUltimaSincronizacionMaestros,
  obtenerUltimaSincronizacionVinculos,
  upsertMaestrosYVinculosLocal,
} from './db'
import type { MaestroLocal, VinculoPilotoTransportistaLocal } from './db'

// Mismo origen hardcodeado que ya usan los servicios Angular y
// outbox-dispatcher.ts — sin .env, sin secretos acá.
const CENTRAL_API_URL = 'http://localhost:5094'

// Shape de GET /api/maestros central (MaestroDto, camelCase) — coincide
// campo a campo con MaestroLocal, esto es sobre todo un pase de
// type-narrowing, no una transformación real.
interface MaestroCentralDto {
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

// Shape de GET /api/vinculos-piloto-transportista central
// (VinculoPilotoTransportistaDto, camelCase) — coincide campo a campo con
// VinculoPilotoTransportistaLocal (el mirror local no guarda
// UsuarioCreacion/FechaCreacion: no aportan nada al selector escopado).
interface VinculoPilotoTransportistaDto {
  id: string
  pilotoId: string
  transportistaId: string
  activo: boolean
  fechaModificacion: string
}

/**
 * Descarga el snapshot de Maestro Y del vínculo Piloto-Transportista desde
 * Central en el MISMO pase (diseño D3: "same module, same pass, both upserted
 * in one transaction so the two watermarks can never diverge" — un vínculo es
 * inútil sin los Maestro de Piloto/Transportista que referencia). Cada
 * catálogo tiene su propio watermark independiente
 * (obtenerUltimaSincronizacionMaestros / obtenerUltimaSincronizacionVinculos),
 * pero el upsert final corre en UNA transacción (upsertMaestrosYVinculosLocal,
 * G4): si cualquiera de los dos falla, NINGÚN watermark avanza.
 *
 * Completo la primera vez (sin watermark local todavía), incremental de ahí en
 * adelante usando FechaModificacion como marca de agua (ver
 * GET /api/maestros?modificadoDesde y GET /api/vinculos-piloto-transportista
 * ?modificadoDesde en el backend, que en modo delta ignoran el filtro de
 * activos para que las desactivaciones también lleguen acá).
 *
 * A diferencia de despacharOutboxPendiente, esto es una lectura simple sin
 * nada que marcar como fallido localmente — si cualquiera de las dos
 * requests falla, se deja que el error suba: el caller (el interval de
 * main.ts, o la ruta de disparo manual en local-server.ts) decide qué hacer
 * con eso.
 */
export async function sincronizarMaestros(): Promise<{ descargados: number }> {
  const watermark = obtenerUltimaSincronizacionMaestros()
  const url = `${CENTRAL_API_URL}/api/maestros${watermark ? '?modificadoDesde=' + encodeURIComponent(watermark) : ''}`

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`No se pudo sincronizar Maestros: HTTP ${response.status}`)
  }

  const dtos = (await response.json()) as MaestroCentralDto[]
  const maestros: MaestroLocal[] = dtos.map((m) => ({
    id: m.id,
    tipoCatalogo: m.tipoCatalogo,
    codigo: m.codigo,
    nombre: m.nombre,
    datosAdicionales: m.datosAdicionales,
    estado: m.estado,
    fusionadoConId: m.fusionadoConId,
    fechaModificacion: m.fechaModificacion,
    activo: m.activo,
  }))

  const watermarkVinculos = obtenerUltimaSincronizacionVinculos()
  const urlVinculos =
    `${CENTRAL_API_URL}/api/vinculos-piloto-transportista` +
    (watermarkVinculos ? '?modificadoDesde=' + encodeURIComponent(watermarkVinculos) : '')

  const responseVinculos = await fetch(urlVinculos)
  if (!responseVinculos.ok) {
    throw new Error(`No se pudo sincronizar Vínculos piloto-transportista: HTTP ${responseVinculos.status}`)
  }

  const dtosVinculos = (await responseVinculos.json()) as VinculoPilotoTransportistaDto[]
  const vinculos: VinculoPilotoTransportistaLocal[] = dtosVinculos.map((v) => ({
    id: v.id,
    pilotoId: v.pilotoId,
    transportistaId: v.transportistaId,
    activo: v.activo,
    fechaModificacion: v.fechaModificacion,
  }))

  upsertMaestrosYVinculosLocal(maestros, vinculos)

  return { descargados: maestros.length }
}
