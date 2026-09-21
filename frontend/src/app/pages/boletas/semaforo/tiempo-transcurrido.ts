/**
 * Duración de una boleta según el manual: (FechaHoraSalida ?? ahora) −
 * FechaHoraIngreso. Funciones puras separadas del componente para poder
 * testealas sin TestBed.
 */

/**
 * ISO del backend → epoch-ms. Con designador (`Z`/offset) se respeta; sin él
 * se asume UTC — mismo convenio que `formatearAntiguedad` (preingreso-cola).
 * `null`/texto inválido → `null` (nunca NaN suelto).
 */
export function parsearFechaBoleta(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const normalizada = /(?:Z|[+-]\d{2}:\d{2})$/i.test(iso) ? iso : `${iso}Z`;
  const ms = new Date(normalizada).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Milisegundos transcurridos entre ingreso y salida (o `ahora` si la boleta
 * sigue en tránsito). Si alguna fecha falta o es ilegible devuelve `NaN`:
 * el semáforo trata lo no medible como rojo (falla-visible), y
 * `formatearDuracion` lo imprime como `0.00:00:00`.
 */
export function calcularTiempoTranscurridoMs(
  fechaHoraIngreso: string | null | undefined,
  fechaHoraSalida: string | null | undefined,
  ahora: Date = new Date(),
): number {
  const inicio = parsearFechaBoleta(fechaHoraIngreso);
  if (inicio === null) return Number.NaN;

  let fin: number;
  if (fechaHoraSalida) {
    const salida = parsearFechaBoleta(fechaHoraSalida);
    if (salida === null) return Number.NaN;
    fin = salida;
  } else {
    fin = ahora.getTime();
  }
  return fin - inicio;
}
