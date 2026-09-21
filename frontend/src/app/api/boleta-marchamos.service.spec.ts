import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../environments/environment';
import { BoletaMarchamosService } from './boleta-marchamos.service';

describe('BoletaMarchamosService', () => {
  let service: BoletaMarchamosService;
  let http: HttpTestingController;
  const base = `${environment.apiUrl}/api/boletas/b-1/marchamos`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(BoletaMarchamosService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reads marchamos from the central API', () => {
    service.listar('b-1').subscribe((r) => expect(r.rowVersion).toBe('AQID'));

    const req = http.expectOne(base);
    expect(req.request.method).toBe('GET');
    req.flush({ rowVersion: 'AQID', marchamos: [] });
  });

  it('adds a marchamo with the concurrency token and change observation', () => {
    const input = {
      numero: 'M-002',
      placa: 'P-123ABC',
      activo: true,
      observaciones: 'Seal installed',
      observacionCambio: 'Missing seal added',
      rowVersion: 'AQID',
    };

    service.agregar('b-1', input).subscribe();

    const req = http.expectOne(base);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(input);
    req.flush({ rowVersion: 'BAUG', marchamos: [] });
  });

  it('rectifies one occurrence through the central API', () => {
    const input = {
      numero: 'M-009',
      activo: false,
      observaciones: 'Damaged',
      observacionCambio: 'Seal was deactivated',
      rowVersion: 'AQID',
    };

    service.rectificar('b-1', 2, input).subscribe();

    const req = http.expectOne(`${base}/2`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual(input);
    req.flush({ rowVersion: 'BAUG', marchamos: [] });
  });
});
