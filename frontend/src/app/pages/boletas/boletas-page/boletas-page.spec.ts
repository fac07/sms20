import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { NzMessageService } from 'ng-zorro-antd/message';
import { environment } from '../../../../environments/environment';
import { BoletaDto } from '../../../api/boletas.service';
import { BoletasPage, etiquetaMarcaPreIngreso } from './boletas-page';

// Ningún spec de este proyecto llama `fixture.detectChanges()` en páginas con
// `nz-icon` (ver pesaje-page.spec.ts): renderizar el template dispara un
// fetch HTTP real de los assets SVG del ícono, que `HttpTestingController`
// nunca ve venir y `httpMock.verify()` rechaza como request sin resolver.
// Este spec sigue el mismo patrón: valida el gate y los datos que el template
// consume (`tieneEnlacePreIngreso`, `detalle()`), no el HTML final.

const BASE = `${environment.apiUrl}/api/boletas`;

function boletaFixture(parcial: Partial<BoletaDto> = {}): BoletaDto {
  return {
    id: 'b-1',
    numeroBoleta: 'IF-B01-000001',
    basculaId: 'ba-1',
    basculaCodigo: 'B01',
    tipoMovimientoId: 'tm-1',
    tipoMovimientoNombre: 'Ingreso de fruta',
    estado: 'Cerrada',
    estadoSync: 'SincronizadoCentral',
    pesoIngreso: 20000,
    pesoSalida: 3000,
    pesoNeto: 17000,
    origenPesoIngreso: 'Bascula',
    origenPesoSalida: 'Bascula',
    motivoPesoManual: null,
    motivoPesoManualDetalle: null,
    fechaHoraIngreso: '2026-09-10T12:00:00Z',
    fechaHoraSalida: '2026-09-10T13:00:00Z',
    usuarioIngreso: 'operador',
    usuarioSalida: 'operador',
    usuarioAnula: null,
    usuarioAutoriza: null,
    motivoAnulacion: null,
    fechaHoraAnulacion: null,
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
  };
}

describe('etiquetaMarcaPreIngreso (helper de la marca de revisión, cola-transporte slice 6)', () => {
  it('traduce las 2 marcas conocidas del enum central MarcaPreIngreso', () => {
    expect(etiquetaMarcaPreIngreso('PreIngresoCancelado')).toBe('Pre-ingreso cancelado');
    expect(etiquetaMarcaPreIngreso('VinculoRechazado')).toBe('Vínculo rechazado');
  });
});

describe('BoletasPage — detalle de consulta (cola-transporte slice 6)', () => {
  let component: BoletasPage;
  let httpMock: HttpTestingController;
  const message = { error: vi.fn(), success: vi.fn() };
  const modoOriginal = environment.modo;

  beforeEach(async () => {
    (environment as { modo: typeof environment.modo }).modo = 'admin';
    message.error.mockReset();

    await TestBed.configureTestingModule({
      imports: [BoletasPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: NzMessageService, useValue: message },
      ],
    }).compileComponents();

    component = TestBed.createComponent(BoletasPage).componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    httpMock.expectOne(BASE).flush([]);
  });

  afterEach(() => {
    httpMock.verify();
    (environment as { modo: typeof environment.modo }).modo = modoOriginal;
  });

  it('el detalle expone el número de envío y el estado del pre-ingreso enlazado — lo que el template interpola', () => {
    const boleta = boletaFixture({
      preIngresoId: 'pre-1',
      preIngresoNumeroEnvio: 'ENV-2024-001',
      preIngresoEstado: 'Vinculado',
    });
    component.verDetalle(boleta);

    expect(component.detalle()?.preIngresoNumeroEnvio).toBe('ENV-2024-001');
    expect(component.detalle()?.preIngresoEstado).toBe('Vinculado');
    expect(component.tieneEnlacePreIngreso(boleta)).toBe(true);
  });

  it('sin pre-ingreso enlazado, el gate que controla la sección de cola de transporte es false', () => {
    const boleta = boletaFixture();
    component.verDetalle(boleta);

    expect(component.tieneEnlacePreIngreso(boleta)).toBe(false);
  });

  it('la marca de revisión "pre-ingreso cancelado" queda en el detalle para la sección de marcador', () => {
    const boleta = boletaFixture({
      preIngresoId: 'pre-1',
      preIngresoNumeroEnvio: 'ENV-2024-001',
      preIngresoEstado: 'Cancelado',
      marcaPreIngreso: 'PreIngresoCancelado',
    });
    component.verDetalle(boleta);

    expect(component.detalle()?.marcaPreIngreso).toBe('PreIngresoCancelado');
    expect(component.etiquetaMarca(component.detalle()!.marcaPreIngreso!)).toBe(
      'Pre-ingreso cancelado',
    );
  });
});
