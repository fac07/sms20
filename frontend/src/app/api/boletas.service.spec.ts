import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { BoletaDto, BoletasService } from './boletas.service';
import { ValorCampoLeidoDto } from './configuracion.models';

const BASE = 'http://localhost:5094/api/boletas';

describe('BoletasService', () => {
  let service: BoletasService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
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
});
