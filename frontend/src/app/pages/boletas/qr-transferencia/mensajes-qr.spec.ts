import { AdvertenciaQr } from './mapear-qr-a-valores';
import { MENSAJE_ERROR_QR, describirAdvertenciaQr } from './mensajes-qr';

describe('MENSAJE_ERROR_QR', () => {
  it('tiene un texto para cada motivo de error del decoder', () => {
    const motivos = [
      'demasiado-grande',
      'prefijo-invalido',
      'version-no-soportada',
      'formato-invalido',
      'deflate-invalido',
      'json-invalido',
      'payload-invalido',
    ] as const;
    for (const motivo of motivos) {
      expect(MENSAJE_ERROR_QR[motivo]).toEqual(expect.any(String));
      expect(MENSAJE_ERROR_QR[motivo].length).toBeGreaterThan(0);
    }
  });
});

describe('describirAdvertenciaQr', () => {
  it('nombra la sección y el campo, con la fila en base 1', () => {
    const advertencia: AdvertenciaQr = {
      motivo: 'valor-incompatible',
      seccionClave: 'calidad',
      campoClave: 'acidez',
      ocurrencias: [0, 2],
    };
    expect(describirAdvertenciaQr(advertencia)).toContain('calidad.acidez');
    expect(describirAdvertenciaQr(advertencia)).toContain('1');
    expect(describirAdvertenciaQr(advertencia)).toContain('3');
  });

  it('una advertencia de sección (campoClave null) no repite el punto', () => {
    const advertencia: AdvertenciaQr = {
      motivo: 'fila-excedente-unica',
      seccionClave: 'transporte',
      campoClave: null,
      ocurrencias: [1],
    };
    expect(describirAdvertenciaQr(advertencia)).not.toContain('transporte.');
    expect(describirAdvertenciaQr(advertencia)).toContain('transporte:');
  });
});
