// Sin .env: no hay secretos acá, y el puerto de dev del backend central es
// estable (launchSettings.json, perfil "http"). En producción esto va a
// venir de la config de la báscula post-aprovisionamiento, no de un build-time env.
const CENTRAL_API_URL = 'http://localhost:5094'

export type DireccionMovimiento = 'Entrada' | 'Salida' | 'Transferencia'

export interface TipoMovimiento {
  id: string
  codigo: string
  nombre: string
  direccion: DireccionMovimiento
  habilitaCalidad: boolean
  habilitaMarchamos: boolean
  habilitaQR: boolean
  habilitaDatosFinca: boolean
  habilitaDetalleFruta: boolean
  habilitaCompostera: boolean
  integracionD365: boolean
  formatoBoletaId: string | null
  activo: boolean
}

export type GuardarTipoMovimientoInput = Omit<TipoMovimiento, 'id' | 'activo'>

async function parseOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const detalle = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}${detalle ? ` — ${detalle}` : ''}`)
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

export function listarTiposMovimiento(incluirInactivos = false): Promise<TipoMovimiento[]> {
  return fetch(
    `${CENTRAL_API_URL}/api/tipos-movimiento?incluirInactivos=${incluirInactivos}`,
  ).then((r) => parseOrThrow<TipoMovimiento[]>(r))
}

export function crearTipoMovimiento(input: GuardarTipoMovimientoInput): Promise<TipoMovimiento> {
  return fetch(`${CENTRAL_API_URL}/api/tipos-movimiento`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).then((r) => parseOrThrow<TipoMovimiento>(r))
}

export function actualizarTipoMovimiento(
  id: string,
  input: GuardarTipoMovimientoInput,
): Promise<TipoMovimiento> {
  return fetch(`${CENTRAL_API_URL}/api/tipos-movimiento/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).then((r) => parseOrThrow<TipoMovimiento>(r))
}

export function desactivarTipoMovimiento(id: string): Promise<void> {
  return fetch(`${CENTRAL_API_URL}/api/tipos-movimiento/${id}`, { method: 'DELETE' }).then((r) =>
    parseOrThrow<void>(r),
  )
}
