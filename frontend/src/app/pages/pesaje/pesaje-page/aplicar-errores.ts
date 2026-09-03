import { AbstractControl, FormArray, FormGroup } from '@angular/forms';
import { CampoAplicable, ErrorCampo } from '../../../api/configuracion.models';
import { SeccionRenderizada } from './secciones';

/**
 * `campoClave` que el motor (`validarValores` / `validarCierre`, C# y el port TS)
 * usa para los errores a nivel de sección — reglas 1 (sección requerida sin
 * ocurrencias) y 3 (Única con ocurrencia > 0) del cierre.
 */
export const CLAVE_SECCION = '(seccion)';

/** Clave del mapa de controles: `${seccionClave}|${campoClave}|${ocurrencia}`. */
export function claveControl(seccionClave: string, campoClave: string, ocurrencia: number): string {
  return `${seccionClave}|${campoClave}|${ocurrencia}`;
}

/** Una línea del resumen de errores que se muestra arriba del formulario. */
export interface LineaResumen {
  seccionClave: string;
  campoClave: string;
  ocurrencia: number;
  texto: string;
}

/** Resultado de aplicar un `ErrorCampo[]` del servidor sobre el formulario. */
export interface ErroresAplicados {
  /** Un item por error, formateado para el `nz-alert` de resumen. */
  resumen: LineaResumen[];
  /** `seccionClave -> mensajes` para los `nz-alert` por sección. */
  porSeccion: Record<string, string[]>;
}

/**
 * Construye el mapa `${seccionClave}|${campoClave}|${ocurrencia}` -> control a
 * partir de las secciones renderizadas y el `FormGroup` dinámico vigente.
 *
 * - Campo normal -> el `FormControl` de ese `campoId` dentro de la ocurrencia.
 * - Sección (`campoClave = "(seccion)"`):
 *   - `Repetible`: la ocurrencia N -> su `FormGroup`; ocurrencia 0 cae al
 *     `FormArray` completo cuando todavía no hay ninguna fila (regla 1).
 *   - `Unica`: siempre el `FormGroup` de la ocurrencia 0.
 */
export function construirMapaControles(
  secciones: readonly SeccionRenderizada[],
  form: FormGroup,
): Map<string, AbstractControl> {
  const mapa = new Map<string, AbstractControl>();

  for (const seccion of secciones) {
    const nodo = form.get(seccion.clave);
    if (nodo === null) continue;

    if (nodo instanceof FormArray) {
      // Ocurrencia 0 apunta al array mientras esté vacío (regla 1 emite occ 0).
      mapa.set(claveControl(seccion.clave, CLAVE_SECCION, 0), nodo);
      nodo.controls.forEach((grupo, indice) => {
        mapa.set(claveControl(seccion.clave, CLAVE_SECCION, indice), grupo);
        for (const campo of seccion.campos) {
          const ctrl = grupo.get(campo.campoId);
          if (ctrl !== null && ctrl !== undefined) {
            mapa.set(claveControl(seccion.clave, campo.campoClave, indice), ctrl);
          }
        }
      });
    } else if (nodo instanceof FormGroup) {
      mapa.set(claveControl(seccion.clave, CLAVE_SECCION, 0), nodo);
      for (const campo of seccion.campos) {
        const ctrl = nodo.get(campo.campoId);
        if (ctrl !== null && ctrl !== undefined) {
          mapa.set(claveControl(seccion.clave, campo.campoClave, 0), ctrl);
        }
      }
    }
  }

  return mapa;
}

/**
 * Limpia el error `servidor` de todos los controles del mapa, conservando el
 * resto de errores (p. ej. `required`). Se llama antes de cada envío y tras un
 * éxito para que los flags del intento anterior no queden pegados.
 */
export function limpiarErroresServidor(mapa: Map<string, AbstractControl>): void {
  const vistos = new Set<AbstractControl>();
  for (const ctrl of mapa.values()) {
    if (vistos.has(ctrl)) continue;
    vistos.add(ctrl);
    const errores = ctrl.errors;
    if (errores === null || !('servidor' in errores)) continue;
    const { servidor: _descartado, ...resto } = errores;
    ctrl.setErrors(Object.keys(resto).length > 0 ? resto : null);
  }
}

/**
 * Aplica un `ErrorCampo[]` (400 de crear / 422 de cerrar) sobre el formulario:
 * marca cada control con `{ servidor: mensaje }` (mezclado con sus errores
 * previos), arma la lista de alertas por sección para los errores `(seccion)` y
 * devuelve el resumen para el `nz-alert` de arriba. Función sin dependencias de
 * Angular DI — se testea con `FormControl`/`FormGroup` sueltos.
 */
export function aplicarErrores(
  errores: readonly ErrorCampo[],
  mapa: Map<string, AbstractControl>,
  campos: readonly CampoAplicable[],
): ErroresAplicados {
  const etiquetaPorClave = new Map<string, string>();
  for (const campo of campos) {
    etiquetaPorClave.set(`${campo.seccionClave}|${campo.campoClave}`, campo.etiqueta);
  }

  const resumen: LineaResumen[] = [];
  const porSeccion: Record<string, string[]> = {};

  for (const error of errores) {
    const esSeccion = error.campoClave === CLAVE_SECCION;
    const ctrl = mapa.get(claveControl(error.seccionClave, error.campoClave, error.ocurrencia));

    if (ctrl !== undefined) {
      ctrl.setErrors({ ...(ctrl.errors ?? {}), servidor: error.mensaje });
      ctrl.markAsTouched();
    }

    if (esSeccion) {
      (porSeccion[error.seccionClave] ??= []).push(error.mensaje);
      resumen.push({
        seccionClave: error.seccionClave,
        campoClave: error.campoClave,
        ocurrencia: error.ocurrencia,
        texto: `${error.seccionClave}: ${error.mensaje}`,
      });
    } else {
      const etiqueta =
        etiquetaPorClave.get(`${error.seccionClave}|${error.campoClave}`) ?? error.campoClave;
      resumen.push({
        seccionClave: error.seccionClave,
        campoClave: error.campoClave,
        ocurrencia: error.ocurrencia,
        texto: `${etiqueta} (ocurrencia ${error.ocurrencia + 1}): ${error.mensaje}`,
      });
    }
  }

  return { resumen, porSeccion };
}
