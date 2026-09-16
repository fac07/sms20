import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../environments/environment';
import { SesionService } from './sesion.service';

const CENTRAL = environment.apiUrl;

describe('SesionService', () => {
  let httpMock: HttpTestingController;
  let service: SesionService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    service = TestBed.inject(SesionService);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('no tiene sesión antes de loguearse', () => {
    expect(service.sesion()).toBeNull();
    expect(service.rol()).toBeNull();
    expect(service.centros()).toEqual([]);
    expect(service.token()).toBeNull();
  });

  it('login() puebla rol y centros en el signal desde login + /yo, y persiste el token', () => {
    let resultado: unknown;
    service.login('supervisor', 'Supervisor123!').subscribe((sesion) => (resultado = sesion));

    const loginReq = httpMock.expectOne(`${CENTRAL}/api/auth/login`);
    expect(loginReq.request.method).toBe('POST');
    expect(loginReq.request.body).toEqual({
      nombreUsuario: 'supervisor',
      clave: 'Supervisor123!',
    });
    loginReq.flush({
      token: 'tok-abc',
      usuarioId: 'u-1',
      nombreUsuario: 'supervisor',
      rol: 'Supervisor',
    });

    // El token ya debe estar persistido ANTES del segundo round-trip, para
    // que el authInterceptor pueda adjuntarlo a la llamada a /yo.
    expect(service.token()).toBe('tok-abc');

    const yoReq = httpMock.expectOne(`${CENTRAL}/api/auth/yo`);
    expect(yoReq.request.method).toBe('GET');
    yoReq.flush({
      usuarioId: 'u-1',
      nombreUsuario: 'supervisor',
      rol: 'Supervisor',
      centros: ['centro-a', 'centro-b'],
      alcance: 'asignado',
    });

    expect(service.rol()).toBe('Supervisor');
    expect(service.centros()).toEqual(['centro-a', 'centro-b']);
    expect(service.sesion()).toEqual({
      usuarioId: 'u-1',
      usuario: 'supervisor',
      rol: 'Supervisor',
      centros: ['centro-a', 'centro-b'],
      alcance: 'asignado',
    });
    expect(resultado).toEqual(service.sesion());
  });

  it('limpiar() borra el signal y el token persistido', () => {
    service.login('administrador', 'Administrador123!').subscribe();
    httpMock
      .expectOne(`${CENTRAL}/api/auth/login`)
      .flush({ token: 'tok-admin', usuarioId: 'u-2', nombreUsuario: 'administrador', rol: 'Administrador' });
    httpMock
      .expectOne(`${CENTRAL}/api/auth/yo`)
      .flush({ usuarioId: 'u-2', nombreUsuario: 'administrador', rol: 'Administrador', centros: [], alcance: 'global' });

    expect(service.token()).toBe('tok-admin');

    service.limpiar();

    expect(service.token()).toBeNull();
    expect(service.sesion()).toBeNull();
    expect(service.rol()).toBeNull();
  });
});
