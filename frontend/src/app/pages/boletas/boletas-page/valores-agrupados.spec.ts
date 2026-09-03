import { ValorCampoLeidoDto } from '../../../api/configuracion.models';
import { agruparValores } from './valores-agrupados';

function valor(
  parcial: Partial<ValorCampoLeidoDto> &
    Pick<ValorCampoLeidoDto, 'campoId' | 'seccionClave' | 'campoClave'>,
): ValorCampoLeidoDto {
  return {
    etiqueta: parcial.campoClave,
    tipoCampo: 'Texto',
    ocurrencia: 0,
    valorTexto: 'x',
    ...parcial,
  };
}

describe('agruparValores', () => {
  it('agrupa por seccionClave preservando el orden de llegada', () => {
    const secciones = agruparValores([
      valor({ campoId: 'a', seccionClave: 'transporte', campoClave: 'placa' }),
      valor({ campoId: 'b', seccionClave: 'transporte', campoClave: 'piloto' }),
      valor({ campoId: 'c', seccionClave: 'calidad', campoClave: 'acidez' }),
    ]);

    expect(secciones.map((s) => s.clave)).toEqual(['transporte', 'calidad']);
    expect(secciones[0].ocurrencias[0].valores.map((v) => v.campoClave)).toEqual([
      'placa',
      'piloto',
    ]);
  });

  it('tituliza la clave de sección para el encabezado', () => {
    const [seccion] = agruparValores([
      valor({ campoId: 'a', seccionClave: 'detalle_fruta', campoClave: 'finca' }),
    ]);
    expect(seccion.titulo).toBe('Detalle Fruta');
  });

  it('sección Unica (una sola ocurrencia 0) no se marca repetible', () => {
    const [seccion] = agruparValores([
      valor({ campoId: 'a', seccionClave: 'calidad', campoClave: 'acidez', ocurrencia: 0 }),
      valor({ campoId: 'b', seccionClave: 'calidad', campoClave: 'luz', ocurrencia: 0 }),
    ]);
    expect(seccion.repetible).toBe(false);
    expect(seccion.ocurrencias).toHaveLength(1);
  });

  it('separa las ocurrencias repetibles en sub-filas distintas', () => {
    const [seccion] = agruparValores([
      valor({ campoId: 'a', seccionClave: 'producto', campoClave: 'articulo', ocurrencia: 0 }),
      valor({ campoId: 'b', seccionClave: 'producto', campoClave: 'articulo', ocurrencia: 1 }),
      valor({ campoId: 'c', seccionClave: 'producto', campoClave: 'cantidad', ocurrencia: 1 }),
    ]);

    expect(seccion.repetible).toBe(true);
    expect(seccion.ocurrencias.map((o) => o.ocurrencia)).toEqual([0, 1]);
    expect(seccion.ocurrencias[1].valores.map((v) => v.campoClave)).toEqual([
      'articulo',
      'cantidad',
    ]);
  });

  it('marca repetible cuando la única ocurrencia presente es > 0', () => {
    const [seccion] = agruparValores([
      valor({ campoId: 'a', seccionClave: 'marchamos', campoClave: 'numero', ocurrencia: 2 }),
    ]);
    expect(seccion.repetible).toBe(true);
    expect(seccion.ocurrencias[0].ocurrencia).toBe(2);
  });

  it('lista vacía -> sin secciones', () => {
    expect(agruparValores([])).toEqual([]);
  });
});
