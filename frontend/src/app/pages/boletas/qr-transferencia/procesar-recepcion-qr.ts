import { Observable, firstValueFrom, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { CampoAplicable, ValorCampoDto } from '../../../api/configuracion.models';
import { ApiMaestrosQr, precargarMaestros } from './precargar-maestros';
import { AdvertenciaQr, mapearQrAValores } from './mapear-qr-a-valores';
import {
  FirmaQr,
  MaestroQr,
  MotivoErrorQr,
  PayloadQr,
  ValorQr,
  decodificarQrTransferencia,
} from './qr-transferencia';
import { resolverMaestroDeQr } from './resolver-maestro-qr';

/**
 * Orquesta la recepción de una transferencia NAT por QR: decodificar, aplicar
 * la política de firma, chequear duplicado, resolver/importar maestros y
 * mapear los valores al formulario del tipo receptor. Pura salvo por los
 * efectos inyectados (Observable, mismo estilo que `precargarMaestros`) — el
 * llamador real (D2, dentro de `PesajePage`) los cablea a `LocalServerService`;
 * los tests los stubean sin `TestBed`.
 *
 * El peso NO viaja acá: la recepción es un pesaje nuevo en la báscula
 * receptora, el peso del QR es solo referencia para mostrar en pantalla.
 */

/** Mismo shape que `RecepcionQrEstado` de `LocalServerService` — declarado acá para no acoplar este módulo puro a la capa HTTP. */
export interface RecepcionQrEstado {
  recibida: boolean;
  boletaId?: string;
  numeroBoleta?: string;
}

export interface EfectosRecepcionQr {
  /** Clave HMAC del terminal (null = sin clave configurada; el QR sale/entra sin firmar). */
  clave: string | null;
  boletaRecibidaDe(origenId: string): Observable<RecepcionQrEstado>;
  maestros: ApiMaestrosQr;
  importarMaestroProvisional(input: {
    id: string;
    tipoCatalogo: string;
    nombre: string;
  }): Observable<unknown>;
}

/** Un maestro que el QR pedía importar como provisional y cuya importación falló — sus valores se descartan. */
export interface MaestroNoImportadoQr {
  id: string;
  nombre: string;
}

export interface DatosRecepcionQr {
  /** Pasa a `CrearBoletaInput.boletaOrigenId` tal cual. */
  boletaOrigenId: string;
  /** Solo para mostrar en pantalla — nunca se envían como valores del formulario. */
  referencia: {
    numeroBoleta: string;
    centroCodigo: string | null;
    fechaHoraSalida: string | null;
    pesoNeto: number | null;
  };
  /** 'invalida' nunca llega acá — ese caso corta antes con `fase: 'firma-invalida'`. */
  firma: FirmaQr;
  parcial: boolean;
  valores: ValorCampoDto[];
  advertencias: AdvertenciaQr[];
  requeridosSinValor: CampoAplicable[];
  maestrosNoImportados: MaestroNoImportadoQr[];
}

export type ResultadoRecepcionQr =
  | { fase: 'error'; motivo: MotivoErrorQr }
  | { fase: 'firma-invalida'; numeroBoleta: string }
  | { fase: 'duplicado'; boletaId: string; numeroBoleta: string }
  | { fase: 'lista'; datos: DatosRecepcionQr };

export async function procesarRecepcionQr(
  textoEscaneado: string,
  campos: readonly CampoAplicable[],
  efectos: EfectosRecepcionQr,
): Promise<ResultadoRecepcionQr> {
  const decodificado = await decodificarQrTransferencia(textoEscaneado, efectos.clave);
  if (!decodificado.ok) return { fase: 'error', motivo: decodificado.motivo };

  const { payload, firma, parcial } = decodificado;
  if (firma === 'invalida') return { fase: 'firma-invalida', numeroBoleta: payload.n };

  const estado = await consultarOpcional(efectos.boletaRecibidaDe(payload.b));
  if (estado?.recibida) {
    return {
      fase: 'duplicado',
      boletaId: estado.boletaId ?? '',
      numeroBoleta: estado.numeroBoleta ?? '',
    };
  }

  const refs = extraerMaestrosQr(payload);
  const buscadores = await precargarMaestros(refs, efectos.maestros);
  const mapeo = mapearQrAValores(payload, campos, (ref) =>
    resolverMaestroDeQr(ref, buscadores.buscarPorId, buscadores.buscarPorCodigo),
  );

  const maestrosNoImportados: MaestroNoImportadoQr[] = [];
  for (const ref of mapeo.maestrosAImportar) {
    const importado = await intentar(
      efectos.importarMaestroProvisional({ id: ref.id, tipoCatalogo: ref.tipoCatalogo, nombre: ref.nombre }),
    );
    if (!importado) maestrosNoImportados.push({ id: ref.id, nombre: ref.nombre });
  }

  const idsFallidos = new Set(maestrosNoImportados.map((m) => m.id));
  const valores =
    idsFallidos.size === 0
      ? mapeo.valores
      : mapeo.valores.filter((v) => v.valorMaestroId == null || !idsFallidos.has(v.valorMaestroId));
  const requeridosSinValor =
    idsFallidos.size === 0
      ? mapeo.requeridosSinValor
      : campos.filter((c) => c.requerido && !valores.some((v) => v.campoId === c.campoId));

  return {
    fase: 'lista',
    datos: {
      boletaOrigenId: payload.b,
      referencia: {
        numeroBoleta: payload.n,
        centroCodigo: payload.ce,
        fechaHoraSalida: payload.fs,
        pesoNeto: payload.pn,
      },
      firma,
      parcial,
      valores,
      advertencias: mapeo.advertencias,
      requeridosSinValor,
      maestrosNoImportados,
    },
  };
}

/** Todas las referencias a maestro dentro de `payload.s`, sin duplicar por id. */
function extraerMaestrosQr(payload: PayloadQr): MaestroQr[] {
  const vistos = new Set<string>();
  const refs: MaestroQr[] = [];
  for (const filas of Object.values(payload.s)) {
    for (const fila of filas) {
      for (const valor of Object.values(fila)) {
        if (esMaestroQr(valor) && !vistos.has(valor.id)) {
          vistos.add(valor.id);
          refs.push(valor);
        }
      }
    }
  }
  return refs;
}

function esMaestroQr(valor: ValorQr): valor is MaestroQr {
  return typeof valor === 'object' && valor !== null && 'tipoCatalogo' in valor;
}

const FALLO: unique symbol = Symbol('fallo-red');

/**
 * Igual criterio que `precargarMaestros`: un error de red de UN efecto no
 * aborta el flujo completo — cuenta como "no disponible" y el llamador decide.
 */
async function consultarOpcional<T>(obs: Observable<T>): Promise<T | undefined> {
  const resultado = await firstValueFrom(obs.pipe(catchError(() => of<typeof FALLO>(FALLO))));
  return resultado === FALLO ? undefined : resultado;
}

/** true si el efecto (sin valor de interés — importar) tuvo éxito; false ante cualquier error. */
async function intentar(obs: Observable<unknown>): Promise<boolean> {
  return (await consultarOpcional(obs)) !== undefined;
}
