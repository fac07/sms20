/**
 * Semáforo de tiempo transcurrido (manual del sistema): verde <= 16 h,
 * amarillo > 16 h y <= 24 h, rojo > 24 h. Funciones puras — las consumen el
 * componente `app-semaforo-tiempo`, la tabla de BoletasPage y la página de
 * Unidades en Tránsito con la misma semántica.
 */

export type ColorSemaforo = 'verde' | 'amarillo' | 'rojo';

export interface UmbralesSemaforo {
  /** Tope inclusivo del verde, en horas. */
  verde: number;
  /** Tope inclusivo del amarillo, en horas; por encima es rojo. */
  amarillo: number;
}

/** Umbrales del manual SMS: verde hasta 16 h, amarillo hasta 24 h. */
export const UMBRALES_BOLETA: Readonly<UmbralesSemaforo> = { verde: 16, amarillo: 24 };

const MINUTO_MS = 60_000;
const HORA_MS = 60 * MINUTO_MS;
const DIA_MS = 24 * HORA_MS;

/**
 * Clasifica una duración en horas contra los umbrales. Los bordes son
 * inclusivos por debajo: 16 h exactas son verde, 24 h exactas son amarillo.
 *
 * Falla-visible: `NaN`, ±Infinity o negativo no revientan ni se esconden en
 * verde — una duración imposible de medir (reloj de báscula corrido, fecha
 * corrupta) se pinta ROJO para que la anomalía se note en pantalla.
 */
export function clasificarTiempo(
  horas: number,
  umbrales: UmbralesSemaforo = UMBRALES_BOLETA,
): ColorSemaforo {
  if (!Number.isFinite(horas) || horas < 0) return 'rojo';
  if (horas <= umbrales.verde) return 'verde';
  if (horas <= umbrales.amarillo) return 'amarillo';
  return 'rojo';
}

/**
 * `d.hh:mm:ss` — el formato del manual (ej. `1.03:13:49` = 1 día, 3 h).
 * Trunca al segundo (nunca redondea). Entrada inválida (NaN/±Infinity) o
 * negativa se imprime como `0.00:00:00`: no revienta, no muestra `NaN`.
 */
export function formatearDuracion(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : 0;
  const dias = Math.floor(total / DIA_MS);
  const resto = total % DIA_MS;
  const horas = Math.floor(resto / HORA_MS);
  const minutos = Math.floor((resto % HORA_MS) / MINUTO_MS);
  const segundos = Math.floor((resto % MINUTO_MS) / 1_000);
  return `${dias}.${pad2(horas)}:${pad2(minutos)}:${pad2(segundos)}`;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');
