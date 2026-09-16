import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  provideRouter,
  Router,
  RouterStateSnapshot,
  Routes,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { environment } from '../../environments/environment';
import { Modo } from '../../environments/environment.model';
import { modoGuard } from './modo.guard';
import { rolGuard } from './rol.guard';
import { Rol, SesionService } from './sesion.service';

describe('rolGuard', () => {
  const router = { parseUrl: vi.fn((url: string) => `URLTREE:${url}`) };
  let rolActual: Rol | null = null;
  const sesionFake = { rol: () => rolActual };
  const modoOriginal = environment.modo;

  function setRol(rol: Rol | null): void {
    rolActual = rol;
  }

  function setModo(modo: Modo): void {
    (environment as { modo: Modo }).modo = modo;
  }

  beforeEach(() => {
    setRol(null);
    router.parseUrl.mockClear();
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: router },
        { provide: SesionService, useValue: sesionFake },
      ],
    });
  });

  afterEach(() => setModo(modoOriginal));

  function run(data: Record<string, unknown>): boolean | unknown {
    const route = { data } as unknown as ActivatedRouteSnapshot;
    return TestBed.runInInjectionContext(() => rolGuard(route, {} as RouterStateSnapshot));
  }

  it('deja pasar una ruta sin data.rolMinimo, con o sin sesión', () => {
    expect(run({})).toBe(true);
  });

  it('deja pasar cuando el rol de la sesión cumple exactamente el mínimo', () => {
    setRol('Supervisor');
    expect(run({ rolMinimo: 'Supervisor' })).toBe(true);
  });

  it('deja pasar cuando el rol de la sesión supera el mínimo (jerarquía Administrador > Supervisor > Operador)', () => {
    setRol('Administrador');
    expect(run({ rolMinimo: 'Operador' })).toBe(true);
  });

  it('deniega cuando el rol de la sesión es inferior al mínimo', () => {
    setRol('Operador');
    setModo('admin');
    expect(run({ rolMinimo: 'Supervisor' })).not.toBe(true);
  });

  it('sin sesión, deniega y redirige a /login (falla cerrado)', () => {
    setRol(null);
    expect(run({ rolMinimo: 'Operador' })).toBe('URLTREE:/login');
    expect(router.parseUrl).toHaveBeenCalledWith('/login');
  });

  it('con sesión pero rol insuficiente, redirige al home del modo activo (admin)', () => {
    setRol('Operador');
    setModo('admin');
    expect(run({ rolMinimo: 'Administrador' })).toBe('URLTREE:/tipos-movimiento');
  });

  it('con sesión pero rol insuficiente, redirige al home del modo activo (bascula)', () => {
    setRol('Operador');
    setModo('bascula');
    expect(run({ rolMinimo: 'Administrador' })).toBe('URLTREE:/pesaje');
  });
});

describe('[modoGuard, rolGuard] compuestos en AND (canActivate array)', () => {
  @Component({ selector: 'app-dummy-protegida', template: 'protegida' })
  class ProtegidaDummy {}

  @Component({ selector: 'app-dummy-destino', template: 'destino' })
  class DestinoDummy {}

  const modoOriginal = environment.modo;
  let rolActual: Rol | null = null;

  function setModo(modo: Modo): void {
    (environment as { modo: Modo }).modo = modo;
  }

  function setRol(rol: Rol | null): void {
    rolActual = rol;
  }

  // Ruta protegida real: exige modo 'admin' Y rol mínimo Administrador —
  // sólo pasa cuando AMBOS guards aprueban, exactamente como en app.routes.ts.
  const routes: Routes = [
    {
      path: 'protegida',
      component: ProtegidaDummy,
      canActivate: [modoGuard, rolGuard],
      data: { modo: 'admin', rolMinimo: 'Administrador' },
    },
    { path: 'tipos-movimiento', component: DestinoDummy },
    { path: 'pesaje', component: DestinoDummy },
    { path: 'login', component: DestinoDummy },
  ];

  beforeEach(() => {
    setRol(null);
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        { provide: SesionService, useValue: { rol: () => rolActual } },
      ],
    });
  });

  afterEach(() => setModo(modoOriginal));

  it('pasa/pasa: modo correcto y rol suficiente → activa la ruta protegida', async () => {
    setModo('admin');
    setRol('Administrador');

    const harness = await RouterTestingHarness.create();
    const activado = await harness.navigateByUrl('/protegida');

    expect(activado).toBeInstanceOf(ProtegidaDummy);
  });

  it('pasa/falla: modoGuard pasa pero rolGuard deniega → NO activa la ruta protegida', async () => {
    setModo('admin');
    setRol('Operador');

    const harness = await RouterTestingHarness.create();
    const activado = await harness.navigateByUrl('/protegida');

    expect(activado).not.toBeInstanceOf(ProtegidaDummy);
  });

  it('falla/pasa: modoGuard deniega (rolGuard nunca decide) → NO activa la ruta protegida', async () => {
    setModo('bascula');
    setRol('Administrador');

    const harness = await RouterTestingHarness.create();
    const activado = await harness.navigateByUrl('/protegida');

    expect(activado).not.toBeInstanceOf(ProtegidaDummy);
  });
});
