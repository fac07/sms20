import { BoletaDto } from '../../../api/boletas.service';
import { ValorCampoLeidoDto } from '../../../api/configuracion.models';
import { agruparValores } from '../boletas-page/valores-agrupados';
import { FilaQr, PayloadQr, ValorQr } from './qr-transferencia';

export interface OpcionesPayloadQr {
  /** Código del centro de origen; la boleta solo trae el de la báscula. */
  centroCodigo?: string | null;
}

/** Arma el payload del QR de transferencia desde el DTO de la boleta (central o espejo local). */
export function construirPayloadQr(boleta: BoletaDto, opciones: OpcionesPayloadQr = {}): PayloadQr {
  const s: Record<string, FilaQr[]> = {};
  for (const seccion of agruparValores(boleta.valores)) {
    const filas = seccion.ocurrencias
      .map((o) => filaDe(o.valores))
      .filter((fila) => Object.keys(fila).length > 0);
    if (filas.length > 0) s[seccion.clave] = filas;
  }

  return {
    v: 1,
    b: boleta.id,
    n: boleta.numeroBoleta,
    ce: opciones.centroCodigo ?? null,
    ba: boleta.basculaCodigo,
    tm: boleta.tipoMovimientoId,
    tn: boleta.tipoMovimientoNombre,
    fi: isoUtc(boleta.fechaHoraIngreso),
    fs: boleta.fechaHoraSalida ? isoUtc(boleta.fechaHoraSalida) : null,
    pi: boleta.pesoIngreso,
    ps: boleta.pesoSalida,
    pn: boleta.pesoNeto,
    d: boleta.respuestaD365Id,
    s,
  };
}

function filaDe(valores: readonly ValorCampoLeidoDto[]): FilaQr {
  const fila: FilaQr = {};
  for (const v of valores) {
    const valor = valorQr(v);
    if (valor !== null) fila[v.campoClave] = valor;
  }
  return fila;
}

function valorQr(v: ValorCampoLeidoDto): ValorQr | null {
  if (v.valorMaestroId != null) {
    return {
      id: v.valorMaestroId,
      codigo: v.valorMaestroCodigo ?? '',
      nombre: v.valorMaestroNombre ?? '',
      tipoCatalogo: v.valorMaestroTipoCatalogo ?? '',
      provisional: v.valorMaestroProvisional ?? false,
    };
  }
  if (v.valorTexto != null && v.valorTexto !== '') return v.valorTexto;
  if (v.valorNumero != null) return v.valorNumero;
  if (v.valorFecha != null && v.valorFecha !== '') return v.valorFecha;
  if (v.valorBooleano != null) return v.valorBooleano;
  return null;
}

function isoUtc(fecha: string): string {
  const d = new Date(fecha);
  return Number.isNaN(d.getTime()) ? fecha : d.toISOString();
}
