import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  GuardarSeccionInput,
  SeccionDto,
  SeccionesService,
} from './secciones.service';

const BASE = 'http://localhost:5094/api/secciones';

describe('SeccionesService', () => {
  let service: SeccionesService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        SeccionesService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(SeccionesService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('listar() issues GET /api/secciones (default excludes inactivas)', () => {
    service.listar().subscribe();
    const req = httpMock.expectOne(`${BASE}?incluirInactivas=false`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('listar(true) requests inactivas too', () => {
    service.listar(true).subscribe();
    const req = httpMock.expectOne(`${BASE}?incluirInactivas=true`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('crear(input) issues POST /api/secciones with the body', () => {
    const input: Omit<GuardarSeccionInput, 'activa'> = {
      clave: 'detalle_fruta',
      nombre: 'Detalle de fruta',
      cardinalidad: 'Repetible',
      reportable: true,
      orden: 3,
    };
    service.crear(input).subscribe();
    const req = httpMock.expectOne(BASE);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(input);
    req.flush({ id: 'sec-1', estandar: false, activa: true, ...input } as SeccionDto);
  });

  it('actualizar(id, input) issues PUT /api/secciones/{id} with the body', () => {
    const input: GuardarSeccionInput = {
      clave: 'detalle_fruta',
      nombre: 'Detalle de fruta (v2)',
      cardinalidad: 'Repetible',
      reportable: false,
      orden: 5,
      activa: true,
    };
    service.actualizar('sec-1', input).subscribe();
    const req = httpMock.expectOne(`${BASE}/sec-1`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual(input);
    req.flush({ id: 'sec-1', estandar: false, ...input } as SeccionDto);
  });

  it('eliminar(id) issues DELETE /api/secciones/{id}', () => {
    service.eliminar('sec-1').subscribe();
    const req = httpMock.expectOne(`${BASE}/sec-1`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });
});
