import { CampoAplicable, ValorCampoDto } from '../../../api/configuracion.models';
import { limitesNumericos, opcionesLista } from '../../pesaje/pesaje-page/secciones';
import { FilaQr, MaestroQr, PayloadQr, ValorQr } from './qr-transferencia';
import { ResolucionMaestroQr } from './resolver-maestro-qr';

/**
 * Mapeo del `s` del QR de transferencia (secciones → filas → campos por
 * CLAVE) a los `valores: ValorCampoDto[]` (keyed por campoId + ocurrencia)
 * del tipo receptor. Las configs son versionadas y el tipo destino tiene otro
 * set de campos: se traslada solo lo común y TODO descarte queda advertido —
 * nunca se inventa un valor. Espejo de la regla de columna de `armar-valores`
 * (Texto/Lista → valorTexto; Entero/Decimal → valorNumero; Fecha/FechaHora →
 * valorFecha ISO; Booleano → valorBooleano; ReferenciaMaestro → valorMaestroId
 * vía el resolver inyectado). Pura: sin Angular, sin HTTP.
 */

export type MotivoAdvertenciaQr =
  | 'campo-sin-destino'
  | 'fila-excedente-unica'
  | 'valor-incompatible'
  | 'maestro-tipo-incompatible';

export interface AdvertenciaQr {
  motivo: MotivoAdvertenciaQr;
  seccionClave: string;
  /** null solo en `fila-excedente-unica`, que es de sección y no de campo. */
  campoClave: string | null;
  /** Ocurrencias donde ocurrió — agrupado: una entrada por (motivo, sección, campo). */
  ocurrencias: number[];
}

export interface ResultadoMapeoQr {
  valores: ValorCampoDto[];
  /** Refs `crearProvisional` (sin duplicar por id) a importar antes de crear la boleta. */
  maestrosAImportar: MaestroQr[];
  advertencias: AdvertenciaQr[];
  /** Campos `requerido` del destino que quedaron sin valor (no llegaron o se descartaron). */
  requeridosSinValor: CampoAplicable[];
}

export type ResolverMaestroRef = (ref: MaestroQr) => ResolucionMaestroQr;

type DescarteQr = 'valor-incompatible' | 'maestro-tipo-incompatible';
type ProyeccionQr = { valor: ValorCampoDto } | { descarte: DescarteQr };

export function mapearQrAValores(
  payload: PayloadQr,
  campos: readonly CampoAplicable[],
  resolver: ResolverMaestroRef,
): ResultadoMapeoQr {
  const valores: ValorCampoDto[] = [];
  const maestrosAImportar: MaestroQr[] = [];
  const importados = new Set<string>();
  const advertencias = new Map<string, AdvertenciaQr>();

  const registrarAdvertencia = (
    motivo: MotivoAdvertenciaQr,
    seccionClave: string,
    campoClave: string | null,
    ocurrencia: number,
  ): void => {
    const clave = `${motivo}|${seccionClave}|${campoClave ?? ''}`;
    let entrada = advertencias.get(clave);
    if (entrada === undefined) {
      entrada = { motivo, seccionClave, campoClave, ocurrencias: [] };
      advertencias.set(clave, entrada);
    }
    if (!entrada.ocurrencias.includes(ocurrencia)) entrada.ocurrencias.push(ocurrencia);
  };

  // Índice de destino por (sección, campo); el primero gana si hay duplicados.
  const destino = new Map<string, CampoAplicable>();
  for (const campo of campos) {
    const clave = `${campo.seccionClave}|${campo.campoClave}`;
    if (!destino.has(clave)) destino.set(clave, campo);
  }
  const cardinalidadPorSeccion = new Map<string, CampoAplicable['cardinalidad']>();
  for (const campo of campos) {
    if (!cardinalidadPorSeccion.has(campo.seccionClave)) {
      cardinalidadPorSeccion.set(campo.seccionClave, campo.cardinalidad);
    }
  }

  for (const [seccionClave, filas] of Object.entries(payload.s)) {
    // Sección Unica en el destino: solo la primera fila tiene a dónde ir.
    const filasUsables =
      cardinalidadPorSeccion.get(seccionClave) === 'Unica' ? filas.slice(0, 1) : filas;
    for (let i = filasUsables.length; i < filas.length; i++) {
      registrarAdvertencia('fila-excedente-unica', seccionClave, null, i);
    }

    filasUsables.forEach((fila, ocurrencia) => {
      for (const [campoClave, valor] of Object.entries(fila)) {
        const campo = destino.get(`${seccionClave}|${campoClave}`);
        if (campo === undefined) {
          registrarAdvertencia('campo-sin-destino', seccionClave, campoClave, ocurrencia);
          continue;
        }
        const proyeccion = proyectarValor(campo, ocurrencia, valor, resolver, maestrosAImportar, importados);
        if ('valor' in proyeccion) valores.push(proyeccion.valor);
        else registrarAdvertencia(proyeccion.descarte, seccionClave, campoClave, ocurrencia);
      }
    });
  }

  return {
    valores,
    maestrosAImportar,
    advertencias: [...advertencias.values()],
    requeridosSinValor: campos.filter(
      (c) => c.requerido && !valores.some((v) => v.campoId === c.campoId),
    ),
  };
}

/** Proyecta un valor del QR a la columna tipada de su campo destino. */
function proyectarValor(
  campo: CampoAplicable,
  ocurrencia: number,
  valor: ValorQr,
  resolver: ResolverMaestroRef,
  maestrosAImportar: MaestroQr[],
  importados: Set<string>,
): ProyeccionQr {
  const base = { campoId: campo.campoId, ocurrencia };

  switch (campo.tipoCampo) {
    case 'Texto':
      return esTexto(valor) ? { valor: { ...base, valorTexto: valor } } : incompatible;

    case 'Lista':
      if (esTexto(valor) && opcionesLista(campo.configuracion).includes(valor)) {
        return { valor: { ...base, valorTexto: valor } };
      }
      return incompatible;

    case 'Entero':
      if (typeof valor === 'number' && Number.isInteger(valor) && dentroDeCotas(valor, campo)) {
        return { valor: { ...base, valorNumero: valor } };
      }
      return incompatible;

    case 'Decimal':
      if (typeof valor === 'number' && Number.isFinite(valor) && dentroDeCotas(valor, campo)) {
        return { valor: { ...base, valorNumero: valor } };
      }
      return incompatible;

    case 'Fecha':
    case 'FechaHora': {
      const iso = aIso(valor);
      return iso === null ? incompatible : { valor: { ...base, valorFecha: iso } };
    }

    case 'Booleano':
      return typeof valor === 'boolean' ? { valor: { ...base, valorBooleano: valor } } : incompatible;

    case 'ReferenciaMaestro':
      return proyectarMaestro(campo, base, valor, resolver, maestrosAImportar, importados);

    default:
      return incompatible;
  }
}

const incompatible: ProyeccionQr = { descarte: 'valor-incompatible' };

/**
 * Un maestro del QR solo es aceptable si su `tipoCatalogo` coincide con el del
 * campo; la identidad se resuelve contra el espejo local con el resolver
 * inyectado (en otra tanda se cablea a SQLite — acá es parámetro para mantener
 * la función pura). `crearProvisional` usa el MISMO id del ref: una fusión
 * futura del emisor redirige sola.
 */
function proyectarMaestro(
  campo: CampoAplicable,
  base: { campoId: string; ocurrencia: number },
  valor: ValorQr,
  resolver: ResolverMaestroRef,
  maestrosAImportar: MaestroQr[],
  importados: Set<string>,
): ProyeccionQr {
  if (!esMaestroQr(valor)) return incompatible;
  if (campo.tipoCatalogoRef === null || valor.tipoCatalogo !== campo.tipoCatalogoRef) {
    return { descarte: 'maestro-tipo-incompatible' };
  }

  const resolucion = resolver(valor);
  if (resolucion.kind === 'crearProvisional') {
    if (!importados.has(resolucion.ref.id)) {
      importados.add(resolucion.ref.id);
      maestrosAImportar.push(resolucion.ref);
    }
    return { valor: { ...base, valorMaestroId: resolucion.ref.id } };
  }
  return { valor: { ...base, valorMaestroId: resolucion.id } };
}

// --- helpers ---------------------------------------------------------------

function esTexto(valor: ValorQr): valor is string {
  return typeof valor === 'string' && valor.trim() !== '';
}

function esMaestroQr(valor: ValorQr): valor is MaestroQr {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return false;
  const v = valor as unknown as Record<string, unknown>;
  return (
    typeof v['id'] === 'string' &&
    typeof v['codigo'] === 'string' &&
    typeof v['nombre'] === 'string' &&
    typeof v['tipoCatalogo'] === 'string' &&
    typeof v['provisional'] === 'boolean'
  );
}

function dentroDeCotas(valor: number, campo: CampoAplicable): boolean {
  const { min, max } = limitesNumericos(campo.configuracion);
  if (min !== undefined && valor < min) return false;
  if (max !== undefined && valor > max) return false;
  return true;
}

/** Solo cadenas ISO parseables — un número o booleano del QR no es una fecha. */
function aIso(valor: ValorQr): string | null {
  if (typeof valor !== 'string') return null;
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString();
}
