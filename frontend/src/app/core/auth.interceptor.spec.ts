import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../environments/environment';
import { authInterceptor } from './auth.interceptor';
import { SesionService } from './sesion.service';

const CENTRAL = environment.apiUrl;
const LOCAL = environment.localServerUrl!;

describe('authInterceptor', () => {
  let httpMock: HttpTestingController;
  let http: HttpClient;
  let sesion: SesionService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    http = TestBed.inject(HttpClient);
    sesion = TestBed.inject(SesionService);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('agrega el header Authorization a llamadas al backend central cuando hay token', () => {
    localStorage.setItem('sms20.sesion.token', 'tok-central');

    http.get(`${CENTRAL}/api/maestros`).subscribe();

    const req = httpMock.expectOne(`${CENTRAL}/api/maestros`);
    expect(req.request.headers.get('Authorization')).toBe('Bearer tok-central');
    req.flush([]);
  });

  it('NO agrega el header a llamadas al backend central sin token', () => {
    http.get(`${CENTRAL}/api/maestros`).subscribe();

    const req = httpMock.expectOne(`${CENTRAL}/api/maestros`);
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush([]);
  });

  it('salta el servidor local de Electron aunque haya token', () => {
    localStorage.setItem('sms20.sesion.token', 'tok-central');

    http.get(`${LOCAL}/estado`).subscribe();

    const req = httpMock.expectOne(`${LOCAL}/estado`);
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it('limpia la sesión en un 401 del backend central', () => {
    localStorage.setItem('sms20.sesion.token', 'tok-vencido');

    http.get(`${CENTRAL}/api/maestros`).subscribe({ error: () => {} });

    httpMock
      .expectOne(`${CENTRAL}/api/maestros`)
      .flush({ error: 'no autorizado' }, { status: 401, statusText: 'Unauthorized' });

    expect(sesion.token()).toBeNull();
    expect(sesion.sesion()).toBeNull();
  });

  it('un 401 del servidor local NO limpia la sesión (no lleva identidad humana)', () => {
    localStorage.setItem('sms20.sesion.token', 'tok-central');

    http.get(`${LOCAL}/estado`).subscribe({ error: () => {} });

    httpMock
      .expectOne(`${LOCAL}/estado`)
      .flush({ error: 'no autorizado' }, { status: 401, statusText: 'Unauthorized' });

    expect(sesion.token()).toBe('tok-central');
  });
});
