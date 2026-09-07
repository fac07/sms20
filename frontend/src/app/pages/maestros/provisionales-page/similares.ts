import { EstadoMaestro, Maestro } from '../../../api/maestros.service';

/**
 * Normaliza un nombre para comparar: sin acentos, minúsculas, espacios
 * colapsados. Deliberadamente simple — la pista solo tiene que empujar al admin
 * a revisar, no decidir la fusión.
 */
export function normalizarNombre(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

export interface PistaSimilar {
  nombre: string;
  estado: EstadoMaestro;
}

/**
 * Devuelve el primer maestro del mismo TipoCatalogo con un nombre parecido al
 * objetivo (igualdad normalizada o inclusión en cualquier sentido), o null.
 * Product decision 8: avisar para fusionar en vez de doble-aprobar.
 */
export function buscarSimilar(objetivo: Maestro, universo: Maestro[]): PistaSimilar | null {
  const base = normalizarNombre(objetivo.nombre);
  if (base.length < 3) return null;

  for (const otro of universo) {
    if (otro.id === objetivo.id) continue;
    if (otro.tipoCatalogo !== objetivo.tipoCatalogo) continue;

    const candidato = normalizarNombre(otro.nombre);
    if (candidato.length < 3) continue;

    if (base === candidato || base.includes(candidato) || candidato.includes(base)) {
      return { nombre: otro.nombre, estado: otro.estado };
    }
  }
  return null;
}

/**
 * Deriva el código de báscula de origen de un código provisional
 * `PROV-{codigoBascula}-{secuencial}`. Cae a "—" si el patrón no calza.
 */
export function basculaDeCodigoProvisional(codigo: string): string {
  const match = /^PROV-(.+)-\d+$/.exec(codigo);
  return match ? match[1] : '—';
}
