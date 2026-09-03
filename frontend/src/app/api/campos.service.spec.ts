import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ActualizarCampoInput,
  CampoDto,
  CamposService,
  CrearCampoInput,
  NuevaVersionCampoInput,
} from './campos.service';

const BASE = 'http://localhost:5094/api/campos';

describe('CamposService', () => {
  let service: CamposService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        CamposService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(CamposService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('listar() issues GET /api/campos with only the historicos flag', () => {
    service.listar().subscribe();
    const req = httpMock.expectOne(`${BASE}?incluirHistoricos=false`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('listar(seccionId) adds the seccionId query param', () => {
    service.listar('sec-1').subscribe();
    const req = httpMock.expectOne(`${BASE}?seccionId=sec-1&incluirHistoricos=false`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('listar(seccionId, true) requests históricos too', () => {
    service.listar('sec-1', true).subscribe();
    const req = httpMock.expectOne(`${BASE}?seccionId=sec-1&incluirHistoricos=true`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('crear(input) issues POST /api/campos with the body', () => {
    const input: CrearCampoInput = {
      seccionId: 'sec-1',
      clave: 'racimos_verdes',
      etiqueta: 'Racimos verdes',
      tipoCampo: 'Entero',
      tipoCatalogoRef: null,
      requerido: true,
      configuracion: '{"min":0}',
      orden: 2,
    };
    service.crear(input).subscribe();
    const req = httpMock.expectOne(BASE);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(input);
    req.flush({ id: 'c-1', vigenteDesde: '2026-01-01', vigenteHasta: null, ...input } as CampoDto);
  });

  it('actualizar(id, input) issues PUT /api/campos/{id} with the body', () => {
    const input: ActualizarCampoInput = {
      etiqueta: 'Racimos verdes (v2)',
      requerido: false,
      configuracion: null,
      orden: 5,
    };
    service.actualizar('c-1', input).subscribe();
    const req = httpMock.expectOne(`${BASE}/c-1`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual(input);
    req.flush({ id: 'c-1' } as CampoDto);
  });

  it('nuevaVersion(id, input) issues POST /api/campos/{id}/nueva-version with the body', () => {
    const input: NuevaVersionCampoInput = {
      etiqueta: 'Racimos verdes',
      tipoCampo: 'Decimal',
      tipoCatalogoRef: null,
      requerido: true,
      configuracion: '{"decimales":2}',
      orden: 2,
    };
    service.nuevaVersion('c-1', input).subscribe();
    const req = httpMock.expectOne(`${BASE}/c-1/nueva-version`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(input);
    req.flush({ id: 'c-2' } as CampoDto);
  });

  it('eliminar(id) issues DELETE /api/campos/{id}', () => {
    service.eliminar('c-1').subscribe();
    const req = httpMock.expectOne(`${BASE}/c-1`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });
});
