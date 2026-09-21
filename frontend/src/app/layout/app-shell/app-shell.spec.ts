import { navItemsParaModo } from './app-shell';

describe('navItemsParaModo', () => {
  it('modo báscula: muestra Pesaje, la consulta local de Boletas y Unidades en Tránsito', () => {
    const paths = navItemsParaModo('bascula').map((i) => i.path);
    expect(paths).toEqual(['/pesaje', '/boletas', '/unidades-en-transito', '/outbox']);
  });

  it('modo admin: incluye configuración y consulta, excluye Pesaje', () => {
    const paths = navItemsParaModo('admin').map((i) => i.path);
    expect(paths).not.toContain('/pesaje');
    expect(paths).toContain('/tipos-movimiento');
    expect(paths).toContain('/preingreso/cola');
    expect(paths).toContain('/boletas');
  });
});
