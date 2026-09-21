import { calcularTiempoTranscurridoMs, parsearFechaBoleta } from './tiempo-transcurrido';

// Mismo convenio de zona que `formatearAntiguedad` (preingreso-cola-page): el
// backend emite ISO con `Z`/offset; un ISO sin designador se asume UTC.

describe('parsearFechaBoleta', () => {
  it('parsea ISO con Z', () => {
    expect(parsearFechaBoleta('2026-09-10T12:00:00Z')).toBe(Date.UTC(2026, 8, 10, 12, 0, 0));
  });

  it('un ISO sin designador de zona se asume UTC', () => {
    expect(parsearFechaBoleta('2026-09-10T12:00:00')).toBe(Date.UTC(2026, 8, 10, 12, 0, 0));
  });

  it('null o texto corrupto devuelven null', () => {
    expect(parsearFechaBoleta(null)).toBeNull();
    expect(parsearFechaBoleta('ayer a la tarde')).toBeNull();
  });
});

describe('calcularTiempoTranscurridoMs — (FechaHoraSalida ?? ahora) − FechaHoraIngreso', () => {
  const ahora = new Date(Date.UTC(2026, 8, 10, 15, 31, 49));

  it('boleta cerrada: salida − ingreso', () => {
    const ms = calcularTiempoTranscurridoMs('2026-09-10T12:00:00Z', '2026-09-10T15:31:49Z', ahora);
    expect(ms).toBe(3 * 3_600_000 + 31 * 60_000 + 49_000);
  });

  it('en tránsito (sin salida): ahora − ingreso', () => {
    const ms = calcularTiempoTranscurridoMs('2026-09-10T12:00:00Z', null, ahora);
    expect(ms).toBe(3 * 3_600_000 + 31 * 60_000 + 49_000);
  });

  it('ingreso ausente o corrupto devuelve NaN — el semáforo lo pinta de rojo, no revienta', () => {
    expect(Number.isNaN(calcularTiempoTranscurridoMs(null, null, ahora))).toBe(true);
    expect(Number.isNaN(calcularTiempoTranscurridoMs('no-fecha', '2026-09-10T13:00:00Z', ahora))).toBe(true);
    expect(Number.isNaN(calcularTiempoTranscurridoMs('2026-09-10T12:00:00Z', 'no-fecha', ahora))).toBe(true);
  });
});
