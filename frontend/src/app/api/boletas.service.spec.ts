import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../environments/environment';
import { Modo } from '../../environments/environment.model';
import { BoletaDto, BoletasService } from './boletas.service';
import { ValorCampoLeidoDto } from './configuracion.models';

const BASE = `${environment.apiUrl}/api/boletas`;
const LOCAL_BASE = `${environment.localServerUrl}/boletas`;

describe('BoletasService', () => {
  let service: BoletasService;
  let httpMock: HttpTestingController;
  const modoOriginal = environment.modo;

  function setModo(modo: Modo): void {
    (environment as { modo: Modo }).modo = modo;
  }

  beforeEach(() => {
    setModo('admin');
    TestBed.configureTestingModule({
      providers: [
        BoletasService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(BoletasService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    setModo(modoOriginal);
  });

  it('listar() issues GET /api/boletas without a filter', () => {
    service.listar().subscribe();
    const req = httpMock.expectOne(BASE);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('listar(estado) issues GET /api/boletas?estado=', () => {
    service.listar('Cerrada').subscribe();
    const req = httpMock.expectOne(`${BASE}?estado=Cerrada`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('listar(undefined, origenPeso) issues GET /api/boletas?origenPeso=Manual', () => {
    service.listar(undefined, 'Manual').subscribe();
    const req = httpMock.expectOne(`${BASE}?origenPeso=Manual`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('listar(estado, origenPeso) combines both query params', () => {
    service.listar('Cerrada', 'Manual').subscribe();
    const req = httpMock.expectOne(`${BASE}?estado=Cerrada&origenPeso=Manual`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('obtener(id) carries the manual-weight motive projection', () => {
    let recibida: BoletaDto | undefined;
    service.obtener('b-9').subscribe((b) => (recibida = b));

    const req = httpMock.expectOne(`${BASE}/b-9`);
    req.flush({
      id: 'b-9',
      origenPesoIngreso: 'Manual',
      motivoPesoManual: 'IndicadorSinSenal',
      motivoPesoManualDetalle: 'La pantalla no encendía',
      valores: [],
    } as unknown as BoletaDto);

    expect(recibida?.motivoPesoManual).toBe('IndicadorSinSenal');
    expect(recibida?.motivoPesoManualDetalle).toBe('La pantalla no encendía');
  });

  it('obtener(id) issues GET /api/boletas/{id} and carries the typed valores projection', () => {
    const valor: ValorCampoLeidoDto = {
      campoId: 'c-1',
      seccionClave: 'detalle_fruta',
      seccionNombre: 'Detalle Fruta',
      campoClave: 'finca',
      etiqueta: 'Finca',
      tipoCampo: 'ReferenciaMaestro',
      ocurrencia: 0,
      valorMaestroId: 'm-1',
      valorMaestroNombre: 'Finca X',
    };
    let recibida: BoletaDto | undefined;
    service.obtener('b-1').subscribe((b) => (recibida = b));

    const req = httpMock.expectOne(`${BASE}/b-1`);
    expect(req.request.method).toBe('GET');
    req.flush({ id: 'b-1', valores: [valor] } as BoletaDto);

    expect(recibida?.valores).toHaveLength(1);
    expect(recibida?.valores[0].valorMaestroNombre).toBe('Finca X');
  });

  it('modo báscula consulta lista y detalle sólo en el servidor local', () => {
    setModo('bascula');

    service.listar('Cerrada', 'Manual').subscribe();
    const lista = httpMock.expectOne(`${LOCAL_BASE}?estado=Cerrada&origenPeso=Manual`);
    expect(lista.request.method).toBe('GET');
    lista.flush([]);

    service.obtener('b-local').subscribe();
    const detalle = httpMock.expectOne(`${LOCAL_BASE}/b-local`);
    expect(detalle.request.method).toBe('GET');
    detalle.flush({ id: 'b-local', valores: [] } as unknown as BoletaDto);
  });
});
