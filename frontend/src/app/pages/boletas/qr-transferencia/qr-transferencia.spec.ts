import * as QRCode from 'qrcode';
import {
  MaestroQr,
  PayloadQr,
  codificarQrTransferencia,
  decodificarQrTransferencia,
} from './qr-transferencia';

// Generador determinista de GUIDs (los ids reales son entropía pura: lo peor
// que puede ver el compresor) para que el presupuesto de tamaño no sea flaky.
function guids(semilla: number): () => string {
  let s = semilla;
  const hex = (len: number) => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s.toString(16).padStart(8, '0').slice(0, len);
  };
  return () => `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(8)}${hex(4)}`;
}

function maestro(nuevoId: () => string, tipoCatalogo: string, n: number, provisional = false): MaestroQr {
  return {
    id: nuevoId(),
    codigo: `${tipoCatalogo.slice(0, 3).toUpperCase()}-${1000 + n}`,
    nombre: `${tipoCatalogo} de ejemplo ${n} S.A.`,
    tipoCatalogo,
    provisional,
  };
}

function payloadBase(parcial: Partial<PayloadQr> = {}): PayloadQr {
  return {
    v: 1,
    b: '8c263238-d3f3-4be0-9945-3a86fd953a19',
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
    ...parcial,
  };
}

function payloadPesado(): PayloadQr {
  const id = guids(7);
  return payloadBase({
    s: {
      transporte: [
        {
          transportista: maestro(id, 'Transportista', 1),
          piloto: maestro(id, 'Piloto', 2, true),
          equipo: maestro(id, 'Equipo', 3),
          placa: 'C-123ABC',
          licencia: 'LIC-99887766',
        },
      ],
      marchamos: [1, 2, 3, 4].map((i) => ({
        numero: `MAR-00${i}7788`,
        placa: 'C-123ABC',
        equipo: maestro(id, 'Equipo', 3),
        activo: true,
        observaciones: `Colocado en tolva ${i}`,
      })),
      equipos: [1, 2, 3].map((i) => ({ equipo: maestro(id, 'Equipo', 10 + i), placa: `C-90${i}XYZ` })),
      calidad: [1, 2, 3].map((i) => ({
        acidez: 3.1 + i / 10,
        luz: 12.5,
        temperatura: 28.4,
        dobi: 2.9,
        humedad: 0.2 + i / 100,
        revision_qa: `Muestra ${i} conforme`,
      })),
      caracteristicas: [1, 2, 3, 4, 5].map((i) => ({
        clave: `caract_${i}`,
        valor: `valor de la característica ${i}`,
        tipo_dato: 'Texto',
      })),
      detalle_fruta: [
        { finca: maestro(id, 'Finca', 20), lote: 'L-45', caporal: 'Juan Pérez', fecha_corte: '2026-09-09T00:00:00Z' },
      ],
    },
  });
}

/** Helper del test: cuerpo base64url de un texto arbitrario (deflate-raw). */
async function comprimirBase64Url(texto: string): Promise<string> {
  const cs = new CompressionStream('deflate-raw');
  const w = cs.writable.getWriter();
  void w.write(new TextEncoder().encode(texto));
  void w.close();
  const bytes: number[] = [];
  const reader = cs.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes.push(...value);
  }
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

describe('codec QR de transferencia', () => {
  it('round-trip sin clave: firma "-" y decodifica a "ausente"', async () => {
    const payload = payloadPesado();
    const r = await codificarQrTransferencia(payload, null);
    if (!r.ok) throw new Error(r.motivo);

    expect(r.texto).toMatch(/^SMS1\.[A-Za-z0-9_-]+\.-$/);

    const d = await decodificarQrTransferencia(r.texto);
    expect(d).toEqual({ ok: true, payload, firma: 'ausente', parcial: false });
  });

  it('round-trip con clave: firma válida; con otra clave: inválida', async () => {
    const r = await codificarQrTransferencia(payloadBase(), 'clave-secreta');
    if (!r.ok) throw new Error(r.motivo);
    expect(r.texto).toMatch(/^SMS1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{11}$/); // 8 bytes -> 11 chars

    const ok = await decodificarQrTransferencia(r.texto, 'clave-secreta');
    expect(ok.ok && ok.firma).toBe('valida');
    const otra = await decodificarQrTransferencia(r.texto, 'otra-clave');
    expect(otra.ok && otra.firma).toBe('invalida');
  });

  it('tamper: alterar un carácter con clave -> nunca "valida"', async () => {
    const r = await codificarQrTransferencia(payloadBase(), 'k');
    if (!r.ok) throw new Error(r.motivo);
    const [prefijo, cuerpo, firma] = r.texto.split('.');
    // Alterar el cuerpo puede dejar deflate roto (ok:false) o válido con firma
    // inválida; alterar la firma siempre da inválida.
    const i = Math.floor(cuerpo.length / 2);
    const alterado = `${prefijo}.${cuerpo.slice(0, i)}${cuerpo[i] === 'A' ? 'B' : 'A'}${cuerpo.slice(i + 1)}.${firma}`;
    const d = await decodificarQrTransferencia(alterado, 'k');
    expect(d.ok && d.firma === 'valida').toBe(false);

    const firmaAlterada = `${prefijo}.${cuerpo}.${firma[0] === 'A' ? 'B' : 'A'}${firma.slice(1)}`;
    const d2 = await decodificarQrTransferencia(firmaAlterada, 'k');
    expect(d2.ok && d2.firma).toBe('invalida');
  });

  it('firma "-" con clave presente se reporta ausente (la política es del receptor)', async () => {
    const r = await codificarQrTransferencia(payloadBase(), null);
    if (!r.ok) throw new Error(r.motivo);
    const d = await decodificarQrTransferencia(r.texto, 'k');
    expect(d.ok && d.firma).toBe('ausente');
  });

  it('tolera espacios y salto de línea del scanner (keyboard wedge)', async () => {
    const r = await codificarQrTransferencia(payloadBase(), null);
    if (!r.ok) throw new Error(r.motivo);
    const d = await decodificarQrTransferencia(`  ${r.texto}\r\n`);
    expect(d.ok).toBe(true);
  });

  it.each([
    ['prefijo ajeno', 'ABC.xxx.-', 'prefijo-invalido'],
    ['GUID legado', '8c263238-d3f3-4be0-9945-3a86fd953a19', 'prefijo-invalido'],
    ['versión futura', 'SMS2.abc.-', 'version-no-soportada'],
    ['sin firma', 'SMS1.abc', 'formato-invalido'],
    ['base64 malformado', 'SMS1.@@@@.-', 'formato-invalido'],
    ['deflate corrupto', 'SMS1.AAAAAAAA.-', 'deflate-invalido'],
    ['vacío', '', 'prefijo-invalido'],
  ])('rechaza %s sin lanzar', async (_nombre, texto, motivo) => {
    expect(await decodificarQrTransferencia(texto)).toEqual({ ok: false, motivo });
  });

  it('rechaza entrada sobredimensionada', async () => {
    const d = await decodificarQrTransferencia(`SMS1.${'A'.repeat(5000)}.-`);
    expect(d).toEqual({ ok: false, motivo: 'demasiado-grande' });
  });

  it('rechaza JSON basura o de otra forma (deflate válido, contenido no)', async () => {
    const basura = await comprimirBase64Url('esto no es json');
    expect(await decodificarQrTransferencia(`SMS1.${basura}.-`)).toEqual({ ok: false, motivo: 'json-invalido' });
    const otroJson = await comprimirBase64Url('{"x":1}');
    expect(await decodificarQrTransferencia(`SMS1.${otroJson}.-`)).toEqual({ ok: false, motivo: 'payload-invalido' });
  });

  describe('presupuesto de tamaño', () => {
    it('una boleta pesada realista entra completa y con matriz razonable', async () => {
      const r = await codificarQrTransferencia(payloadPesado(), 'k');
      if (!r.ok) throw new Error(r.motivo);
      expect(r.texto.length).toBeLessThanOrEqual(2200);
      expect(r.payload.parcial).toBeUndefined();

      const qr = QRCode.create(r.texto, { errorCorrectionLevel: 'L' });
      expect(qr.modules.size).toBeLessThanOrEqual(137); // versión <= 30
    });

    it('si no entra descarta calidad, luego características, y marca parcial', async () => {
      const id = guids(3);
      const relleno = (n: number) => Array.from({ length: n }, () => ({ nota: `${id()}${id()}${id()}` }));
      const grande = payloadBase({
        s: {
          transporte: [{ placa: 'C-1' }],
          marchamos: [{ numero: 'M-1' }],
          calidad: relleno(40),
          caracteristicas: relleno(40),
          detalle_fruta: [{ finca: 'F' }],
        },
      });

      const r = await codificarQrTransferencia(grande, null);
      if (!r.ok) throw new Error(r.motivo);
      expect(r.texto.length).toBeLessThanOrEqual(2200);
      expect(r.payload.parcial).toBe(true);
      expect(r.payload.omitidas).toEqual(['calidad', 'caracteristicas']);
      expect(Object.keys(r.payload.s)).toEqual(['transporte', 'marchamos', 'detalle_fruta']);

      const d = await decodificarQrTransferencia(r.texto);
      expect(d.ok && d.parcial).toBe(true);
    });

    it('descarta el resto salvo transporte/marchamos antes de rendirse', async () => {
      const id = guids(5);
      const relleno = (n: number) => Array.from({ length: n }, () => ({ nota: `${id()}${id()}${id()}` }));
      const r = await codificarQrTransferencia(
        payloadBase({ s: { transporte: [{ placa: 'C-1' }], marchamos: [{ numero: 'M-1' }], detalle_fruta: relleno(60) } }),
        null,
      );
      if (!r.ok) throw new Error(r.motivo);
      expect(r.payload.omitidas).toEqual(['detalle_fruta']);
      expect(Object.keys(r.payload.s)).toEqual(['transporte', 'marchamos']);
    });

    it('error explícito si aun sin opcionales no entra (nunca trunca)', async () => {
      const id = guids(9);
      const r = await codificarQrTransferencia(
        payloadBase({ s: { transporte: Array.from({ length: 80 }, () => ({ placa: `${id()}${id()}` })) } }),
        null,
      );
      expect(r).toEqual({ ok: false, motivo: 'demasiado-grande' });
    });
  });
});
