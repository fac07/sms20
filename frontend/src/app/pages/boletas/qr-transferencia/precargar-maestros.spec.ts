import { Observable, of, throwError } from 'rxjs';
import { MaestroQr } from './qr-transferencia';
import { MaestroLocalQr } from './resolver-maestro-qr';
import { precargarMaestros } from './precargar-maestros';

function qr(id: string, tipoCatalogo = 'Piloto', provisional = false, codigo = `COD-${id}`): MaestroQr {
  return { id, codigo, nombre: `Nombre ${id}`, tipoCatalogo, provisional };
}

function fila(id: string, extra: Partial<MaestroLocalQr> = {}): MaestroLocalQr {
  return { id, codigo: `COD-${id}`, tipoCatalogo: 'Piloto', fusionadoConId: null, ...extra };
}

interface Llamadas {
  porId: string[];
  porCodigo: [string, string][];
}

// API falsa: `porId`/`porCodigo` mapean id|codigo -> fila; `fallarPorId` lista
// los ids cuya consulta lanza error de red.
function apiFalsa(op: {
  porId?: Record<string, MaestroLocalQr>;
  porCodigo?: Record<string, MaestroLocalQr>;
  fallarPorId?: string[];
}): { api: { maestroPorId(id: string): Observable<MaestroLocalQr | null>; maestroPorCodigo(t: string, c: string): Observable<MaestroLocalQr | null> }; llamadas: Llamadas } {
  const llamadas: Llamadas = { porId: [], porCodigo: [] };
  return {
    llamadas,
    api: {
      maestroPorId(id) {
        llamadas.porId.push(id);
        if (op.fallarPorId?.includes(id)) return throwError(() => new Error('red'));
        return of(op.porId?.[id] ?? null);
      },
      maestroPorCodigo(tipoCatalogo, codigo) {
        llamadas.porCodigo.push([tipoCatalogo, codigo]);
        return of(op.porCodigo?.[`${tipoCatalogo}|${codigo}`] ?? null);
      },
    },
  };
}

describe('precargarMaestros — cargadores síncronos para resolverMaestroDeQr', () => {
  it('encuentra por id: el buscador síncrono devuelve la fila y no consulta por código', async () => {
    const { api, llamadas } = apiFalsa({ porId: { 'm-1': fila('m-1') } });

    const buscadores = await precargarMaestros([qr('m-1')], api);

    expect(buscadores.buscarPorId('m-1')).toEqual(fila('m-1'));
    expect(buscadores.buscarPorCodigo('COD-m-1', 'Piloto')).toBeNull();
    expect(llamadas.porCodigo).toEqual([]);
  });

  it('no está por id y el ref es OFICIAL: consulta por código y cachea', async () => {
    const { api, llamadas } = apiFalsa({ porCodigo: { 'Piloto|COD-x': fila('real-9', {}) } });

    const buscadores = await precargarMaestros([qr('x-inexistente', 'Piloto', false, 'COD-x')], api);

    expect(buscadores.buscarPorCodigo('COD-x', 'Piloto')).toEqual(fila('real-9'));
    expect(llamadas.porId).toEqual(['x-inexistente']);
    expect(llamadas.porCodigo).toEqual([['Piloto', 'COD-x']]);
  });

  it('ref PROVISIONAL no encontrado por id: no se consulta por código (los códigos colisionan)', async () => {
    const { api, llamadas } = apiFalsa({});

    const buscadores = await precargarMaestros([qr('prov-1', 'Piloto', true)], api);

    expect(buscadores.buscarPorId('prov-1')).toBeNull();
    expect(llamadas.porCodigo).toEqual([]);
  });

  it('sigue la cadena de fusión cacheando todo el eslabón intermedio', async () => {
    const { api } = apiFalsa({
      porId: { 'viejo': fila('viejo', { fusionadoConId: 'medio' }), 'medio': fila('medio', { fusionadoConId: 'final' }), 'final': fila('final') },
    });

    const buscadores = await precargarMaestros([qr('viejo')], api);

    expect(buscadores.buscarPorId('medio')).toEqual(fila('medio', { fusionadoConId: 'final' }));
    expect(buscadores.buscarPorId('final')).toEqual(fila('final'));
  });

  it('ciclo en la cadena: no cuelga (tope de profundidad) y lo ya cargado queda disponible', async () => {
    const { api, llamadas } = apiFalsa({
      porId: { a: fila('a', { fusionadoConId: 'b' }), b: fila('b', { fusionadoConId: 'a' }) },
    });

    const buscadores = await precargarMaestros([qr('a')], api);

    expect(buscadores.buscarPorId('a')).not.toBeNull();
    expect(llamadas.porId.length).toBeLessThanOrEqual(6);
  });

  it('tope de profundidad 5: una cadena larguísima se corta tras 1 + 5 consultas', async () => {
    const porId: Record<string, MaestroLocalQr> = {};
    for (let i = 0; i < 20; i++) porId[`n${i}`] = fila(`n${i}`, { fusionadoConId: `n${i + 1}` });
    const { api, llamadas } = apiFalsa({ porId });

    await precargarMaestros([qr('n0')], api);

    expect(llamadas.porId).toEqual(['n0', 'n1', 'n2', 'n3', 'n4', 'n5']);
  });

  it('error de red de UNA consulta cuenta como "no encontrado" y no revienta las demás', async () => {
    const { api } = apiFalsa({ porId: { ok: fila('ok') }, fallarPorId: ['malo'] });

    const buscadores = await precargarMaestros([qr('malo'), qr('ok')], api);

    expect(buscadores.buscarPorId('malo')).toBeNull();
    expect(buscadores.buscarPorId('ok')).toEqual(fila('ok'));
  });

  it('refs repetidos o que comparten id: UNA sola consulta por id', async () => {
    const { api, llamadas } = apiFalsa({ porId: { dup: fila('dup') } });

    await precargarMaestros([qr('dup'), qr('dup'), qr('otro')], api);

    expect(llamadas.porId.filter((id) => id === 'dup')).toHaveLength(1);
  });
});
