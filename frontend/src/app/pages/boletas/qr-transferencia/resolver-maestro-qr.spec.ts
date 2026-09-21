import { MaestroQr } from './qr-transferencia';
import { MaestroLocalQr, resolverMaestroDeQr } from './resolver-maestro-qr';

const ref = (parcial: Partial<MaestroQr> = {}): MaestroQr => ({
  id: 'm-1',
  codigo: 'PIL-001',
  nombre: 'Ana Pérez',
  tipoCatalogo: 'Piloto',
  provisional: false,
  ...parcial,
});

/** Espejo local en memoria: por id y por (tipo, codigo). */
function espejo(filas: MaestroLocalQr[]) {
  return {
    porId: (id: string) => filas.find((f) => f.id === id) ?? null,
    porCodigo: (codigo: string, tipo: string) =>
      filas.find((f) => f.codigo === codigo && f.tipoCatalogo === tipo) ?? null,
  };
}

const fila = (id: string, extra: Partial<MaestroLocalQr> = {}): MaestroLocalQr => ({
  id,
  codigo: `C-${id}`,
  tipoCatalogo: 'Piloto',
  fusionadoConId: null,
  ...extra,
});

describe('resolverMaestroDeQr', () => {
  it('existente: el id ya está en el espejo local', () => {
    const e = espejo([fila('m-1')]);
    expect(resolverMaestroDeQr(ref(), e.porId, e.porCodigo)).toEqual({ kind: 'existente', id: 'm-1' });
  });

  it('fusionado: sigue la cadena FusionadoConId hasta el oficial', () => {
    const e = espejo([fila('m-1', { fusionadoConId: 'm-2' }), fila('m-2', { fusionadoConId: 'm-3' }), fila('m-3')]);
    expect(resolverMaestroDeQr(ref(), e.porId, e.porCodigo)).toEqual({ kind: 'fusionado', id: 'm-3' });
  });

  it('cadena con ciclo: no cuelga; cae a código/creación', () => {
    const e = espejo([fila('m-1', { fusionadoConId: 'm-2' }), fila('m-2', { fusionadoConId: 'm-1' })]);
    expect(resolverMaestroDeQr(ref(), e.porId, e.porCodigo)).toEqual({ kind: 'crearProvisional', ref: ref() });
  });

  it('cadena rota (destino ausente en el espejo): no inventa un id', () => {
    const e = espejo([fila('m-1', { fusionadoConId: 'm-9' })]);
    expect(resolverMaestroDeQr(ref(), e.porId, e.porCodigo).kind).toBe('crearProvisional');
  });

  it('porCodigo: maestro oficial ausente por id pero con mismo código y tipo', () => {
    const e = espejo([fila('otro', { codigo: 'PIL-001' })]);
    expect(resolverMaestroDeQr(ref(), e.porId, e.porCodigo)).toEqual({ kind: 'porCodigo', id: 'otro' });
  });

  it('porCodigo respeta el tipo de catálogo', () => {
    const e = espejo([fila('otro', { codigo: 'PIL-001', tipoCatalogo: 'Transportista' })]);
    expect(resolverMaestroDeQr(ref(), e.porId, e.porCodigo).kind).toBe('crearProvisional');
  });

  it('un provisional ajeno NO se empareja por código (los códigos provisionales pueden colisionar)', () => {
    const e = espejo([fila('otro', { codigo: 'PIL-001' })]);
    const r = ref({ provisional: true });
    expect(resolverMaestroDeQr(r, e.porId, e.porCodigo)).toEqual({ kind: 'crearProvisional', ref: r });
  });

  it('crearProvisional: no existe por id ni por código; conserva el ref (mismo id) para redirigir fusiones futuras', () => {
    const e = espejo([]);
    const r = ref({ provisional: true });
    expect(resolverMaestroDeQr(r, e.porId, e.porCodigo)).toEqual({ kind: 'crearProvisional', ref: r });
  });

  it('sin tipoCatalogo o código no consulta por código', () => {
    const porCodigo = vi.fn(() => fila('x'));
    expect(resolverMaestroDeQr(ref({ tipoCatalogo: '' }), () => null, porCodigo).kind).toBe('crearProvisional');
    expect(porCodigo).not.toHaveBeenCalled();
  });
});
