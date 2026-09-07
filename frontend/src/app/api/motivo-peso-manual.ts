// Catálogo de motivos de peso manual (decisión de producto #6 / diseño D2).
// Lista cerrada en código, sin pantalla admin y sin sync — cambiarla es un
// despliegue. Los códigos son los identificadores del enum central
// `MotivoPesoManual` (backend/Domain/Boletas/MotivoPesoManual.cs) y del const
// `MOTIVOS_PESO_MANUAL` de frontend/electron/db.ts, VERBATIM. El servidor local
// los envía en `GET /estado` (`motivosPesoManual`); acá viven las etiquetas en
// español que ve el operador y la consulta.

export type MotivoPesoManual =
  | 'IndicadorSinSenal'
  | 'IndicadorEnReparacion'
  | 'CorteEnergia'
  | 'Otro';

/** Único motivo que exige un detalle libre obligatorio. */
export const MOTIVO_PESO_MANUAL_OTRO: MotivoPesoManual = 'Otro';

export const LABELS_MOTIVO_PESO_MANUAL: Record<MotivoPesoManual, string> = {
  IndicadorSinSenal: 'Indicador sin señal',
  IndicadorEnReparacion: 'Indicador en reparación',
  CorteEnergia: 'Corte de energía',
  Otro: 'Otro',
};

/** Etiqueta en español de un código de motivo; devuelve el código crudo si no está mapeado. */
export function etiquetaMotivoPesoManual(codigo: string | null | undefined): string {
  if (codigo === null || codigo === undefined || codigo === '') return '—';
  return (LABELS_MOTIVO_PESO_MANUAL as Record<string, string>)[codigo] ?? codigo;
}
