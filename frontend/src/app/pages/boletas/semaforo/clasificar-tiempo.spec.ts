import { clasificarTiempo, formatearDuracion } from './clasificar-tiempo';

// Contrato (falla-visible, nunca verde silencioso ante datos imposibles):
// - verde: horas <= umbral.verde (16 h por defecto)
// - amarillo: > umbral.verde y <= umbral.amarillo (24 h por defecto)
// - rojo: > umbral.amarillo. NaN, ±Infinity o negativo se consideran
//   imposibles de medir y caen a ROJO (anomalía de datos a la vista del
//   operador, ej. reloj de báscula corrido), no a verde.
// - formatearDuracion nunca revienta: los mismos casos inválidos se imprimen
//   como '0.00:00:00' y se truncán al segundo (nunca redondea hacia arriba).

const HORA_MS = 3_600_000;
const MIN_MS = 60_000;
const SEG_MS = 1_000;

describe('clasificarTiempo — umbrales del manual (verde <= 16 h, amarillo <= 24 h, rojo > 24 h)', () => {
  it('exactamente 16 h es verde (<= inclusivo)', () => {
    expect(clasificarTiempo(16)).toBe('verde');
  });

  it('16 h + 1 s es amarillo', () => {
    expect(clasificarTiempo(16 + SEG_MS / HORA_MS)).toBe('amarillo');
  });

  it('exactamente 24 h es amarillo (<= inclusivo)', () => {
    expect(clasificarTiempo(24)).toBe('amarillo');
  });

  it('24 h + 1 s es rojo', () => {
    expect(clasificarTiempo(24 + SEG_MS / HORA_MS)).toBe('rojo');
  });

  it('cero es verde', () => {
    expect(clasificarTiempo(0)).toBe('verde');
  });

  it('acepta umbrales custom sin mutar los defaults', () => {
    expect(clasificarTiempo(1.5, { verde: 1, amarillo: 2 })).toBe('amarillo');
    // Con los defaults (16/24) sin mutar, 2 h sigue siendo verde.
    expect(clasificarTiempo(2)).toBe('verde');
    expect(clasificarTiempo(1)).toBe('verde');
    expect(clasificarTiempo(2.5, { verde: 1, amarillo: 2 })).toBe('rojo');
  });

  it('no revienta con duraciones imposibles: negativo, NaN o Infinity dan rojo', () => {
    expect(clasificarTiempo(-0.5)).toBe('rojo');
    expect(clasificarTiempo(Number.NaN)).toBe('rojo');
    expect(clasificarTiempo(Number.POSITIVE_INFINITY)).toBe('rojo');
    expect(clasificarTiempo(Number.NEGATIVE_INFINITY)).toBe('rojo');
  });
});

describe('formatearDuracion — formato d.hh:mm:ss del manual', () => {
  it('3 h 31 min 49 s → 0.03:31:49 (ejemplo real del manual, verde)', () => {
    expect(formatearDuracion(3 * HORA_MS + 31 * MIN_MS + 49 * SEG_MS)).toBe('0.03:31:49');
  });

  it('16 h 31 min 49 s → 0.16:31:49 (ejemplo real del manual, amarillo)', () => {
    expect(formatearDuracion(16 * HORA_MS + 31 * MIN_MS + 49 * SEG_MS)).toBe('0.16:31:49');
  });

  it('27 h 13 min 49 s → 1.03:13:49 (ejemplo real del manual, día desbordado y hora de 2 dígitos)', () => {
    expect(formatearDuracion(27 * HORA_MS + 13 * MIN_MS + 49 * SEG_MS)).toBe('1.03:13:49');
  });

  it('cero → 0.00:00:00', () => {
    expect(formatearDuracion(0)).toBe('0.00:00:00');
  });

  it('menos de 1 hora deja las horas en 00', () => {
    expect(formatearDuracion(45 * MIN_MS + 30 * SEG_MS)).toBe('0.00:45:30');
  });

  it('días de 2 dígitos sin separador extra', () => {
    // 99 h = 4 días y 3 h
    expect(formatearDuracion(99 * HORA_MS)).toBe('4.03:00:00');
    expect(formatearDuracion(24 * HORA_MS)).toBe('1.00:00:00');
  });

  it('sub-segundos truncan, nunca redondean hacia arriba', () => {
    expect(formatearDuracion(2 * SEG_MS + 999)).toBe('0.00:00:02');
  });

  it('no revienta con entradas inválidas: negativo, NaN o Infinity se imprimen como 0.00:00:00', () => {
    expect(formatearDuracion(-5 * HORA_MS)).toBe('0.00:00:00');
    expect(formatearDuracion(Number.NaN)).toBe('0.00:00:00');
    expect(formatearDuracion(Number.POSITIVE_INFINITY)).toBe('0.00:00:00');
  });
});
