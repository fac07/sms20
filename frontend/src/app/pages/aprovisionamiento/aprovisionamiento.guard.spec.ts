import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  Router,
  RouterStateSnapshot,
} from '@angular/router';
import { firstValueFrom, isObservable, of } from 'rxjs';
import { aprovisionamientoGuard } from './aprovisionamiento.guard';

const LOCAL = 'http://127.0.0.1:4127';

describe('aprovisionamientoGuard', () => {
  let httpMock: HttpTestingController;
  const router = { parseUrl: vi.fn((url: string) => `URLTREE:${url}`) };

  beforeEach(() => {
    router.parseUrl.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Router, useValue: router },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function run(path: string) {
    const route = { routeConfig: { path } } as unknown as ActivatedRouteSnapshot;
    const state = {} as RouterStateSnapshot;
    const result = TestBed.runInInjectionContext(() =>
      aprovisionamientoGuard(route, state),
    );
    return firstValueFrom(isObservable(result) ? result : of(result));
  }

  it('redirige a /aprovisionamiento cuando la báscula no está aprovisionada', async () => {
    const p = run('');
    httpMock.expectOne(`${LOCAL}/estado`).flush({ aprovisionada: false });
    expect(await p).toBe('URLTREE:/aprovisionamiento');
  });

  it('deja pasar la ruta de aprovisionamiento cuando no está aprovisionada', async () => {
    const p = run('aprovisionamiento');
    httpMock.expectOne(`${LOCAL}/estado`).flush({ aprovisionada: false });
    expect(await p).toBe(true);
  });

  it('redirige a /pesaje si ya está aprovisionada y se pide la pantalla de aprovisionamiento', async () => {
    const p = run('aprovisionamiento');
    httpMock.expectOne(`${LOCAL}/estado`).flush({ aprovisionada: true });
    expect(await p).toBe('URLTREE:/pesaje');
  });

  it('deja pasar los hijos del shell cuando ya está aprovisionada', async () => {
    const p = run('');
    httpMock.expectOne(`${LOCAL}/estado`).flush({ aprovisionada: true });
    expect(await p).toBe(true);
  });

  it('deja pasar (no traba la app) cuando GET /estado falla', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const p = run('');
    httpMock
      .expectOne(`${LOCAL}/estado`)
      .flush(null, { status: 503, statusText: 'Service Unavailable' });
    expect(await p).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
