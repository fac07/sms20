import {
  getConfig,
  listarOutboxLocal,
  marcarOutboxLocalResultado,
  UMBRAL_ALERTA_TRABADO,
  type OutboxLocalEvento,
} from './db'

// Mismo origen hardcodeado que ya usan los servicios Angular — sin .env, sin
// secretos acá.
const CENTRAL_API_URL = 'http://localhost:5094'

// Tras este número de fallos consecutivos, un evento `Boleta` pasa a Error
// terminal — deja de reintentarse solo, necesita intervención manual (mismo
// espíritu que el Descartado de OutboxD365 en el diseño, aplicado acá porque
// OutboxLocal no tiene ese estado en su enum — solo Pendiente/Enviado/Error).
//
// NO aplica a `MaestroProvisional`: por diseño (M-D2 / spec "Provisional sync
// event never goes terminal") un provisional se reintenta indefinidamente y
// nunca llega a Error.
const MAX_INTENTOS = 10

// Ruta de ingesta central por tipo de entidad del Outbox. `MaestroProvisional`
// estrena endpoint propio en M2; `Boleta` sigue igual que siempre.
const RUTA_INGESTA: Record<OutboxLocalEvento['tipoEntidad'], string> = {
  Boleta: '/api/boletas/sync',
  MaestroProvisional: '/api/maestros/sync',
}

/**
 * Recorre el OutboxLocal pendiente y lo reenvía al backend central en orden
 * estricto de Secuencia, ruteando cada evento por `tipoEntidad`
 * (`Boleta` -> `/api/boletas/sync`, `MaestroProvisional` -> `/api/maestros/sync`).
 *
 * Un solo dispatcher local, secuencial — así se respeta el orden por Secuencia
 * sin necesitar el WHERE NOT EXISTS del diseño, que hace falta solo si hay
 * despacho concurrente, algo que no existe acá.
 *
 * Park dependency-aware (M-D2): un 4xx sobre un `MaestroProvisional` NO corta el
 * ciclo. El evento queda `Pendiente` (nunca `Error`), su `entidadId` entra a un
 * set `bloqueados` de este ciclo, y el dispatch sigue — salteando cualquier
 * evento posterior cuyo `entidadId` o cuyo `payload.valores[].valorMaestroId`
 * esté bloqueado (un salteo no cuenta como intento). Así un provisional trabado
 * frena solo a las boletas que lo referencian; el resto de la cola sigue
 * fluyendo. Transporte, 5xx y 4xx-en-`Boleta` mantienen el `break` histórico.
 */
export async function despacharOutboxPendiente(): Promise<{ enviados: number; fallidos: number }> {
  // Sin BasculaCodigo no hay con quién identificarse ante Central — no tiene
  // sentido despachar nada todavía. Mismo hueco que el resto de la app,
  // pendiente del /aprovisionamiento real.
  const basculaCodigo = getConfig('BasculaCodigo')
  if (!basculaCodigo) {
    return { enviados: 0, fallidos: 0 }
  }

  const pendientes = listarOutboxLocal('Pendiente')

  let enviados = 0
  let fallidos = 0

  // `entidadId` de los maestros provisionales cuya ingesta fue rechazada con un
  // 4xx en este ciclo. Solo vive mientras dura este recorrido.
  const bloqueados = new Set<string>()

  for (const evento of pendientes) {
    // Salteo dependency-aware: el evento ES un provisional bloqueado, o
    // REFERENCIA uno (por entidadId directo o por un valorMaestroId de su
    // payload). Se deja intacto — un salteo no bumpea Intentos.
    if (dependeDeBloqueado(evento, bloqueados)) {
      continue
    }

    try {
      const response = await fetch(`${CENTRAL_API_URL}${RUTA_INGESTA[evento.tipoEntidad]}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          basculaCodigo,
          operacion: evento.operacion,
          payload: JSON.parse(evento.payload),
        }),
      })

      if (response.ok) {
        marcarOutboxLocalResultado(evento.id, { estado: 'Enviado' })
        enviados++
        continue
      }

      // Best-effort: el cuerpo del error puede no ser JSON, no vale la pena
      // que eso tumbe el dispatcher.
      let mensaje = `HTTP ${response.status}`
      try {
        const cuerpo = await response.text()
        if (cuerpo) mensaje = `HTTP ${response.status}: ${cuerpo}`
      } catch {
        /* nos quedamos con el mensaje de arriba */
      }

      const es4xx = response.status >= 400 && response.status < 500

      if (es4xx && evento.tipoEntidad === 'MaestroProvisional') {
        // Park: el POST del provisional falló con 4xx. Cuenta como intento
        // (Intentos + 1, puede cruzar el umbral de alerta de M4b) pero NUNCA
        // pasa a Error. El dispatch NO se corta: se bloquea esta entidad y se
        // sigue con el resto de la cola.
        marcarOutboxLocalResultado(evento.id, { estado: 'Pendiente', ultimoError: mensaje })
        bloqueados.add(evento.entidadId)
        fallidos++
        // Heartbeat best-effort al panel central si este intento cruzó el
        // umbral de alerta. Nunca corta el dispatch ni bumpea nada.
        await reportarIncidenciaSync(basculaCodigo, evento, evento.intentos + 1, mensaje)
        continue
      }

      // 4xx en una `Boleta`, o 5xx en cualquier tipo: se mantiene el `break`
      // histórico (un `Crear` rechazado no puede dejar pasar su `Cerrar`; un
      // 5xx significa que Central no va a aceptar nada más este ciclo).
      marcarOutboxLocalResultado(evento.id, {
        estado: estadoTrasFallo(evento),
        ultimoError: mensaje,
      })
      fallidos++
      break
    } catch (err) {
      // El fetch en sí tiró (red caída, Central inalcanzable) — mismo
      // tratamiento que una respuesta no-ok de transporte, sin dejar que la
      // excepción se escape de acá.
      marcarOutboxLocalResultado(evento.id, {
        estado: estadoTrasFallo(evento),
        ultimoError: (err as Error).message,
      })
      fallidos++
      break
    }
  }

  return { enviados, fallidos }
}

/**
 * Estado tras un intento fallido que corta el ciclo. Un `MaestroProvisional`
 * nunca va a `Error` (se reintenta indefinidamente); una `Boleta` pasa a `Error`
 * al alcanzar `MAX_INTENTOS`.
 */
function estadoTrasFallo(evento: OutboxLocalEvento): 'Pendiente' | 'Error' {
  if (evento.tipoEntidad === 'MaestroProvisional') return 'Pendiente'
  return evento.intentos + 1 >= MAX_INTENTOS ? 'Error' : 'Pendiente'
}

/**
 * Heartbeat best-effort a `POST /api/maestros/incidencias-sync` cuando un
 * provisional cruza `UMBRAL_ALERTA_TRABADO` intentos fallidos. Nunca lanza ni
 * bloquea el dispatch — si el POST falla, el próximo ciclo lo reintenta (el
 * store central tiene TTL, así que re-reportar es lo correcto). `tipoCatalogo` y
 * `nombre` salen del payload del propio evento.
 */
async function reportarIncidenciaSync(
  basculaCodigo: string,
  evento: OutboxLocalEvento,
  intentos: number,
  ultimoError: string,
): Promise<void> {
  if (intentos < UMBRAL_ALERTA_TRABADO) return

  let tipoCatalogo: string | null = null
  let nombre: string | null = null
  try {
    const p = JSON.parse(evento.payload) as { tipoCatalogo?: string; nombre?: string }
    tipoCatalogo = p.tipoCatalogo ?? null
    nombre = p.nombre ?? null
  } catch {
    /* payload no parseable -> se reporta sin esos campos */
  }

  try {
    await fetch(`${CENTRAL_API_URL}/api/maestros/incidencias-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        basculaCodigo,
        entidadId: evento.entidadId,
        tipoCatalogo,
        nombre,
        intentos,
        ultimoError,
      }),
    })
  } catch {
    /* best-effort: un fallo del heartbeat nunca compromete el dispatch */
  }
}

/**
 * `true` si el evento no debe despacharse porque depende de un provisional
 * bloqueado este ciclo: o su propia `entidadId` está bloqueada, o alguno de los
 * `valores[].valorMaestroId` de su payload lo está.
 */
function dependeDeBloqueado(evento: OutboxLocalEvento, bloqueados: Set<string>): boolean {
  if (bloqueados.size === 0) return false
  if (bloqueados.has(evento.entidadId)) return true

  try {
    const payload = JSON.parse(evento.payload) as {
      valores?: Array<{ valorMaestroId?: string | null }>
    }
    if (Array.isArray(payload.valores)) {
      return payload.valores.some(
        (v) => typeof v?.valorMaestroId === 'string' && bloqueados.has(v.valorMaestroId),
      )
    }
  } catch {
    /* payload no parseable -> no podemos afirmar dependencia, se despacha */
  }
  return false
}
