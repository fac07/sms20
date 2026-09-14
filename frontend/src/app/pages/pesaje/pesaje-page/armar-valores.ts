import { CampoAplicable, ValorCampoDto } from '../../../api/configuracion.models';

/**
 * Un control del renderer listo para volcarse a `valores`: el campo aplicable
 * que lo originó, su ocurrencia (0 en slice C1, índice de fila en C2) y el
 * valor crudo tal como lo dejó el control reactivo.
 */
export interface ControlCapturado {
  campo: CampoAplicable;
  ocurrencia: number;
  valor: unknown;
}

function esTextoNoVacio(valor: unknown): valor is string {
  return typeof valor === 'string' && valor.trim() !== '';
}

function esNumeroFinito(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isFinite(valor);
}

/** Normaliza `Date` | ISO string a ISO-8601; `null` si no hay fecha capturada. */
function aIsoFecha(valor: unknown): string | null {
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) return valor.toISOString();
  if (esTextoNoVacio(valor)) return valor;
  return null;
}

/**
 * Proyecta un control capturado al único slot tipado que le corresponde a su
 * `TipoCampo`. Devuelve `null` cuando el control está vacío (opcional sin
 * completar) para que el llamador lo omita del arreglo `valores`.
 *
 * Espejo del contrato de `MotorCampos`/`normalizarValores` del servidor local:
 * cada entrada lleva exactamente un `valor*` no nulo — 0 o >1 son rechazados.
 */
function slotTipado(campo: CampoAplicable, ocurrencia: number, valor: unknown): ValorCampoDto | null {
  const base = { campoId: campo.campoId, ocurrencia };

  switch (campo.tipoCampo) {
    case 'Texto':
    case 'Lista':
      return esTextoNoVacio(valor) ? { ...base, valorTexto: valor } : null;

    case 'Entero':
    case 'Decimal':
      return esNumeroFinito(valor) ? { ...base, valorNumero: valor } : null;

    case 'Fecha':
    case 'FechaHora': {
      const iso = aIsoFecha(valor);
      return iso === null ? null : { ...base, valorFecha: iso };
    }

    case 'Booleano':
      // `false` es una respuesta válida ("no"); solo se omite cuando el
      // control nunca se tocó (null/undefined).
      return typeof valor === 'boolean' ? { ...base, valorBooleano: valor } : null;

    case 'ReferenciaMaestro':
      return esTextoNoVacio(valor) ? { ...base, valorMaestroId: valor } : null;

    default:
      return null;
  }
}

/**
 * Arma el arreglo `valores: ValorCampoDto[]` que va en `POST /boletas`: una
 * entrada por control no vacío, keyed por `campoId` + `ocurrencia`, con el slot
 * tipado que le toca a su `TipoCampo`. Los controles opcionales vacíos se
 * omiten. Función pura — no toca el DOM ni el formulario, se testea sin TestBed.
 */
export function armarValores(capturados: readonly ControlCapturado[]): ValorCampoDto[] {
  const valores: ValorCampoDto[] = [];
  for (const { campo, ocurrencia, valor } of capturados) {
    const dto = slotTipado(campo, ocurrencia, valor);
    if (dto !== null) valores.push(dto);
  }
  return valores;
}

/**
 * Subconjunto de `PreIngresoLocal` (local-server.service.ts) que el prefill
 * necesita — declarado acá en vez de importado para no acoplar este módulo
 * puro al shape completo del pre-ingreso ni al servicio HTTP.
 */
export interface PreIngresoPrefillData {
  pilotoId: string | null;
  transportistaId: string | null;
  equipoId: string | null;
  regionId: string | null;
  fincaId: string | null;
}

/**
 * `campoClave` (sección estándar `transporte`/`detalle_fruta`, ver
 * `RESERVED_CLAVES` en configuracion.models.ts) -> clave del pre-ingreso que
 * lo prefillea. `region` no tiene una clave reservada declarada todavía pero
 * el diseño (#175) lo incluye igual entre los 5 campos prefilleables.
 */
const CLAVE_A_CAMPO_PREINGRESO: Record<string, keyof PreIngresoPrefillData> = {
  piloto: 'pilotoId',
  transportista: 'transportistaId',
  equipo: 'equipoId',
  region: 'regionId',
  finca: 'fincaId',
};

/**
 * Arma el mapa `campoId -> valor` para prefillear piloto/transportista/
 * equipo/región/finca desde el pre-ingreso seleccionado en el selector de
 * Pesaje. Solo incluye campos aplicables cuya `campoClave` coincide con una
 * de las 5 claves del pre-ingreso, y solo cuando ese valor no es null. Pura:
 * el llamador decide cómo volcar el mapa a los FormControls — deben quedar
 * EDITABLES, nunca disabled (diseño: "la observación del operador gana sobre
 * la declaración de logística").
 */
export function valoresPrefillPreIngreso(
  campos: readonly CampoAplicable[],
  preIngreso: PreIngresoPrefillData,
): Record<string, string> {
  const valores: Record<string, string> = {};
  for (const campo of campos) {
    const clave = CLAVE_A_CAMPO_PREINGRESO[campo.campoClave];
    if (clave === undefined) continue;
    const valor = preIngreso[clave];
    if (valor !== null) valores[campo.campoId] = valor;
  }
  return valores;
}
