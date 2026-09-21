import { MaestroQr } from './qr-transferencia';

/** Lo mínimo que el resolver necesita de una fila del espejo local de Maestro. */
export interface MaestroLocalQr {
  id: string;
  codigo: string;
  tipoCatalogo: string;
  fusionadoConId?: string | null;
}

export type ResolucionMaestroQr =
  | { kind: 'existente'; id: string }
  | { kind: 'fusionado'; id: string }
  | { kind: 'porCodigo'; id: string }
  /** No está localmente: el receptor crea un provisional con el MISMO id (así una fusión futura redirige). */
  | { kind: 'crearProvisional'; ref: MaestroQr };

/**
 * Resuelve un maestro del QR contra el espejo local del receptor. Pura: las
 * búsquedas se inyectan (2b las cablea a SQLite).
 *
 * 1. Por id, siguiendo `FusionadoConId` (con guarda de ciclos). Una cadena
 *    rota o cíclica no aporta id confiable y sigue al paso 2.
 * 2. Por (codigo, tipoCatalogo) — solo si el ref es OFICIAL: los códigos de
 *    provisionales se generan por báscula y pueden colisionar con otro maestro.
 * 3. Crear provisional con el mismo id.
 */
export function resolverMaestroDeQr(
  ref: MaestroQr,
  buscarPorId: (id: string) => MaestroLocalQr | null | undefined,
  buscarPorCodigo: (codigo: string, tipoCatalogo: string) => MaestroLocalQr | null | undefined,
): ResolucionMaestroQr {
  const local = buscarPorId(ref.id);
  if (local) {
    const vigente = seguirFusion(local, buscarPorId);
    if (vigente) return { kind: vigente === local.id ? 'existente' : 'fusionado', id: vigente };
  }

  if (!ref.provisional && ref.codigo && ref.tipoCatalogo) {
    const porCodigo = buscarPorCodigo(ref.codigo, ref.tipoCatalogo);
    if (porCodigo) {
      const vigente = seguirFusion(porCodigo, buscarPorId);
      if (vigente) return { kind: 'porCodigo', id: vigente };
    }
  }

  return { kind: 'crearProvisional', ref };
}

/** Id del maestro vigente tras seguir la cadena de fusión; null si hay ciclo o un eslabón falta. */
function seguirFusion(
  inicio: MaestroLocalQr,
  buscarPorId: (id: string) => MaestroLocalQr | null | undefined,
): string | null {
  const visitados = new Set<string>();
  let actual = inicio;
  while (actual.fusionadoConId) {
    if (visitados.has(actual.id)) return null;
    visitados.add(actual.id);
    const siguiente = buscarPorId(actual.fusionadoConId);
    if (!siguiente) return null;
    actual = siguiente;
  }
  return actual.id;
}
