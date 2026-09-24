import { CampoAplicable, ValorCampoDto, ValorCampoLeidoDto } from '../../../api/configuracion.models';

/**
 * Espejo, del lado del cliente, del auto-mapeo que hace el backend en
 * `/trasegar` cuando el request no trae `Valores` explícitos
 * (`MapearValoresPorClaveAsync` en BoletaEndpoints.cs): para cada valor
 * capturado en la boleta ORIGEN se busca un campo en el DESTINO con la MISMA
 * terna (seccionClave, campoClave, tipoCampo); sin match, el valor se
 * descarta (el destino puede pedir MENOS campos que el origen). Sirve para
 * la vista previa del diálogo de trasiego — la autoridad real sigue siendo
 * el 422 que devuelve el backend si falta un campo requerido sin llenar.
 */
export interface ResultadoMapeoTrasiego {
  valores: ValorCampoDto[];
  /** Campos `requerido` del destino sin NINGÚN valor mapeado — aviso, no bloqueo. */
  requeridosSinValor: CampoAplicable[];
}

export function mapearValoresTrasiego(
  origenValores: readonly ValorCampoLeidoDto[],
  destinoCampos: readonly CampoAplicable[],
): ResultadoMapeoTrasiego {
  // Colisión de terna en el destino (dos campos con la misma sección+clave+tipo,
  // no debería pasar): se toma el primero, como en el backend.
  const destinoPorClave = new Map<string, string>();
  for (const c of destinoCampos) {
    const clave = `${c.seccionClave}\u0000${c.campoClave}\u0000${c.tipoCampo}`;
    if (!destinoPorClave.has(clave)) destinoPorClave.set(clave, c.campoId);
  }

  const valores: ValorCampoDto[] = [];
  for (const v of origenValores) {
    const clave = `${v.seccionClave}\u0000${v.campoClave}\u0000${v.tipoCampo}`;
    const campoDestinoId = destinoPorClave.get(clave);
    if (campoDestinoId === undefined) continue;

    const proyectado = proyectarSlot(campoDestinoId, v);
    if (proyectado !== null) valores.push(proyectado);
  }

  const requeridosSinValor = destinoCampos.filter(
    (c) => c.requerido && !valores.some((v) => v.campoId === c.campoId),
  );

  return { valores, requeridosSinValor };
}

/** Traslada al destino SOLO el slot que el valor origen tiene poblado. */
function proyectarSlot(campoId: string, v: ValorCampoLeidoDto): ValorCampoDto | null {
  const base = { campoId, ocurrencia: v.ocurrencia };
  if (v.valorTexto != null) return { ...base, valorTexto: v.valorTexto };
  if (v.valorNumero != null) return { ...base, valorNumero: v.valorNumero };
  if (v.valorFecha != null) return { ...base, valorFecha: v.valorFecha };
  if (v.valorBooleano != null) return { ...base, valorBooleano: v.valorBooleano };
  if (v.valorMaestroId != null) return { ...base, valorMaestroId: v.valorMaestroId };
  return null;
}
