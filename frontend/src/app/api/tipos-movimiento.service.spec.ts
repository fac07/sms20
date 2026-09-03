import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  AsignacionSeccionInput,
  GuardarTipoMovimientoInput,
  TipoMovimiento,
  TiposMovimientoService,
} from './tipos-movimiento.service';

const BASE = 'http://localhost:5094/api/tipos-movimiento';

describe('TiposMovimientoService', () => {
  let service: TiposMovimientoService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TiposMovimientoService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(TiposMovimientoService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('listar() issues GET /api/tipos-movimiento (default excludes inactivos)', () => {
    service.listar().subscribe();
    const req = httpMock.expectOne(`${BASE}?incluirInactivos=false`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('listar(true) requests inactivos too', () => {
    service.listar(true).subscribe();
    const req = httpMock.expectOne(`${BASE}?incluirInactivos=true`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('crear(input) issues POST /api/tipos-movimiento with the body', () => {
    const input: GuardarTipoMovimientoInput = {
      codigo: 'ING',
      nombre: 'Ingreso de fruta',
      prefijo: 'IF',
      direccion: 'Entrada',
      operacionD365: 'IngresoFruta',
      generaQR: true,
      formatoBoletaId: null,
    };
    service.crear(input).subscribe();
    const req = httpMock.expectOne(BASE);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(input);
    req.flush({ id: 'tm-1', activo: true, ...input } as TipoMovimiento);
  });

  it('actualizar(id, input) issues PUT /api/tipos-movimiento/{id} with the body', () => {
    const input: GuardarTipoMovimientoInput = {
      codigo: 'ING',
      nombre: 'Ingreso de fruta (v2)',
      prefijo: 'IF',
      direccion: 'Entrada',
      operacionD365: null,
      generaQR: false,
      formatoBoletaId: null,
    };
    service.actualizar('tm-1', input).subscribe();
    const req = httpMock.expectOne(`${BASE}/tm-1`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual(input);
    req.flush({ id: 'tm-1', activo: true, ...input } as TipoMovimiento);
  });

  it('desactivar(id) issues DELETE /api/tipos-movimiento/{id}', () => {
    service.desactivar('tm-1').subscribe();
    const req = httpMock.expectOne(`${BASE}/tm-1`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });

  it('listarSecciones(id) issues GET /api/tipos-movimiento/{id}/secciones', () => {
    service.listarSecciones('tm-1').subscribe();
    const req = httpMock.expectOne(`${BASE}/tm-1/secciones?incluirHistoricas=false`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('listarSecciones(id, true) requests historic assignments too', () => {
    service.listarSecciones('tm-1', true).subscribe();
    const req = httpMock.expectOne(`${BASE}/tm-1/secciones?incluirHistoricas=true`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('asignarSecciones(id, payload) issues a declarative PUT with the full desired-state array', () => {
    const payload: AsignacionSeccionInput[] = [
      { seccionId: 'sec-1', requerida: true, orden: 1 },
      { seccionId: 'sec-2', requerida: false, orden: 2 },
    ];
    service.asignarSecciones('tm-1', payload).subscribe();
    const req = httpMock.expectOne(`${BASE}/tm-1/secciones`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual(payload);
    req.flush([]);
  });

  it('formulario(id) issues GET /api/tipos-movimiento/{id}/formulario', () => {
    service.formulario('tm-1').subscribe();
    const req = httpMock.expectOne(`${BASE}/tm-1/formulario`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });
});
