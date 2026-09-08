import { Route } from '@angular/router';
import { routes } from './app.routes';
import { navItemsParaModo } from './layout/app-shell/app-shell';
import { Modo } from '../environments/environment.model';

/** Hijos de la ruta shell (`path: ''`), donde vive `data.modo` + `modoGuard`. */
function hijosDelShell(): Route[] {
  return routes.find((r) => r.path === '' && r.children)?.children ?? [];
}

function modosDeRuta(path: string): Modo[] | undefined {
  const data = hijosDelShell().find((r) => r.path === path)?.data;
  const modo = data?.['modo'] as Modo | Modo[] | undefined;
  if (modo === undefined) return undefined;
  return Array.isArray(modo) ? modo : [modo];
}

describe('app.routes — coherencia de modo entre rutas y nav', () => {
  // El nav y el guard tienen que decir lo mismo, o un ítem visible redirige al
  // hacer click (bug del swap boletas/basculas en el PR #39).
  for (const modo of ['bascula', 'admin'] as const) {
    it(`toda entrada de nav visible en modo ${modo} tiene una ruta que lo permite`, () => {
      for (const item of navItemsParaModo(modo)) {
        if (item.disabled) continue;
        const path = item.path.replace(/^\//, '');
        const modos = modosDeRuta(path);
        expect(modos, `ruta '${path}'`).toBeDefined();
        expect(modos, `ruta '${path}' en modo ${modo}`).toContain(modo);
      }
    });
  }

  it('la consulta de boletas está disponible en modo báscula (consulta offline)', () => {
    expect(modosDeRuta('boletas')).toContain('bascula');
  });

  it('el CRUD de básculas es solo admin', () => {
    expect(modosDeRuta('basculas')).toEqual(['admin']);
  });

  it('pesaje es solo báscula', () => {
    expect(modosDeRuta('pesaje')).toEqual(['bascula']);
  });
});
