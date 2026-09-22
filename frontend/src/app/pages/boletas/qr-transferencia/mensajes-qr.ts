import { AdvertenciaQr, MotivoAdvertenciaQr } from './mapear-qr-a-valores';
import { MotivoErrorQr } from './qr-transferencia';

/** Texto para el operador de cada motivo de rechazo del decoder — pantalla de recepción por QR. */
export const MENSAJE_ERROR_QR: Record<MotivoErrorQr, string> = {
  'demasiado-grande': 'el texto leído es más largo de lo que un QR de transferencia puede traer.',
  'prefijo-invalido': 'no es un QR de transferencia NAT.',
  'version-no-soportada': 'es de una versión de QR más nueva que esta instalación.',
  'formato-invalido': 'el código está corrupto o incompleto.',
  'deflate-invalido': 'el código está corrupto (no se pudo descomprimir).',
  'json-invalido': 'el código está corrupto (el contenido no es válido).',
  'payload-invalido': 'el código no tiene la forma esperada.',
};

const MOTIVO_ADVERTENCIA_QR: Record<MotivoAdvertenciaQr, string> = {
  'campo-sin-destino': 'no existe un campo equivalente en este tipo de movimiento',
  'fila-excedente-unica': 'esta sección solo admite una fila en este tipo de movimiento',
  'valor-incompatible': 'el valor no es válido para este campo',
  'maestro-tipo-incompatible': 'el catálogo del maestro no coincide con este campo',
};

/** Línea legible para el operador: qué campo/sección, qué pasó y en qué fila (1-based). */
export function describirAdvertenciaQr(advertencia: AdvertenciaQr): string {
  const objetivo = advertencia.campoClave
    ? `${advertencia.seccionClave}.${advertencia.campoClave}`
    : advertencia.seccionClave;
  const filas = advertencia.ocurrencias.map((o) => o + 1).join(', ');
  return `${objetivo}: ${MOTIVO_ADVERTENCIA_QR[advertencia.motivo]} (fila ${filas}).`;
}
