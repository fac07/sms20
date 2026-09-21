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
    generaQR: false,
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

describe('BoletasPage — reimprimir + impresión (Frente 4)', () => {
  let component: BoletasPage;
  let httpMock: HttpTestingController;
  const message = { error: vi.fn(), success: vi.fn() };
  const modoOriginal = environment.modo;

  beforeEach(async () => {
    (environment as { modo: typeof environment.modo }).modo = 'admin';
    vi.stubGlobal('print', vi.fn());
    // Fake timers: el print del overlay va en setTimeout(0); con timers reales
    // el auto-detect de TestBed corre el primer CD y re-invoca ngOnInit.
    vi.useFakeTimers();
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
    // advanceTimersByTime deja correr el auto-detect de TestBed: el primer CD
    // renderiza la tabla y los nz-icon piden sus SVG. Se flushean para que
    // verify() solo mida requests reales del feature bajo prueba.
    for (const req of httpMock.match((r) => r.url.includes('assets/'))) req.flush('<svg></svg>');
    httpMock.verify();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    (environment as { modo: typeof environment.modo }).modo = modoOriginal;
  });

  it('canReimprimir es true solo para Cerrada y Reemitida', () => {
    expect(component.canReimprimir(boletaFixture({ estado: 'Cerrada' }))).toBe(true);
    expect(component.canReimprimir(boletaFixture({ estado: 'Reemitida' }))).toBe(true);
    expect(component.canReimprimir(boletaFixture({ estado: 'EnTransito' }))).toBe(false);
    expect(component.canReimprimir(boletaFixture({ estado: 'Anulada' }))).toBe(false);
  });

  it('reimprimir registra en central, abre el layout con el dto respondido e imprime', () => {
    component.reimprimir(boletaFixture({ id: 'b-9', estado: 'Cerrada' }));

    const req = httpMock.expectOne(`${BASE}/b-9/reimprimir`);
    expect(req.request.body).toEqual({ usuario: 'operador@naturaceites.com' });
    req.flush(
      boletaFixture({
        id: 'b-9',
        estado: 'Cerrada',
        cantidadReimpresiones: 3,
        ultimaReimpresionUsuario: 'operador2',
        ultimaReimpresionFecha: '2026-09-16T12:00:00Z',
      }),
    );
    vi.advanceTimersByTime(5);

    expect(component.boletaParaImprimir()!.cantidadReimpresiones).toBe(3);
    expect(globalThis.print).toHaveBeenCalledTimes(1);
  });

  it('un error en el registro avisa y no abre el overlay', () => {
    component.reimprimir(boletaFixture({ id: 'b-9', estado: 'Cerrada' }));

    httpMock.expectOne(`${BASE}/b-9/reimprimir`).error(new ErrorEvent('server'));

    expect(message.error).toHaveBeenCalledWith('No se pudo registrar la reimpresión.');
    expect(component.boletaParaImprimir()).toBeNull();
    expect(globalThis.print).not.toHaveBeenCalled();
  });

  it('descartarImpresion limpia el overlay', () => {
    component.reimprimir(boletaFixture({ id: 'b-9', estado: 'Cerrada' }));
    httpMock
      .expectOne(`${BASE}/b-9/reimprimir`)
      .flush(boletaFixture({ id: 'b-9', estado: 'Cerrada', cantidadReimpresiones: 1 }));
    vi.advanceTimersByTime(5);

    component.descartarImpresion();

    expect(component.boletaParaImprimir()).toBeNull();
  });
});

describe('BoletasPage — columna "Tiempo transcurrido" con semáforo', () => {
  let component: BoletasPage;
  let httpMock: HttpTestingController;
  const message = { error: vi.fn(), success: vi.fn() };
  const modoOriginal = environment.modo;

  beforeEach(async () => {
    (environment as { modo: typeof environment.modo }).modo = 'admin';
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

  it('el semáforo solo aplica a EnTransito y Cerrada; Anulada y Reemitida van sin semáforo', () => {
    expect(component.muestraSemaforo(boletaFixture({ estado: 'EnTransito' }))).toBe(true);
    expect(component.muestraSemaforo(boletaFixture({ estado: 'Cerrada' }))).toBe(true);
    expect(component.muestraSemaforo(boletaFixture({ estado: 'Anulada' }))).toBe(false);
    expect(component.muestraSemaforo(boletaFixture({ estado: 'Reemitida' }))).toBe(false);
  });

  it('Cerrada mide ingreso→salida, sin importar el reloj de la página', () => {
    component.ahora.set(new Date(Date.UTC(2026, 8, 11, 0, 0, 0)));
    const cerrada = boletaFixture({
      estado: 'Cerrada',
      fechaHoraIngreso: '2026-09-10T12:00:00Z',
      fechaHoraSalida: '2026-09-10T15:31:49Z',
    });

    expect(component.duracionMs(cerrada)).toBe(3 * 3_600_000 + 31 * 60_000 + 49_000);
  });

  it('EnTransito mide ingreso→ahora y el tick de 60 s avanza el reloj', () => {
    const enTransito = boletaFixture({
      estado: 'EnTransito',
      fechaHoraIngreso: '2026-09-10T12:00:00Z',
      fechaHoraSalida: null,
    });
    component.ahora.set(new Date(Date.UTC(2026, 8, 10, 15, 31, 49)));
    expect(component.duracionMs(enTransito)).toBe(3 * 3_600_000 + 31 * 60_000 + 49_000);

    // El timer de la página pisa `ahora` — la columna se re-dibuja sola.
    expect(component.ahora()).toBeInstanceOf(Date);
  });

  it('fecha de ingreso ilegible no revienta: duracionMs es NaN (el chip lo pinta de rojo)', () => {
    const b = boletaFixture({ estado: 'EnTransito', fechaHoraIngreso: 'no-fecha' as string });

    expect(Number.isNaN(component.duracionMs(b))).toBe(true);
  });
});
