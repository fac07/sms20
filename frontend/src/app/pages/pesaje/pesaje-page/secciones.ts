import { CampoAplicable } from '../../../api/configuracion.models';

/** Una sección agrupada del formulario, ya ordenada y con sus campos ordenados por `orden`. */
export interface SeccionRenderizada {
  clave: string;
  titulo: string;
  requerida: boolean;
  cardinalidad: 'Unica' | 'Repetible';
  seccionOrden: number;
  campos: CampoAplicable[];
}

/** `snake_clave` -> "Snake Clave" — fallback del encabezado cuando `seccionEtiqueta` viene vacía. */
export function titulizarClave(clave: string): string {
  return clave
    .split(/[_\s]+/)
    .filter((p) => p.length > 0)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

/** Claves de `Configuracion` JSON case-insensitive, como el motor (`PropertyNameCaseInsensitive`). */
export function leerConfiguracion(configuracion: string | null): Record<string, unknown> {
  if (configuracion === null || configuracion.trim() === '') return {};
  try {
    const crudo = JSON.parse(configuracion) as Record<string, unknown>;
    const norm: Record<string, unknown> = {};
    for (const clave of Object.keys(crudo)) norm[clave.toLowerCase()] = crudo[clave];
    return norm;
  } catch {
    return {};
  }
}

/** Opciones de un campo `Lista` desde su `Configuracion` JSON. */
export function opcionesLista(configuracion: string | null): string[] {
  const valor = leerConfiguracion(configuracion)['opciones'];
  return Array.isArray(valor)
    ? valor.filter((o: unknown): o is string => typeof o === 'string')
    : [];
}

/** Cotas numéricas (`min` / `max`) de un campo `Entero` / `Decimal` desde su `Configuracion`. */
export function limitesNumericos(configuracion: string | null): { min?: number; max?: number } {
  const cfg = leerConfiguracion(configuracion);
  const out: { min?: number; max?: number } = {};
  if (typeof cfg['min'] === 'number') out.min = cfg['min'];
  if (typeof cfg['max'] === 'number') out.max = cfg['max'];
  return out;
}

/**
 * Agrupa `CampoAplicable[]` por sección y ordena de forma determinista:
 * secciones por `seccionOrden` (luego clave), campos por `orden` (luego clave).
 * El encabezado usa `seccionEtiqueta` (`Seccion.Nombre`) y cae a la clave
 * titulizada cuando viene vacía.
 */
export function agruparSecciones(campos: readonly CampoAplicable[]): SeccionRenderizada[] {
  const porClave = new Map<string, SeccionRenderizada>();
  for (const campo of campos) {
    let seccion = porClave.get(campo.seccionClave);
    if (seccion === undefined) {
      seccion = {
        clave: campo.seccionClave,
        titulo:
          campo.seccionEtiqueta.trim() !== ''
            ? campo.seccionEtiqueta
            : titulizarClave(campo.seccionClave),
        requerida: campo.seccionRequerida,
        cardinalidad: campo.cardinalidad,
        seccionOrden: campo.seccionOrden,
        campos: [],
      };
      porClave.set(campo.seccionClave, seccion);
    }
    seccion.campos.push(campo);
  }

  const secciones = [...porClave.values()];
  for (const seccion of secciones) {
    seccion.campos.sort((a, b) => a.orden - b.orden || a.campoClave.localeCompare(b.campoClave));
  }
  secciones.sort((a, b) => a.seccionOrden - b.seccionOrden || a.clave.localeCompare(b.clave));
  return secciones;
}
