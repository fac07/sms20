import { obtenerUltimaSincronizacionMaestros, upsertMaestrosLocal } from './db'
import type { MaestroLocal } from './db'

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

/**
 * Descarga el snapshot de Maestro desde Central — completo la primera vez
 * (sin watermark local todavía), incremental de ahí en adelante usando
 * FechaModificacion como marca de agua (ver GET /api/maestros?modificadoDesde
 * en el backend, que además ignora incluirInactivos en modo delta para que
 * las desactivaciones también lleguen acá).
 *
 * A diferencia de despacharOutboxPendiente, esto es una lectura simple sin
 * nada que marcar como fallido localmente — si la request falla, se deja
 * que el error suba: el caller (el interval de main.ts, o la ruta de
 * disparo manual en local-server.ts) decide qué hacer con eso.
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

  upsertMaestrosLocal(maestros)

  return { descargados: maestros.length }
}
