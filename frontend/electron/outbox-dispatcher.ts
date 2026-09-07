import {
  getConfig,
  listarOutboxLocal,
  marcarOutboxLocalResultado,
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

  for (const evento of pendientes) {
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

      marcarOutboxLocalResultado(evento.id, {
        estado: estadoTrasFallo(evento),
        ultimoError: mensaje,
      })
      fallidos++
      // Si un evento falla, los siguientes de la MISMA boleta seguro dependen
      // de él — y aunque sean de otra boleta, cortar acá es la forma simple y
      // segura de no mandar eventos fuera de orden si el fallo fue algo como
      // "Central está caído"; se reintenta todo en el próximo ciclo.
      break
    } catch (err) {
      // El fetch en sí tiró (red caída, Central inalcanzable) — mismo
      // tratamiento que una respuesta no-ok, sin dejar que la excepción se
      // escape de acá.
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
 * Estado tras un intento fallido. Un `MaestroProvisional` nunca va a `Error`
 * (se reintenta indefinidamente); una `Boleta` pasa a `Error` al alcanzar
 * `MAX_INTENTOS`.
 */
function estadoTrasFallo(evento: OutboxLocalEvento): 'Pendiente' | 'Error' {
  if (evento.tipoEntidad === 'MaestroProvisional') return 'Pendiente'
  return evento.intentos + 1 >= MAX_INTENTOS ? 'Error' : 'Pendiente'
}
