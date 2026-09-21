import { BoletaDto } from '../../../api/boletas.service';
import { ValorCampoLeidoDto } from '../../../api/configuracion.models';
import { construirPayloadQr } from './payload-qr';

function boleta(parcial: Partial<BoletaDto> = {}): BoletaDto {
  return {
    id: 'b-1',
    numeroBoleta: 'IF-B01-000001',
    basculaCodigo: 'B01',
    tipoMovimientoId: 'tm-1',
    tipoMovimientoNombre: 'Transferencia salida',
    pesoIngreso: 20000,
    pesoSalida: 3000,
    pesoNeto: 17000,
    fechaHoraIngreso: '2026-09-10T12:00:00Z',
    fechaHoraSalida: '2026-09-10T13:00:00Z',
    respuestaD365Id: null,
    valores: [],
    ...parcial,
  } as BoletaDto;
}

function valor(
  parcial: Partial<ValorCampoLeidoDto> & Pick<ValorCampoLeidoDto, 'seccionClave' | 'campoClave'>,
): ValorCampoLeidoDto {
  return {
    campoId: `${parcial.seccionClave}.${parcial.campoClave}.${parcial.ocurrencia ?? 0}`,
    seccionNombre: '',
    etiqueta: parcial.campoClave,
    tipoCampo: 'Texto',
    ocurrencia: 0,
    ...parcial,
  } as ValorCampoLeidoDto;
}

describe('construirPayloadQr', () => {
  it('mapea los campos fijos; d365Id es opcional (D365 es async)', () => {
    const p = construirPayloadQr(boleta(), { centroCodigo: 'PL1' });
    expect(p).toEqual({
      v: 1,
      b: 'b-1',
      n: 'IF-B01-000001',
      ce: 'PL1',
      ba: 'B01',
      tm: 'tm-1',
      tn: 'Transferencia salida',
      fi: '2026-09-10T12:00:00.000Z',
      fs: '2026-09-10T13:00:00.000Z',
      pi: 20000,
      ps: 3000,
      pn: 17000,
      d: null,
      s: {},
    });
    expect(construirPayloadQr(boleta({ respuestaD365Id: 'TRF-9' })).d).toBe('TRF-9');
  });

  it('boleta sin salida ni centro conocido: nulls, sin inventar', () => {
    const p = construirPayloadQr(boleta({ fechaHoraSalida: null, pesoSalida: null, pesoNeto: null }));
    expect([p.ce, p.fs, p.ps, p.pn]).toEqual([null, null, null, null]);
  });

  it('agrupa por clave de sección/campo (no CampoId), con una fila por ocurrencia', () => {
    const p = construirPayloadQr(
      boleta({
        valores: [
          valor({ seccionClave: 'transporte', campoClave: 'placa', valorTexto: 'C-1' }),
          valor({ seccionClave: 'calidad', campoClave: 'acidez', tipoCampo: 'Decimal', valorNumero: 3.2 }),
          valor({ seccionClave: 'marchamos', campoClave: 'numero', valorTexto: 'M-0' }),
          valor({ seccionClave: 'marchamos', campoClave: 'activo', tipoCampo: 'Booleano', valorBooleano: true }),
          valor({ seccionClave: 'marchamos', campoClave: 'numero', valorTexto: 'M-1', ocurrencia: 1 }),
          valor({ seccionClave: 'marchamos', campoClave: 'observaciones', valorTexto: null }),
        ],
      }),
    );

    expect(p.s).toEqual({
      transporte: [{ placa: 'C-1' }],
      calidad: [{ acidez: 3.2 }],
      marchamos: [{ numero: 'M-0', activo: true }, { numero: 'M-1' }],
    });
  });

  it('las referencias a maestros viajan como snapshot autodescriptivo', () => {
    const p = construirPayloadQr(
      boleta({
        valores: [
          valor({
            seccionClave: 'transporte',
            campoClave: 'piloto',
            tipoCampo: 'ReferenciaMaestro',
            valorMaestroId: 'm-1',
            valorMaestroCodigo: 'PIL-001',
            valorMaestroNombre: 'Ana Pérez',
            valorMaestroTipoCatalogo: 'Piloto',
            valorMaestroProvisional: true,
          }),
          valor({
            seccionClave: 'transporte',
            campoClave: 'transportista',
            tipoCampo: 'ReferenciaMaestro',
            valorMaestroId: 'm-2',
            valorMaestroCodigo: 'TR-9',
            valorMaestroNombre: 'Transportes SA',
          }),
        ],
      }),
    );

    expect(p.s['transporte'][0]).toEqual({
      piloto: { id: 'm-1', codigo: 'PIL-001', nombre: 'Ana Pérez', tipoCatalogo: 'Piloto', provisional: true },
      // Proyección sin tipo/estado (central aún no los expone): degrada sin romper.
      transportista: { id: 'm-2', codigo: 'TR-9', nombre: 'Transportes SA', tipoCatalogo: '', provisional: false },
    });
  });
});
