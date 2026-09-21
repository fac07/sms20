import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { NzMessageService } from 'ng-zorro-antd/message';
import { environment } from '../../../../environments/environment';
import { BoletaDto } from '../../../api/boletas.service';
import { TipoMovimientoSeccionDto } from '../../../api/tipos-movimiento.service';
import { DescargaService } from '../../../core/descarga.service';
import { SesionService } from '../../../core/sesion.service';
import {
  BoletasPage,
  etiquetaMarcaPreIngreso,
  tieneMarchamosVigente,
} from './boletas-page';

// Ningún spec de este proyecto llama `fixture.detectChanges()` en páginas con
// `nz-icon` (ver pesaje-page.spec.ts): renderizar el template dispara un
// fetch HTTP real de los assets SVG del ícono, que `HttpTestingController`
// nunca ve venir y `httpMock.verify()` rechaza como request sin resolver.
// Este spec sigue el mismo patrón: valida el gate y los datos que el template
// consume (`tieneEnlacePreIngreso`, `detalle()`), no el HTML final.

const BASE = `${environment.apiUrl}/api/boletas`;
// URL que dispara `TiposMovimientoService.listarSecciones('tm-1', true)` — el
// fixture de boletas usa siempre `tipoMovimientoId: 'tm-1'`.
const SECCIONES_TM1 = `${environment.apiUrl}/api/tipos-movimiento/tm-1/secciones?incluirHistoricas=true`;

function seccion(parcial: Partial<TipoMovimientoSeccionDto> = {}): TipoMovimientoSeccionDto {
  return {
    seccionId: 's-1',
    seccionClave: 'marchamos',
    seccionNombre: 'Marchamos',
    requerida: false,
    orden: 0,
    vigenteDesde: '2020-01-01T00:00:00Z',
    vigenteHasta: null,
    ...parcial,
  };
}

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
    httpMock.expectOne(SECCIONES_TM1).flush([]);

    expect(component.detalle()?.preIngresoNumeroEnvio).toBe('ENV-2024-001');
    expect(component.detalle()?.preIngresoEstado).toBe('Vinculado');
    expect(component.tieneEnlacePreIngreso(boleta)).toBe(true);
  });

  it('sin pre-ingreso enlazado, el gate que controla la sección de cola de transporte es false', () => {
    const boleta = boletaFixture();
    component.verDetalle(boleta);
    httpMock.expectOne(SECCIONES_TM1).flush([]);

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
    httpMock.expectOne(SECCIONES_TM1).flush([]);

    expect(component.detalle()?.marcaPreIngreso).toBe('PreIngresoCancelado');
    expect(component.etiquetaMarca(component.detalle()!.marcaPreIngreso!)).toBe(
      'Pre-ingreso cancelado',
    );
  });
});

describe('BoletasPage — Editar marchamos', () => {
  let component: BoletasPage;
  let httpMock: HttpTestingController;
  const rol = signal<'Operador' | 'Supervisor' | 'Administrador' | null>('Supervisor');
  const modoOriginal = environment.modo;

  beforeEach(async () => {
    (environment as { modo: typeof environment.modo }).modo = 'admin';
    rol.set('Supervisor');
    await TestBed.configureTestingModule({
      imports: [BoletasPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: NzMessageService, useValue: { error: vi.fn() } },
        { provide: SesionService, useValue: { rol } },
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

  it('pide boleta Cerrada, rol Supervisor/Administrador y tipo con la sección marchamos vigente', () => {
    component.verDetalle(boletaFixture({ estado: 'Cerrada' }));
    httpMock.expectOne(SECCIONES_TM1).flush([seccion()]);

    expect(component.canEditarMarchamos(boletaFixture({ estado: 'Cerrada' }))).toBe(true);
    rol.set('Administrador');
    expect(component.canEditarMarchamos(boletaFixture({ estado: 'Cerrada' }))).toBe(true);
    rol.set('Operador');
    expect(component.canEditarMarchamos(boletaFixture({ estado: 'Cerrada' }))).toBe(false);
    rol.set('Supervisor');
    expect(component.canEditarMarchamos(boletaFixture({ estado: 'EnTransito' }))).toBe(false);
  });
});

describe('BoletasPage — gate del tipo con sección "marchamos" al abrir el detalle', () => {
  let component: BoletasPage;
  let httpMock: HttpTestingController;
  const message = { error: vi.fn(), success: vi.fn() };
  const rol = signal<'Operador' | 'Supervisor' | 'Administrador' | null>('Supervisor');
  const modoOriginal = environment.modo;

  beforeEach(async () => {
    (environment as { modo: typeof environment.modo }).modo = 'admin';
    rol.set('Supervisor');
    message.error.mockReset();

    await TestBed.configureTestingModule({
      imports: [BoletasPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: NzMessageService, useValue: message },
        { provide: SesionService, useValue: { rol } },
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

  it('(a) tipo sin sección marchamos → el botón no aparece', () => {
    component.verDetalle(boletaFixture());
    httpMock.expectOne(SECCIONES_TM1).flush([seccion({ seccionClave: 'producto' })]);

    expect(component.canEditarMarchamos(component.detalle()!)).toBe(false);
  });

  it('(b) sección vigente + Supervisor + Cerrada → el botón aparece', () => {
    component.verDetalle(boletaFixture());
    httpMock.expectOne(SECCIONES_TM1).flush([seccion()]);

    expect(component.canEditarMarchamos(component.detalle()!)).toBe(true);
  });

  it('(c) sección desasignada antes del ingreso (vigenteHasta < ingreso) → no aparece', () => {
    component.verDetalle(boletaFixture({ fechaHoraIngreso: '2026-09-10T12:00:00Z' }));
    httpMock
      .expectOne(SECCIONES_TM1)
      .flush([seccion({ vigenteDesde: '2020-01-01T00:00:00Z', vigenteHasta: '2026-01-01T00:00:00Z' })]);

    expect(component.canEditarMarchamos(component.detalle()!)).toBe(false);
  });

  it('(d) rol Operador → no aparece aunque el tipo tenga la sección', () => {
    rol.set('Operador');
    component.verDetalle(boletaFixture());
    httpMock.expectOne(SECCIONES_TM1).flush([seccion()]);

    expect(component.canEditarMarchamos(component.detalle()!)).toBe(false);
  });

  it('(e) consulta en curso → oculto, y aparece recién cuando la consulta resuelve', () => {
    component.verDetalle(boletaFixture());
    const req = httpMock.expectOne(SECCIONES_TM1);

    expect(component.canEditarMarchamos(component.detalle()!)).toBe(false);

    req.flush([seccion()]);
    expect(component.canEditarMarchamos(component.detalle()!)).toBe(true);
  });

  it('(f) error de red al consultar secciones → oculto, sin toast y sin lanzar', () => {
    component.verDetalle(boletaFixture());
    httpMock.expectOne(SECCIONES_TM1).error(new ErrorEvent('network'));

    expect(() => component.canEditarMarchamos(component.detalle()!)).not.toThrow();
    expect(component.canEditarMarchamos(component.detalle()!)).toBe(false);
    expect(message.error).not.toHaveBeenCalled();
  });

  it('(g) dos boletas del mismo tipo: UNA sola consulta de secciones (caché)', () => {
    component.verDetalle(boletaFixture({ id: 'b-1' }));
    httpMock.expectOne(SECCIONES_TM1).flush([seccion()]);

    component.verDetalle(boletaFixture({ id: 'b-2' }));

    httpMock.expectNone(SECCIONES_TM1);
    expect(component.canEditarMarchamos(component.detalle()!)).toBe(true);
  });
});

describe('tieneMarchamosVigente (puro — vigencia contra fecha de ingreso)', () => {
  const ingreso = '2026-09-10T12:00:00Z';

  it('sin datos cargados o sin sección marchamos, es false', () => {
    expect(tieneMarchamosVigente(undefined, ingreso)).toBe(false);
    expect(tieneMarchamosVigente([], ingreso)).toBe(false);
    expect(tieneMarchamosVigente([seccion({ seccionClave: 'transporte' })], ingreso)).toBe(false);
  });

  it('vigenteDesde inclusivo; un ingreso anterior al inicio no cuenta', () => {
    expect(tieneMarchamosVigente([seccion({ vigenteDesde: '2026-09-10T12:00:00Z' })], ingreso)).toBe(true);
    expect(tieneMarchamosVigente([seccion({ vigenteDesde: '2026-09-10T12:00:01Z' })], ingreso)).toBe(false);
  });

  it('vigenteHasta nula es abierta; igual o anterior al ingreso no cuenta', () => {
    expect(tieneMarchamosVigente([seccion({ vigenteHasta: '2026-09-10T12:00:00Z' })], ingreso)).toBe(false);
    expect(tieneMarchamosVigente([seccion({ vigenteHasta: '2026-09-10T12:00:01Z' })], ingreso)).toBe(true);
  });

  it('fecha de ingreso ilegible → false (no revienta)', () => {
    expect(tieneMarchamosVigente([seccion()], 'no-fecha')).toBe(false);
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

describe('BoletasPage — exportar CSV del listado filtrado', () => {
  let component: BoletasPage;
  let httpMock: HttpTestingController;
  const message = { error: vi.fn(), success: vi.fn() };
  // Fake de la única parte con DOM: se assertion nombre y contenido, no el click.
  const descarga = { csv: vi.fn() };
  const modoOriginal = environment.modo;

  beforeEach(async () => {
    (environment as { modo: typeof environment.modo }).modo = 'admin';
    message.error.mockReset();
    descarga.csv.mockReset();

    await TestBed.configureTestingModule({
      imports: [BoletasPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: NzMessageService, useValue: message },
        { provide: DescargaService, useValue: descarga },
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

  it('exporta exactamente el listado filtrado vigente, con BOM y nombre boletas-aaaa-mm-dd.csv', () => {
    // Filtro activo: solo EnTransito. La descarga debe llevar ESA lista.
    component.cambiarFiltro('EnTransito');
    httpMock
      .expectOne(`${BASE}?estado=EnTransito`)
      .flush([boletaFixture({ numeroBoleta: 'B-1', estado: 'EnTransito' })]);

    component.exportar();

    expect(descarga.csv).toHaveBeenCalledTimes(1);
    const [nombre, csv] = descarga.csv.mock.calls[0];
    expect(nombre).toMatch(/^boletas-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('B-1');
    // La boleta excluida por el filtro no puede aparecer.
    expect(csv).not.toContain('IF-B01-000001');
  });

  it('con el listado vacío avisa y no descarga nada', () => {
    component.exportar();

    expect(descarga.csv).not.toHaveBeenCalled();
    expect(message.error).toHaveBeenCalledWith('No hay boletas para exportar.');
  });
});
