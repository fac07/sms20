import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot } from '@angular/router';
import { environment } from '../../environments/environment';
import { Modo } from '../../environments/environment.model';
import { modoGuard } from './modo.guard';

describe('modoGuard', () => {
  const router = { parseUrl: vi.fn((url: string) => `URLTREE:${url}`) };
  const modoOriginal = environment.modo;

  function setModo(modo: Modo): void {
    (environment as { modo: Modo }).modo = modo;
  }

  beforeEach(() => {
    router.parseUrl.mockClear();
    TestBed.configureTestingModule({
      providers: [{ provide: Router, useValue: router }],
    });
  });

  afterEach(() => setModo(modoOriginal));

  function run(data: Record<string, unknown>): boolean | unknown {
    const route = { data } as unknown as ActivatedRouteSnapshot;
    return TestBed.runInInjectionContext(() => modoGuard(route, {} as RouterStateSnapshot));
  }

  it('deja pasar una ruta sin data.modo en cualquier modo', () => {
    setModo('admin');
    expect(run({})).toBe(true);
  });

  it('deja pasar cuando el modo de la ruta coincide con el del build', () => {
    setModo('bascula');
    expect(run({ modo: 'bascula' })).toBe(true);
  });

  it('deja pasar cuando el modo del build está entre los modos permitidos', () => {
    setModo('bascula');
    expect(run({ modo: ['bascula', 'admin'] })).toBe(true);
  });

  it('en modo báscula bloquea una ruta admin y redirige a /pesaje', () => {
    setModo('bascula');
    expect(run({ modo: 'admin' })).toBe('URLTREE:/pesaje');
    expect(router.parseUrl).toHaveBeenCalledWith('/pesaje');
  });

  it('en modo admin bloquea /pesaje y redirige a /tipos-movimiento', () => {
    setModo('admin');
    expect(run({ modo: 'bascula' })).toBe('URLTREE:/tipos-movimiento');
    expect(router.parseUrl).toHaveBeenCalledWith('/tipos-movimiento');
  });
});
