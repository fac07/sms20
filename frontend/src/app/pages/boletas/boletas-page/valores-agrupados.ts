import { ValorCampoLeidoDto } from '../../../api/configuracion.models';
import { titulizarClave } from '../../pesaje/pesaje-page/secciones';

/**
 * Una ocurrencia (sub-fila) de una sección: su índice y los valores capturados
 * en ella. Espeja el modelo `ocurrencia` del motor (`BoletaValorCampo.Ocurrencia`).
 */
export interface OcurrenciaValores {
  ocurrencia: number;
  valores: ValorCampoLeidoDto[];
}

/** Una sección del detalle de boleta con sus ocurrencias como sub-filas. */
export interface SeccionValores {
  clave: string;
  titulo: string;
  repetible: boolean;
  ocurrencias: OcurrenciaValores[];
}

/**
 * Agrupa `BoletaDto.valores` por `seccionClave` y, dentro de cada sección, por
 * `ocurrencia`. Preserva el orden que ya impone el backend
 * (`ORDER BY Seccion.Orden, Campo.Orden, Ocurrencia` en `BoletaEndpoints`),
 * así que no re-ordena: solo pliega la lista plana en secciones -> ocurrencias.
 *
 * Una sección se marca `repetible` cuando tiene más de una ocurrencia o alguna
 * ocurrencia > 0, para que la vista dibuje sub-filas diferenciadas por ocurrencia.
 * El encabezado usa la clave titulizada (`ValorCampoLeidoDto` no trae
 * `Seccion.Nombre`; el formulario del renderer sí, vía `CampoAplicable`).
 */
export function agruparValores(
  valores: readonly ValorCampoLeidoDto[],
): SeccionValores[] {
  const secciones = new Map<string, SeccionValores>();
  const ocurrenciasPorSeccion = new Map<string, Map<number, OcurrenciaValores>>();

  for (const valor of valores) {
    let seccion = secciones.get(valor.seccionClave);
    if (seccion === undefined) {
      seccion = {
        clave: valor.seccionClave,
        titulo: titulizarClave(valor.seccionClave),
        repetible: false,
        ocurrencias: [],
      };
      secciones.set(valor.seccionClave, seccion);
      ocurrenciasPorSeccion.set(valor.seccionClave, new Map());
    }

    const ocurrencias = ocurrenciasPorSeccion.get(valor.seccionClave)!;
    let ocurrencia = ocurrencias.get(valor.ocurrencia);
    if (ocurrencia === undefined) {
      ocurrencia = { ocurrencia: valor.ocurrencia, valores: [] };
      ocurrencias.set(valor.ocurrencia, ocurrencia);
      seccion.ocurrencias.push(ocurrencia);
    }
    ocurrencia.valores.push(valor);

    if (valor.ocurrencia > 0 || ocurrencias.size > 1) seccion.repetible = true;
  }

  return [...secciones.values()];
}
