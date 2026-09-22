import { CampoAplicable, ValorCampoDto } from '../../../api/configuracion.models';
import { FilaQr, MaestroQr, PayloadQr } from './qr-transferencia';
import { ResolucionMaestroQr } from './resolver-maestro-qr';
import { mapearQrAValores } from './mapear-qr-a-valores';

function campo(parcial: Partial<CampoAplicable> = {}): CampoAplicable {
  return {
    campoId: 'c-1',
    seccionId: 's-1',
    seccionClave: 'transporte',
    campoClave: 'piloto',
    etiqueta: 'Piloto',
    tipoCampo: 'Texto',
    tipoCatalogoRef: null,
    requerido: false,
    cardinalidad: 'Unica',
    seccionRequerida: false,
    configuracion: null,
    orden: 0,
    seccionOrden: 0,
    seccionEtiqueta: 'Transporte',
    ...parcial,
  };
}

function payload(s: Record<string, FilaQr[]>): PayloadQr {
  return {
    v: 1,
    b: 'origen-1',
    n: 'TR-B01-000042',
    ce: 'CRT',
    ba: 'B01',
    tm: 'tm-origen',
    tn: 'Transferencia',
    fi: '2026-09-20T08:00:00Z',
    fs: '2026-09-20T09:00:00Z',
    pi: 20000,
    ps: 3000,
    pn: 17000,
    d: null,
    s,
  };
}

function maestro(parcial: Partial<MaestroQr> = {}): MaestroQr {
  return {
    id: 'm-1',
    codigo: 'PIL-001',
    nombre: 'Juan Pérez',
    tipoCatalogo: 'Piloto',
    provisional: false,
    ...parcial,
  };
}

// Resolver stub: devuelve lo que le cuelgue en el mapa por id de ref.
function resolverCon(resoluciones: Record<string, ResolucionMaestroQr>) {
  return (ref: MaestroQr): ResolucionMaestroQr => resoluciones[ref.id] ?? { kind: 'existente', id: ref.id };
}

function valorDe(valores: ValorCampoDto[], campoId: string): ValorCampoDto | undefined {
  return valores.find((v) => v.campoId === campoId);
}

describe('mapearQrAValores — destino por (seccionClave, campoClave)', () => {
  it('Texto mapea a valorTexto con el campoId y la ocurrencia del destino', () => {
    const campos = [campo({ campoId: 'c-piloto-nombre', campoClave: 'piloto_nombre' })];

    const r = mapearQrAValores(payload({ transporte: [{ piloto_nombre: 'Pedro' }] }), campos, resolverCon({}));

    expect(r.valores).toEqual([{ campoId: 'c-piloto-nombre', ocurrencia: 0, valorTexto: 'Pedro' }]);
    expect(r.advertencias).toEqual([]);
  });

  it('campo sin destino se omite y se agrupa en UNA advertencia con todas sus ocurrencias', () => {
    const campos = [campo({ campoClave: 'placa', cardinalidad: 'Repetible' })];
    const r = mapearQrAValores(
      payload({ transporte: [{ placa: 'ABC-123', caporal: 'Ana' }, { placa: 'DEF-456', caporal: 'Bo' }] }),
      campos,
      resolverCon({}),
    );

    expect(r.valores).toHaveLength(2);
    expect(r.advertencias).toEqual([
      { motivo: 'campo-sin-destino', seccionClave: 'transporte', campoClave: 'caporal', ocurrencias: [0, 1] },
    ]);
  });

  it('sección entera desconocida no crea valores y cada campo suyo advierte', () => {
    const r = mapearQrAValores(payload({ compostera: [{ cui: 123 }] }), [], resolverCon({}));

    expect(r.valores).toEqual([]);
    expect(r.advertencias).toEqual([
      { motivo: 'campo-sin-destino', seccionClave: 'compostera', campoClave: 'cui', ocurrencias: [0] },
    ]);
  });
});

describe('mapearQrAValores — cardinalidad de sección', () => {
  it('Unica: solo entra la fila 0 y el resto se advierte como fila-excedente-unica', () => {
    const campos = [campo({ campoClave: 'placa', cardinalidad: 'Unica' })];
    const r = mapearQrAValores(
      payload({ transporte: [{ placa: 'AAA' }, { placa: 'BBB' }, { placa: 'CCC' }] }),
      campos,
      resolverCon({}),
    );

    expect(r.valores).toEqual([{ campoId: 'c-1', ocurrencia: 0, valorTexto: 'AAA' }]);
    expect(r.advertencias).toEqual([
      { motivo: 'fila-excedente-unica', seccionClave: 'transporte', campoClave: null, ocurrencias: [1, 2] },
    ]);
  });

  it('Repetible: el índice de fila es la ocurrencia', () => {
    const campos = [campo({ campoId: 'c-num', seccionClave: 'marchamos', campoClave: 'numero', cardinalidad: 'Repetible', tipoCampo: 'Entero' })];
    const r = mapearQrAValores(
      payload({ marchamos: [{ numero: 10 }, { numero: 20 }, { numero: 30 }] }),
      campos,
      resolverCon({}),
    );

    expect(r.valores.map((v) => [v.ocurrencia, v.valorNumero])).toEqual([[0, 10], [1, 20], [2, 30]]);
  });
});

describe('mapearQrAValores — columna según tipoCampo (espejo de armar-valores)', () => {
  it('Entero: finita e inteira y dentro de min/max; fuera de rango o decimal → valor-incompatible', () => {
    const campos = [
      campo({ campoId: 'c-cant', seccionClave: 'producto', campoClave: 'cantidad', cardinalidad: 'Repetible', tipoCampo: 'Entero', configuracion: '{"min":1,"max":100}' }),
    ];
    const r = mapearQrAValores(
      payload({ producto: [{ cantidad: 50 }, { cantidad: 101 }, { cantidad: 2.5 }, { cantidad: 'x' }] }),
      campos,
      resolverCon({}),
    );

    expect(r.valores).toEqual([{ campoId: 'c-cant', ocurrencia: 0, valorNumero: 50 }]);
    expect(r.advertencias).toEqual([
      { motivo: 'valor-incompatible', seccionClave: 'producto', campoClave: 'cantidad', ocurrencias: [1, 2, 3] },
    ]);
  });

  it('Decimal acepta decimales; sin configuracion no hay cotas', () => {
    const campos = [campo({ campoId: 'c-acidez', campoClave: 'acidez', seccionClave: 'calidad', tipoCampo: 'Decimal' })];
    const r = mapearQrAValores(payload({ calidad: [{ acidez: 0.42 }] }), campos, resolverCon({}));
    expect(r.valores).toEqual([{ campoId: 'c-acidez', ocurrencia: 0, valorNumero: 0.42 }]);
  });

  it('Fecha/FechaHora: ISO parseable normalizada a ISO; basura → incompatible', () => {
    const campos = [
      campo({ campoId: 'c-fc', campoClave: 'fecha_corte', seccionClave: 'detalle_fruta', tipoCampo: 'Fecha' }),
    ];
    const r = mapearQrAValores(
      payload({ detalle_fruta: [{ fecha_corte: '2026-09-01T00:00:00Z' }] }),
      campos,
      resolverCon({}),
    );
    expect(r.valores).toEqual([{ campoId: 'c-fc', ocurrencia: 0, valorFecha: '2026-09-01T00:00:00.000Z' }]);

    const malo = mapearQrAValores(payload({ detalle_fruta: [{ fecha_corte: 'ayer' }] }), campos, resolverCon({}));
    expect(malo.valores).toEqual([]);
    expect(malo.advertencias[0].motivo).toBe('valor-incompatible');
  });

  it('Booleano: solo booleanos (false cuenta como valor)', () => {
    const campos = [campo({ campoId: 'c-rev', campoClave: 'revision_qa', seccionClave: 'calidad', tipoCampo: 'Booleano' })];
    const r = mapearQrAValores(payload({ calidad: [{ revision_qa: false }] }), campos, resolverCon({}));
    expect(r.valores).toEqual([{ campoId: 'c-rev', ocurrencia: 0, valorBooleano: false }]);

    const texto = mapearQrAValores(payload({ calidad: [{ revision_qa: 'false' }] }), campos, resolverCon({}));
    expect(texto.valores).toEqual([]);
    expect(texto.advertencias[0].motivo).toBe('valor-incompatible');
  });

  it('Lista: el valor debe estar entre las opciones de configuracion', () => {
    const campos = [
      campo({ campoId: 'c-luz', campoClave: 'luz', seccionClave: 'calidad', tipoCampo: 'Lista', configuracion: '{"opciones":["Bueno","Regular","Malo"]}' }),
    ];
    const ok = mapearQrAValores(payload({ calidad: [{ luz: 'Regular' }] }), campos, resolverCon({}));
    expect(ok.valores).toEqual([{ campoId: 'c-luz', ocurrencia: 0, valorTexto: 'Regular' }]);

    const malo = mapearQrAValores(payload({ calidad: [{ luz: 'Excelente' }] }), campos, resolverCon({}));
    expect(malo.valores).toEqual([]);
    expect(malo.advertencias[0].motivo).toBe('valor-incompatible');
  });

  it('Texto con string vacío o no-string → incompatible', () => {
    const campos = [campo({ campoId: 'c-obs', campoClave: 'observaciones', cardinalidad: 'Repetible' })];
    const r = mapearQrAValores(payload({ transporte: [{ observaciones: '' }, { observaciones: 42 }] }), campos, resolverCon({}));
    expect(r.valores).toEqual([]);
    expect(r.advertencias[0]!.motivo).toBe('valor-incompatible');
    expect(r.advertencias[0]!.ocurrencias).toEqual([0, 1]);
  });
});

describe('mapearQrAValores — ReferenciaMaestro vía resolver inyectado', () => {
  const refPiloto = campo({ campoId: 'c-pil', campoClave: 'piloto', tipoCampo: 'ReferenciaMaestro', tipoCatalogoRef: 'Piloto', cardinalidad: 'Repetible' });

  it('existente/fusionado/porCodigo usan el id resuelto como valorMaestroId', () => {
    const qr = maestro({ id: 'ref-1' });
    const r = mapearQrAValores(
      payload({ transporte: [{ piloto: qr }] }),
      [refPiloto],
      resolverCon({ 'ref-1': { kind: 'fusionado', id: 'vigente-9' } }),
    );
    expect(r.valores).toEqual([{ campoId: 'c-pil', ocurrencia: 0, valorMaestroId: 'vigente-9' }]);
    expect(r.maestrosAImportar).toEqual([]);
  });

  it('crearProvisional usa el id del ref y lo suma a maestrosAImportar sin duplicar por id', () => {
    const qr = maestro({ id: 'ref-2' });
    const crear = (ref: MaestroQr): ResolucionMaestroQr => ({ kind: 'crearProvisional', ref });
    const r = mapearQrAValores(
      payload({ transporte: [{ piloto: qr }, { piloto: qr }] }),
      [refPiloto],
      crear,
    );
    expect(r.valores).toHaveLength(2);
    expect(r.valores[0]!.valorMaestroId).toBe('ref-2');
    expect(r.maestrosAImportar).toEqual([qr]);
  });

  it('tipoCatalogo distinto al del campo → maestro-tipo-incompatible y NO se llama al resolver', () => {
    let llamado = false;
    const r = mapearQrAValores(
      payload({ transporte: [{ piloto: maestro({ tipoCatalogo: 'Transportista' }) }] }),
      [refPiloto],
      () => {
        llamado = true;
        return { kind: 'existente', id: 'x' };
      },
    );
    expect(r.valores).toEqual([]);
    expect(r.advertencias).toEqual([
      { motivo: 'maestro-tipo-incompatible', seccionClave: 'transporte', campoClave: 'piloto', ocurrencias: [0] },
    ]);
    expect(llamado).toBe(false);
  });

  it('valor no-maestro (string suelto) en ReferenciaMaestro → incompatible', () => {
    const r = mapearQrAValores(payload({ transporte: [{ piloto: 'guid-pelado' }] }), [refPiloto], resolverCon({}));
    expect(r.valores).toEqual([]);
    expect(r.advertencias[0]!.motivo).toBe('valor-incompatible');
  });
});

describe('mapearQrAValores — requeridos sin valor', () => {
  it('campos requeridos que no llegaron o se descartaron, devueltos intactos (sin inventar)', () => {
    const campos = [
      campo({ campoId: 'c-a', campoClave: 'placa', requerido: true }),
      campo({ campoId: 'c-b', campoClave: 'transportista', requerido: true }),
      campo({ campoId: 'c-c', campoClave: 'licencia', requerido: true }),
    ];
    // 'licencia' viene incompatible (número para Texto); 'transportista' no viene.
    const r = mapearQrAValores(payload({ transporte: [{ placa: 'ABC', licencia: 12 }] }), campos, resolverCon({}));

    expect(r.requeridosSinValor.map((c) => c.campoId)).toEqual(['c-b', 'c-c']);
  });
});

describe('mapearQrAValores — payload realista de transferencia', () => {
  it('transporte (Unica con maestros) + marchamos (Repetible) + calidad', () => {
    const campos: CampoAplicable[] = [
      campo({ campoId: 'c-1', campoClave: 'piloto', tipoCampo: 'ReferenciaMaestro', tipoCatalogoRef: 'Piloto' }),
      campo({ campoId: 'c-2', campoClave: 'transportista', tipoCampo: 'ReferenciaMaestro', tipoCatalogoRef: 'Transportista' }),
      campo({ campoId: 'c-3', campoClave: 'placa' }),
      campo({ campoId: 'c-4', campoClave: 'numero', seccionClave: 'marchamos', cardinalidad: 'Repetible', tipoCampo: 'Entero' }),
      campo({ campoId: 'c-5', campoClave: 'activo', seccionClave: 'marchamos', cardinalidad: 'Repetible', tipoCampo: 'Booleano' }),
      campo({ campoId: 'c-6', campoClave: 'acidez', seccionClave: 'calidad', tipoCampo: 'Decimal', configuracion: '{"min":0,"max":5}' }),
    ];
    const s: Record<string, FilaQr[]> = {
      transporte: [
        { piloto: maestro({ id: 'p1', tipoCatalogo: 'Piloto' }), transportista: maestro({ id: 't1', tipoCatalogo: 'Transportista', provisional: true }), placa: 'ABC-123' },
      ],
      marchamos: [{ numero: 1, activo: true }, { numero: 2, activo: false, observaciones: 'libre' }],
      calidad: [{ acidez: 0.3 }],
    };

    const r = mapearQrAValores(
      payload(s),
      campos,
      resolverCon({ t1: { kind: 'crearProvisional', ref: maestro({ id: 't1', tipoCatalogo: 'Transportista', provisional: true }) } }),
    );

    expect(r.valores).toEqual([
      { campoId: 'c-1', ocurrencia: 0, valorMaestroId: 'p1' },
      { campoId: 'c-2', ocurrencia: 0, valorMaestroId: 't1' },
      { campoId: 'c-3', ocurrencia: 0, valorTexto: 'ABC-123' },
      { campoId: 'c-4', ocurrencia: 0, valorNumero: 1 },
      { campoId: 'c-5', ocurrencia: 0, valorBooleano: true },
      { campoId: 'c-4', ocurrencia: 1, valorNumero: 2 },
      { campoId: 'c-5', ocurrencia: 1, valorBooleano: false },
      { campoId: 'c-6', ocurrencia: 0, valorNumero: 0.3 },
    ]);
    expect(r.maestrosAImportar).toEqual([maestro({ id: 't1', tipoCatalogo: 'Transportista', provisional: true })]);
    expect(r.advertencias).toEqual([
      { motivo: 'campo-sin-destino', seccionClave: 'marchamos', campoClave: 'observaciones', ocurrencias: [1] },
    ]);
    expect(r.requeridosSinValor).toEqual([]);
  });
});
