import { getConfig, listarOutboxLocal, marcarOutboxLocalResultado } from './db'

// Mismo origen hardcodeado que ya usan los servicios Angular — sin .env, sin
// secretos acá.
const CENTRAL_API_URL = 'http://localhost:5094'

// Tras este número de fallos consecutivos, el evento pasa a Error terminal —
// deja de reintentarse solo, necesita intervención manual (mismo espíritu
// que el Descartado de OutboxD365 en el diseño, aplicado acá porque
// OutboxLocal no tiene ese estado en su enum — solo Pendiente/Enviado/Error).
const MAX_INTENTOS = 10

/**
 * Recorre el OutboxLocal pendiente y lo reenvía al backend central
 * (POST /api/boletas/sync), en orden estricto de Secuencia.
 *
 * Un solo dispatcher local, secuencial — así se respeta el orden por
 * Secuencia sin necesitar el WHERE NOT EXISTS del diseño, que hace falta
 * solo si hay despacho concurrente, algo que no existe acá.
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
      const response = await fetch(`${CENTRAL_API_URL}/api/boletas/sync`, {
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
        estado: evento.intentos + 1 >= MAX_INTENTOS ? 'Error' : 'Pendiente',
        ultimoError: mensaje,
      })
      fallidos++
      // Si un evento falla, los siguientes de la MISMA boleta seguro
      // dependen de él — y aunque sean de otra boleta, cortar acá es la
      // forma simple y segura de no mandar eventos fuera de orden si el
      // fallo fue algo como "Central está caído"; se reintenta todo en el
      // próximo ciclo.
      break
    } catch (err) {
      // El fetch en sí tiró (red caída, Central inalcanzable) — mismo
      // tratamiento que una respuesta no-ok, sin dejar que la excepción
      // se escape de acá.
      marcarOutboxLocalResultado(evento.id, {
        estado: evento.intentos + 1 >= MAX_INTENTOS ? 'Error' : 'Pendiente',
        ultimoError: (err as Error).message,
      })
      fallidos++
      break
    }
  }

  return { enviados, fallidos }
}
