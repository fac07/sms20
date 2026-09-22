import { Observable, firstValueFrom, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { MaestroQr } from './qr-transferencia';
import { MaestroLocalQr } from './resolver-maestro-qr';

/**
 * Precarga en caché las búsquedas que `resolverMaestroDeQr` exige como
 * funciones SÍNCRONAS: por id (siguiendo toda la cadena de fusión, porque el
 * resolver la recorre contra este mismo caché) y — solo para refs OFICIALES no
 * hallados por id — por (tipoCatalogo, codigo). Un error de red de UNA consulta
 * cuenta como "no encontrado" y no aborta la precarga. Así el `resolver` que se
 * le pasa a `mapearQrAValores` puede ser puro/síncrono sobre datos ya bajados
 * del espejo local.
 */

/** Estrecha el contrato a lo que exponen los métodos de `LocalServerService` (Parte B). */
export interface ApiMaestrosQr {
  maestroPorId(id: string): Observable<MaestroLocalQr | null>;
  maestroPorCodigo(tipoCatalogo: string, codigo: string): Observable<MaestroLocalQr | null>;
}

export interface BuscadoresMaestrosQr {
  buscarPorId(id: string): MaestroLocalQr | null;
  /** Mismo orden de args que espera `resolverMaestroDeQr`: (codigo, tipoCatalogo). */
  buscarPorCodigo(codigo: string, tipoCatalogo: string): MaestroLocalQr | null;
}

/** Eslabones que se siguen tras el hallazgo inicial; corta cadenas corruptas o cíclicas. */
const PROFUNDIDAD_FUSION = 5;

export async function precargarMaestros(
  refs: readonly MaestroQr[],
  api: ApiMaestrosQr,
): Promise<BuscadoresMaestrosQr> {
  const porId = new Map<string, MaestroLocalQr>();
  const porCodigo = new Map<string, MaestroLocalQr>();
  const claveCodigo = (tipo: string, codigo: string): string => `${tipo}|${codigo}`;

  const consultar = async <T>(obs: Observable<T | null>): Promise<T | null> => {
    try {
      return await firstValueFrom(obs.pipe(catchError(() => of(null))));
    } catch {
      return null;
    }
  };

  const traerPorId = async (id: string): Promise<MaestroLocalQr | null> => {
    const fila = await consultar(api.maestroPorId(id));
    if (fila) porId.set(fila.id, fila);
    return fila;
  };

  // Dedup por id: dos filas del QR que apuntan al mismo maestro se consultan una vez.
  const objetivos = new Map<string, MaestroQr>();
  for (const ref of refs) if (!objetivos.has(ref.id)) objetivos.set(ref.id, ref);

  await Promise.all(
    [...objetivos.values()].map(async (ref) => {
      let vigente = await traerPorId(ref.id);

      if (vigente === null && !ref.provisional && ref.codigo !== '' && ref.tipoCatalogo !== '') {
        const hallado = await consultar(api.maestroPorCodigo(ref.tipoCatalogo, ref.codigo));
        if (hallado) {
          porCodigo.set(claveCodigo(ref.tipoCatalogo, ref.codigo), hallado);
          porId.set(hallado.id, hallado);
          vigente = hallado;
        }
      }

      // Seguir la cadena de fusión: cada eslabón queda cacheado para que el
      // resolver la recorra sin más HTTP. `porId.has` corta ciclos.
      let paso = vigente;
      for (let profundidad = 0; paso?.fusionadoConId && profundidad < PROFUNDIDAD_FUSION; profundidad++) {
        if (porId.has(paso.fusionadoConId)) break;
        paso = await traerPorId(paso.fusionadoConId);
        if (paso === null) break;
      }
    }),
  );

  return {
    buscarPorId: (id) => porId.get(id) ?? null,
    buscarPorCodigo: (codigo, tipo) => porCodigo.get(claveCodigo(tipo, codigo)) ?? null,
  };
}
