/**
 * Tolerancia de divergencia entre el peso declarado en el pre-ingreso
 * (`PesoEnviado`) y el peso neto real de la boleta al cerrarla. Por debajo de
 * este umbral la diferencia se trata como ruido normal de báscula/carga
 * (merma, redondeo) y no amerita interrumpir al operador; por encima, el
 * requisito (spec `preingreso-link`, "Weight tolerance warning is
 * non-blocking") exige mostrar un aviso NO bloqueante — el cierre sigue
 * permitido en ambos casos. Valor arbitrario documentado hasta que producto
 * defina un umbral oficial.
 */
export const TOLERANCIA_DIVERGENCIA_PESO_KG = 50;

/**
 * ¿El peso neto de cierre diverge del peso declarado en el pre-ingreso más
 * allá de la tolerancia? Función pura — no toca formularios ni HTTP, así que
 * se testea sin TestBed. Nunca decide si se puede cerrar: eso lo sigue
 * resolviendo `puedeCerrar()` sin conocer este resultado.
 */
export function hayDivergenciaPeso(pesoEnviado: number, pesoNeto: number): boolean {
  return Math.abs(pesoNeto - pesoEnviado) > TOLERANCIA_DIVERGENCIA_PESO_KG;
}
