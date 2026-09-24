import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NzMessageService } from 'ng-zorro-antd/message';
import { environment } from '../../../environments/environment';
import { BoletaDto } from '../../api/boletas.service';
import { UnidadesEnTransitoPage } from './unidades-en-transito-page';

// Convención de la app: los specs de páginas no hacen `detectChanges()` sobre
// la tabla (los `nz-icon` del semáforo disparan fetch de SVG que `verify()`
// rechaza). Se prueban datos/estado del componente, igual que boletas-page.

const BASE = `${environment.apiUrl}/api/boletas`;
const LISTA_URL = `${BASE}?estado=EnTransito`;

function boleta(parcial: Partial<BoletaDto> = {}): BoletaDto {
  return {
    id: 'b-1',
    numeroBoleta: 'IF-B01-000001',
    basculaId: 'ba-1',
    basculaCodigo: 'B01',
    tipoMovimientoId: 'tm-1',
    tipoMovimientoNombre: 'Ingreso de fruta',
    generaQR: false,
    estado: 'EnTransito',
    estadoSync: 'SincronizadoCentral',
    pesoIngreso: 20000,
    pesoSalida: null,
    pesoNeto: null,
    origenPesoIngreso: 'Bascula',
    origenPesoSalida: null,
    motivoPesoManual: null,
    motivoPesoManualDetalle: null,
    fechaHoraIngreso: '2026-09-10T12:00:00Z',
    fechaHoraSalida: null,
    usuarioIngreso: 'operador',
    usuarioSalida: null,
    usuarioAnula: null,
    usuarioAutoriza: null,
    motivoAnulacion: null,
    fechaHoraAnulacion: null,
    usuarioTrasiego: null,
    fechaHoraTrasiego: null,
    motivoTrasiego: null,
    boletaReemplazoId: null,
    boletaOrigenId: null,
    basculaSalidaId: null,
    preIngresoId: null,
    preIngresoNumeroEnvio: null,
    preIngresoEstado: null,
    marcaPreIngreso: null,
    respuestaD365Id: null,
    creadaOffline: false,
    valores: [],
    ...parcial,
  } as BoletaDto;
}

describe('UnidadesEnTransitoPage', () => {
  let fixture: ComponentFixture<UnidadesEnTransitoPage>;
  let component: UnidadesEnTransitoPage;
  let httpMock: HttpTestingController;
  const message = { error: vi.fn(), success: vi.fn() };
  const modoOriginal = environment.modo;

  beforeEach(async () => {
    (environment as { modo: typeof environment.modo }).modo = 'admin';
    message.error.mockReset();
    vi.useFakeTimers({ now: new Date('2026-09-10T18:00:00Z') });

    await TestBed.configureTestingModule({
      imports: [UnidadesEnTransitoPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: NzMessageService, useValue: message },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UnidadesEnTransitoPage);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    vi.useRealTimers();
    (environment as { modo: typeof environment.modo }).modo = modoOriginal;
  });

  it('carga al construirse vía GET /api/boletas?estado=EnTransito (mismo servicio que boletas-page)', () => {
    const req = httpMock.expectOne(LISTA_URL);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('expone las unidades ordenadas por mayor tiempo transcurrido primero', () => {
    const reciente = boleta({ id: 'n', numeroBoleta: 'N', fechaHoraIngreso: '2026-09-10T17:00:00Z' });
    const vieja = boleta({ id: 'v', numeroBoleta: 'V', fechaHoraIngreso: '2026-09-09T09:00:00Z' });
    httpMock.expectOne(LISTA_URL).flush([reciente, vieja]);

    expect(component.unidades().map((u) => u.boleta.numeroBoleta)).toEqual(['V', 'N']);
    expect(component.unidades()[0].duracionMs).toBe(33 * 3_600_000);
  });

  it('"Actualizar" vuelve a pedir la lista y reemplaza las unidades', () => {
    httpMock.expectOne(LISTA_URL).flush([boleta({ id: 'a' })]);

    component.refrescar();
    const req = httpMock.expectOne(LISTA_URL);
    req.flush([boleta({ id: 'b', numeroBoleta: 'B' }), boleta({ id: 'c', numeroBoleta: 'C' })]);

    expect(component.unidades().map((u) => u.boleta.numeroBoleta)).toEqual(['B', 'C']);
  });

  it('el timer de 60 s avanza el reloj y con eso los tiempos en vivo', () => {
    httpMock.expectOne(LISTA_URL).flush([boleta({ id: 'a', fechaHoraIngreso: '2026-09-10T12:00:00Z' })]);
    expect(component.unidades()[0].duracionMs).toBe(6 * 3_600_000);

    vi.advanceTimersByTime(60_000);

    expect(component.unidades()[0].duracionMs).toBe(6 * 3_600_000 + 60_000);
  });

  it('estado vacío: sin boletas, `vacio()` es true para el mensaje de la plantilla', () => {
    httpMock.expectOne(LISTA_URL).flush([]);

    expect(component.vacio()).toBe(true);
    fixture.detectChanges();
    const texto = fixture.debugElement.nativeElement.textContent as string;
    expect(texto).toContain('No hay unidades en tránsito');
  });

  it('estado de error: avisa y deja visible el mensaje de reintento', () => {
    httpMock.expectOne(LISTA_URL).error(new ErrorEvent('offline'));

    expect(component.error()).toBe(true);
    expect(message.error).toHaveBeenCalled();

    fixture.detectChanges();
    const alerta = fixture.debugElement.query(By.css('[role="alert"]'));
    expect(alerta.nativeElement.textContent).toContain('No se pudo cargar');
  });
});
