import {
  getConfig,
  obtenerUltimaSincronizacionPreIngresos,
  upsertPreIngresosLocal,
  type PreIngresoLocal,
} from './db'

// Mismo origen hardcodeado que maestros-sync.ts / config-sync.ts / outbox-
// dispatcher.ts — sin .env, sin secretos acá.
const CENTRAL_API_URL = 'http://localhost:5094'

// Clave de `ConfiguracionLocal` con el centro de esta báscula, sembrada por
// `POST /aprovisionamiento` y backfilleada por `config-sync.ts` desde
// `GET /api/basculas/{id}`. Sin ella el delta no puede scopear: se saltea en
// silencio (mismo default-deny que el bloque de ingreso manual).
const CLAVE_BASCULA_CENTRO = 'BasculaCentroId'

/**
 * Fetcher inyectable — en producción es el `fetch` global; los specs pasan un
 * doble que sirve un central falso. Acotado a lo que este módulo usa
 * (`ok` / `status` / `json`), así el `fetch` global encaja sin adaptador.
 */
export type Fetcher = (url: string) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<unknown>
}>

// Shape de `GET /api/preingresos` central (`PreIngresoDto`, camelCase) — coincide
// campo a campo con `PreIngresoLocal`, esto es sobre todo type-narrowing.
interface PreIngresoDto {
  id: string
  centroId: string
  pilotoId: string | null
  transportistaId: string | null
  equipoId: string | null
  regionId: string | null
  fincaId: string | null
  numeroEnvio: string
  pesoEnviado: number
  racimos: number | null
  sacos: number | null
  estado: string
  boletaId: string | null
  usuarioCreacion: string
  usuarioCancela: string | null
  motivoCancelacion: string | null
  fechaCreacion: string
  fechaModificacion: string
}

export interface ResultadoPreIngresoSync {
  descargados: number
}

/**
 * Delta-sync central→terminal de la cola de transporte (diseño D5). Pide
 * `GET /api/preingresos?centroId={local}&modificadoDesde={MAX(FechaModificacion) local}`,
 * predicado estrictamente `>`, y hace upsert por `Id`. En modo delta el central
 * IGNORA el filtro de estado, así que `Vinculado` / `Cancelado` también llegan —
 * `upsertPreIngresosLocal` los aplica (y marca las boletas ya enlazadas) dentro
 * de UNA transacción, así el watermark no avanza sin la cancelación-apply.
 *
 * Sin `BasculaCentroId` (báscula no aprovisionada) se saltea en silencio: no
 * pega al central y devuelve `{ descargados: 0 }`. Un HTTP no-2xx sí propaga el
 * error — el caller (interval de main.ts o la ruta de disparo) lo captura.
 */
export async function sincronizarPreIngresos(
  opciones: { fetcher?: Fetcher; baseUrl?: string } = {},
): Promise<ResultadoPreIngresoSync> {
  const fetcher = opciones.fetcher ?? (globalThis.fetch as unknown as Fetcher)
  const baseUrl = opciones.baseUrl ?? CENTRAL_API_URL

  const centroId = getConfig(CLAVE_BASCULA_CENTRO)
  if (!centroId) return { descargados: 0 }

  const watermark = obtenerUltimaSincronizacionPreIngresos()
  const query =
    `?centroId=${encodeURIComponent(centroId)}` +
    (watermark ? `&modificadoDesde=${encodeURIComponent(watermark)}` : '')
  const url = `${baseUrl}/api/preingresos${query}`

  const respuesta = await fetcher(url)
  if (!respuesta.ok) {
    throw new Error(`preingreso-sync: HTTP ${respuesta.status} en ${url}`)
  }

  const dtos = (await respuesta.json()) as PreIngresoDto[]
  const registros: PreIngresoLocal[] = dtos.map((d) => ({
    id: d.id,
    centroId: d.centroId,
    pilotoId: d.pilotoId,
    transportistaId: d.transportistaId,
    equipoId: d.equipoId,
    regionId: d.regionId,
    fincaId: d.fincaId,
    numeroEnvio: d.numeroEnvio,
    pesoEnviado: d.pesoEnviado,
    racimos: d.racimos,
    sacos: d.sacos,
    estado: d.estado,
    boletaId: d.boletaId,
    usuarioCreacion: d.usuarioCreacion,
    usuarioCancela: d.usuarioCancela,
    motivoCancelacion: d.motivoCancelacion,
    fechaCreacion: d.fechaCreacion,
    fechaModificacion: d.fechaModificacion,
  }))

  upsertPreIngresosLocal(registros)

  return { descargados: registros.length }
}

// Corrida en vuelo compartida — los disparos eager (arranque de la app, entrada
// a `/pesaje`) y el tick de 60s coalescen sobre esta única promesa, así nunca
// corren dos syncs a la vez. Guardia copiada de config-sync.ts:351.
let enVuelo: Promise<ResultadoPreIngresoSync> | null = null

/**
 * Wrapper de producción — corre contra la base local real (`getDb()` a través de
 * los helpers de db.ts), con guardia contra un sync ya en curso.
 */
export function sincronizarPreIngresosLocal(): Promise<ResultadoPreIngresoSync> {
  enVuelo ??= sincronizarPreIngresos().finally(() => {
    enVuelo = null
  })
  return enVuelo
}
