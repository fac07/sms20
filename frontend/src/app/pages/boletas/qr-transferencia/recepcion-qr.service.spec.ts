import { of } from 'rxjs';
import { RecepcionQrService } from './recepcion-qr.service';
import { EfectosRecepcionQr } from './procesar-recepcion-qr';

describe('RecepcionQrService', () => {
  it('delega en procesarRecepcionQr con los mismos argumentos y devuelve su resultado', async () => {
    const efectos: EfectosRecepcionQr = {
      clave: null,
      boletaRecibidaDe: () => of({ recibida: false }),
      maestros: {
        maestroPorId: () => of(null),
        maestroPorCodigo: () => of(null),
      },
      importarMaestroProvisional: () => of({}),
    };

    const servicio = new RecepcionQrService();
    const resultado = await servicio.procesar('un-texto-que-no-decodifica', [], efectos);

    // Sin mockear el codec interno: alcanza con confirmar que delega de
    // verdad (motivo de error real del decoder) en vez de devolver un stub.
    expect(resultado).toEqual({ fase: 'error', motivo: 'prefijo-invalido' });
  });
});
