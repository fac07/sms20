import { of, throwError } from 'rxjs';
import { CampoAplicable } from '../../../api/configuracion.models';
import {
  EfectosRecepcionQr,
  RecepcionQrEstado,
  procesarRecepcionQr,
} from './procesar-recepcion-qr';
import { MaestroQr, PayloadQr, codificarQrTransferencia } from './qr-transferencia';
import { MaestroLocalQr } from './resolver-maestro-qr';

const CLAVE = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const CAMPO_TEXTO: CampoAplicable = {
  campoId: 'campo-texto',
  seccionId: 'sec-transporte',
  seccionClave: 'transporte',
  campoClave: 'observacion',
  etiqueta: 'Observación',
  tipoCampo: 'Texto',
  tipoCatalogoRef: null,
  requerido: false,
  cardinalidad: 'Unica',
  seccionRequerida: false,
  configuracion: null,
  orden: 0,
  seccionOrden: 0,
} as CampoAplicable;

const CAMPO_PILOTO: CampoAplicable = {
  ...CAMPO_TEXTO,
  campoId: 'campo-piloto',
  campoClave: 'piloto',
  tipoCampo: 'ReferenciaMaestro',
  tipoCatalogoRef: 'Piloto',
  requerido: true,
};

const MAESTRO_PILOTO: MaestroQr = {
  id: 'piloto-1',
  codigo: 'P-001',
  nombre: 'Juan Pérez',
  tipoCatalogo: 'Piloto',
  provisional: false,
};

function payloadBase(overrides: Partial<PayloadQr> = {}): PayloadQr {
  return {
    v: 1,
    b: 'boleta-origen-1',
    n: 'GTM-N01-TRF-0000001',
    ce: 'GTM',
    ba: 'N01',
    tm: 'tipo-1',
    tn: 'Envío Transferencia NAT',
    fi: '2026-09-10T12:00:00.000Z',
    fs: '2026-09-10T15:00:00.000Z',
    pi: 20000,
    ps: 5000,
    pn: 15000,
    d: null,
    s: {
      transporte: [{ observacion: 'hola', piloto: MAESTRO_PILOTO }],
    },
    ...overrides,
  };
}

async function codificar(payload: PayloadQr, clave: string | null): Promise<string> {
  const resultado = await codificarQrTransferencia(payload, clave ?? undefined);
  if (!resultado.ok) throw new Error('No se pudo codificar el payload de prueba.');
  return resultado.texto;
}

function efectos(overrides: Partial<EfectosRecepcionQr> = {}): EfectosRecepcionQr {
  return {
    clave: CLAVE,
    boletaRecibidaDe: () => of<RecepcionQrEstado>({ recibida: false }),
    maestros: {
      maestroPorId: () => of<MaestroLocalQr | null>(null),
      maestroPorCodigo: () => of<MaestroLocalQr | null>(null),
    },
    importarMaestroProvisional: () => of({}),
    ...overrides,
  };
}

describe('procesarRecepcionQr', () => {
  it('texto que no es un QR de transferencia -> fase error con el motivo del decoder', async () => {
    const resultado = await procesarRecepcionQr('esto no es un QR', [], efectos());
    expect(resultado).toEqual({ fase: 'error', motivo: 'prefijo-invalido' });
  });

  it('firma inválida bloquea y no llama a ningún efecto', async () => {
    const payload = payloadBase();
    const texto = await codificar(payload, CLAVE);
    const manipulado = texto.slice(0, -1) + (texto.at(-1) === 'A' ? 'B' : 'A');

    const boletaRecibidaDe = vi.fn(() => of<RecepcionQrEstado>({ recibida: false }));
    const resultado = await procesarRecepcionQr(
      manipulado,
      [CAMPO_TEXTO],
      efectos({ boletaRecibidaDe }),
    );

    expect(resultado).toEqual({ fase: 'firma-invalida', numeroBoleta: payload.n });
    expect(boletaRecibidaDe).not.toHaveBeenCalled();
  });

  it('recepción duplicada corta antes de resolver maestros', async () => {
    const payload = payloadBase();
    const texto = await codificar(payload, CLAVE);
    const maestroPorId = vi.fn(() => of<MaestroLocalQr | null>(null));

    const resultado = await procesarRecepcionQr(
      texto,
      [CAMPO_TEXTO, CAMPO_PILOTO],
      efectos({
        boletaRecibidaDe: () =>
          of<RecepcionQrEstado>({ recibida: true, boletaId: 'b-existente', numeroBoleta: 'N-1' }),
        maestros: { maestroPorId, maestroPorCodigo: () => of(null) },
      }),
    );

    expect(resultado).toEqual({ fase: 'duplicado', boletaId: 'b-existente', numeroBoleta: 'N-1' });
    expect(maestroPorId).not.toHaveBeenCalled();
  });

  it('caso feliz: mapea valores, resuelve el piloto existente y expone la referencia para mostrar', async () => {
    const payload = payloadBase();
    const texto = await codificar(payload, CLAVE);

    const resultado = await procesarRecepcionQr(
      texto,
      [CAMPO_TEXTO, CAMPO_PILOTO],
      efectos({
        maestros: {
          maestroPorId: (id) =>
            of(id === 'piloto-1' ? { id: 'piloto-1', codigo: 'P-001', tipoCatalogo: 'Piloto' } : null),
          maestroPorCodigo: () => of(null),
        },
      }),
    );

    expect(resultado.fase).toBe('lista');
    if (resultado.fase !== 'lista') throw new Error('esperaba fase lista');
    expect(resultado.datos.boletaOrigenId).toBe('boleta-origen-1');
    expect(resultado.datos.referencia).toEqual({
      numeroBoleta: 'GTM-N01-TRF-0000001',
      centroCodigo: 'GTM',
      fechaHoraSalida: '2026-09-10T15:00:00.000Z',
      pesoNeto: 15000,
    });
    expect(resultado.datos.firma).toBe('valida');
    expect(resultado.datos.parcial).toBe(false);
    expect(resultado.datos.valores).toEqual(
      expect.arrayContaining([
        { campoId: 'campo-texto', ocurrencia: 0, valorTexto: 'hola' },
        { campoId: 'campo-piloto', ocurrencia: 0, valorMaestroId: 'piloto-1' },
      ]),
    );
    expect(resultado.datos.requeridosSinValor).toEqual([]);
    expect(resultado.datos.maestrosNoImportados).toEqual([]);
  });

  it('sin clave configurada, la firma sale ausente y el flujo sigue', async () => {
    const payload = payloadBase();
    const texto = await codificar(payload, null);

    const resultado = await procesarRecepcionQr(
      texto,
      [CAMPO_TEXTO],
      efectos({ clave: null }),
    );

    expect(resultado.fase).toBe('lista');
    if (resultado.fase !== 'lista') throw new Error('esperaba fase lista');
    expect(resultado.datos.firma).toBe('ausente');
  });

  it('maestro provisional del emisor se importa con el MISMO id antes de crear la boleta', async () => {
    const payload = payloadBase();
    const texto = await codificar(payload, CLAVE);
    const importar = vi.fn(() => of({}));

    const resultado = await procesarRecepcionQr(
      texto,
      [CAMPO_TEXTO, CAMPO_PILOTO],
      efectos({
        maestros: { maestroPorId: () => of(null), maestroPorCodigo: () => of(null) },
        importarMaestroProvisional: importar,
      }),
    );

    expect(importar).toHaveBeenCalledWith({
      id: 'piloto-1',
      tipoCatalogo: 'Piloto',
      nombre: 'Juan Pérez',
    });
    expect(resultado.fase).toBe('lista');
    if (resultado.fase !== 'lista') throw new Error('esperaba fase lista');
    expect(resultado.datos.valores).toEqual(
      expect.arrayContaining([{ campoId: 'campo-piloto', ocurrencia: 0, valorMaestroId: 'piloto-1' }]),
    );
    expect(resultado.datos.maestrosNoImportados).toEqual([]);
  });

  it('si la importación del provisional falla, el valor se descarta y el campo vuelve a quedar requerido sin valor', async () => {
    const payload = payloadBase();
    const texto = await codificar(payload, CLAVE);

    const resultado = await procesarRecepcionQr(
      texto,
      [CAMPO_TEXTO, CAMPO_PILOTO],
      efectos({
        maestros: { maestroPorId: () => of(null), maestroPorCodigo: () => of(null) },
        importarMaestroProvisional: () => throwError(() => new Error('sin conexión')),
      }),
    );

    expect(resultado.fase).toBe('lista');
    if (resultado.fase !== 'lista') throw new Error('esperaba fase lista');
    expect(resultado.datos.valores.some((v) => v.campoId === 'campo-piloto')).toBe(false);
    expect(resultado.datos.maestrosNoImportados).toEqual([{ id: 'piloto-1', nombre: 'Juan Pérez' }]);
    expect(resultado.datos.requeridosSinValor.map((c) => c.campoId)).toEqual(['campo-piloto']);
  });

  it('dos campos apuntando al mismo maestro provisional lo importan una sola vez', async () => {
    const campoPiloto2: CampoAplicable = { ...CAMPO_PILOTO, campoId: 'campo-piloto-2', campoClave: 'piloto2' };
    const payload = payloadBase({
      s: {
        transporte: [
          {
            observacion: 'hola',
            piloto: MAESTRO_PILOTO,
            piloto2: MAESTRO_PILOTO,
          },
        ],
      },
    });
    const texto = await codificar(payload, CLAVE);
    const importar = vi.fn(() => of({}));

    const resultado = await procesarRecepcionQr(
      texto,
      [CAMPO_TEXTO, CAMPO_PILOTO, campoPiloto2],
      efectos({
        maestros: { maestroPorId: () => of(null), maestroPorCodigo: () => of(null) },
        importarMaestroProvisional: importar,
      }),
    );

    expect(importar).toHaveBeenCalledTimes(1);
    expect(resultado.fase).toBe('lista');
  });
});
