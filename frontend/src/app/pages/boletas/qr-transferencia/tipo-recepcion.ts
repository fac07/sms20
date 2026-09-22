import { TipoMovimiento } from '../../../api/configuracion.models';

/**
 * Un tipo de movimiento es una RECEPCIÓN de transferencia NAT cuando el
 * backend lo marca con `operacionD365 = 'TransferenciaRecepcion'` — la pata
 * receptora del flujo cuyo QR emite la báscula de origen
 * ('TransferenciaCreacion'). Los tipos inactivos no se ofrecen en pantalla.
 */
export function esRecepcionTransferencia(tipo: TipoMovimiento): boolean {
  return tipo.operacionD365 === 'TransferenciaRecepcion' && tipo.activo;
}
