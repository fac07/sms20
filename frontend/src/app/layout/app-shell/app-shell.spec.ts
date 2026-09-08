import { navItemsParaModo } from './app-shell';

describe('navItemsParaModo', () => {
  it('modo báscula: muestra Pesaje y la consulta local de Boletas', () => {
    const paths = navItemsParaModo('bascula').map((i) => i.path);
    expect(paths).toEqual(['/pesaje', '/boletas']);
  });

  it('modo admin: incluye configuración y consulta, excluye Pesaje', () => {
    const paths = navItemsParaModo('admin').map((i) => i.path);
    expect(paths).not.toContain('/pesaje');
    expect(paths).toContain('/tipos-movimiento');
    expect(paths).toContain('/boletas');
  });
});
