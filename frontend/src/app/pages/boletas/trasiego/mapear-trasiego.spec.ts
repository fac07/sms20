import { CampoAplicable, ValorCampoLeidoDto } from '../../../api/configuracion.models';
import { mapearValoresTrasiego } from './mapear-trasiego';

function valor(
  parcial: Partial<ValorCampoLeidoDto> & Pick<ValorCampoLeidoDto, 'seccionClave' | 'campoClave'>,
): ValorCampoLeidoDto {
  return {
    campoId: `origen.${parcial.seccionClave}.${parcial.campoClave}`,
    seccionNombre: '',
    etiqueta: parcial.campoClave,
    tipoCampo: 'Texto',
    ocurrencia: 0,
    ...parcial,
  };
}

function campo(parcial: Partial<CampoAplicable> & Pick<CampoAplicable, 'campoId' | 'campoClave'>): CampoAplicable {
  return {
    seccionId: 'sec-' + (parcial.seccionClave ?? 'calidad'),
    seccionClave: 'calidad',
    etiqueta: parcial.campoClave,
    tipoCampo: 'Texto',
    tipoCatalogoRef: null,
    requerido: false,
    cardinalidad: 'Unica',
    seccionRequerida: false,
    configuracion: null,
    orden: 0,
    seccionOrden: 0,
    seccionEtiqueta: '',
    ...parcial,
  };
}

describe('mapearValoresTrasiego', () => {
  it('copia un valor cuya (seccionClave, campoClave, tipoCampo) coincide en el destino', () => {
    const origen = [valor({ seccionClave: 'transporte', campoClave: 'placa', valorTexto: 'P-123ABC' })];
    const destino = [
      campo({ campoId: 'dest-placa', seccionClave: 'transporte', campoClave: 'placa', tipoCampo: 'Texto' }),
    ];

    const { valores, requeridosSinValor } = mapearValoresTrasiego(origen, destino);

    expect(valores).toEqual([{ campoId: 'dest-placa', ocurrencia: 0, valorTexto: 'P-123ABC' }]);
    expect(requeridosSinValor).toEqual([]);
  });

  it('descarta un valor del origen sin campo equivalente en el destino', () => {
    const origen = [valor({ seccionClave: 'calidad', campoClave: 'acidez', valorNumero: 3.2 })];
    const destino = [campo({ campoId: 'dest-otro', seccionClave: 'calidad', campoClave: 'humedad' })];

    const { valores } = mapearValoresTrasiego(origen, destino);

    expect(valores).toEqual([]);
  });

  it('no copia cuando el tipo de campo difiere, aunque la clave coincida', () => {
    const origen = [valor({ seccionClave: 'transporte', campoClave: 'orden', valorTexto: 'ABC', tipoCampo: 'Texto' })];
    const destino = [
      campo({ campoId: 'dest-orden', seccionClave: 'transporte', campoClave: 'orden', tipoCampo: 'Entero' }),
    ];

    const { valores } = mapearValoresTrasiego(origen, destino);

    expect(valores).toEqual([]);
  });

  it('copia cada ocurrencia de una sección repetible por separado', () => {
    const origen = [
      valor({ seccionClave: 'marchamos', campoClave: 'numero', ocurrencia: 0, valorTexto: 'M1' }),
      valor({ seccionClave: 'marchamos', campoClave: 'numero', ocurrencia: 1, valorTexto: 'M2' }),
    ];
    const destino = [
      campo({
        campoId: 'dest-marchamo',
        seccionClave: 'marchamos',
        campoClave: 'numero',
        cardinalidad: 'Repetible',
      }),
    ];

    const { valores } = mapearValoresTrasiego(origen, destino);

    expect(valores).toEqual([
      { campoId: 'dest-marchamo', ocurrencia: 0, valorTexto: 'M1' },
      { campoId: 'dest-marchamo', ocurrencia: 1, valorTexto: 'M2' },
    ]);
  });

  it('copia el slot que corresponda según el tipo (numero, fecha, booleano, referencia a maestro)', () => {
    const origen = [
      valor({ seccionClave: 's', campoClave: 'n', valorNumero: 5, tipoCampo: 'Decimal' }),
      valor({ seccionClave: 's', campoClave: 'f', valorFecha: '2026-09-10', tipoCampo: 'Fecha' }),
      valor({ seccionClave: 's', campoClave: 'b', valorBooleano: true, tipoCampo: 'Booleano' }),
      valor({ seccionClave: 's', campoClave: 'm', valorMaestroId: 'maestro-1', tipoCampo: 'ReferenciaMaestro' }),
    ];
    const destino = [
      campo({ campoId: 'd-n', seccionClave: 's', campoClave: 'n', tipoCampo: 'Decimal' }),
      campo({ campoId: 'd-f', seccionClave: 's', campoClave: 'f', tipoCampo: 'Fecha' }),
      campo({ campoId: 'd-b', seccionClave: 's', campoClave: 'b', tipoCampo: 'Booleano' }),
      campo({ campoId: 'd-m', seccionClave: 's', campoClave: 'm', tipoCampo: 'ReferenciaMaestro' }),
    ];

    const { valores } = mapearValoresTrasiego(origen, destino);

    expect(valores).toEqual([
      { campoId: 'd-n', ocurrencia: 0, valorNumero: 5 },
      { campoId: 'd-f', ocurrencia: 0, valorFecha: '2026-09-10' },
      { campoId: 'd-b', ocurrencia: 0, valorBooleano: true },
      { campoId: 'd-m', ocurrencia: 0, valorMaestroId: 'maestro-1' },
    ]);
  });

  it('lista los campos requeridos del destino que quedaron sin ningún valor mapeado', () => {
    const origen = [valor({ seccionClave: 'transporte', campoClave: 'placa', valorTexto: 'P-1' })];
    const destino = [
      campo({ campoId: 'd-placa', seccionClave: 'transporte', campoClave: 'placa', requerido: true }),
      campo({ campoId: 'd-orden', seccionClave: 'transporte', campoClave: 'orden_despacho', requerido: true }),
      campo({ campoId: 'd-obs', seccionClave: 'transporte', campoClave: 'observacion', requerido: false }),
    ];

    const { requeridosSinValor } = mapearValoresTrasiego(origen, destino);

    expect(requeridosSinValor.map((c: CampoAplicable) => c.campoId)).toEqual(['d-orden']);
  });
});
