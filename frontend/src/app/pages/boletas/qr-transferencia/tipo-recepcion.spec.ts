import { TipoMovimiento } from '../../../api/configuracion.models';
import { esRecepcionTransferencia } from './tipo-recepcion';

function tipo(parcial: Partial<TipoMovimiento> = {}): TipoMovimiento {
  return {
    id: 'tm-1',
    codigo: 'TRR',
    nombre: 'Recepción transferencia NAT',
    prefijo: 'RT',
    direccion: 'Entrada',
    operacionD365: 'TransferenciaRecepcion',
    generaQR: false,
    formatoBoletaId: null,
    activo: true,
    ...parcial,
  };
}

describe('esRecepcionTransferencia', () => {
  it('true solo para operacionD365 TransferenciaRecepcion activo', () => {
    expect(esRecepcionTransferencia(tipo())).toBe(true);
  });

  it('false si es TransferenciaCreacion (la otra pata de la transferencia)', () => {
    expect(esRecepcionTransferencia(tipo({ operacionD365: 'TransferenciaCreacion' }))).toBe(false);
  });

  it('false para cualquier otra operación o sin operación D365', () => {
    expect(esRecepcionTransferencia(tipo({ operacionD365: 'IngresoFruta' }))).toBe(false);
    expect(esRecepcionTransferencia(tipo({ operacionD365: null }))).toBe(false);
  });

  it('false si el tipo está inactivo (aunque la operación sea la correcta)', () => {
    expect(esRecepcionTransferencia(tipo({ activo: false }))).toBe(false);
  });
});
