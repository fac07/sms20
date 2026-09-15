import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { NzMessageService } from 'ng-zorro-antd/message';
import { environment } from '../../../../environments/environment';
import { ResumenBasculaDia } from '../../../api/reportes.service';
import {
  ResumenBasculasPage,
  agruparPorBascula,
  fechaHaceDias,
  formatearFechaLocal,
  totalGeneral,
} from './resumen-basculas-page';

const CENTRAL = environment.apiUrl;

function fila(parcial: Partial<ResumenBasculaDia> & Pick<ResumenBasculaDia, 'basculaId'>): ResumenBasculaDia {
  return {
    basculaNombre: 'Báscula',
    fecha: '2026-09-10',
    cantidadBoletas: 1,
    pesoNetoTotal: 100,
    ...parcial,
  };
}

describe('helpers puros del resumen de básculas', () => {
  it('formatearFechaLocal usa el calendario local, no el UTC (sin off-by-one)', () => {
    // 2026-09-05 23:30 local: un toISOString() daría 06 (día corrido).
    expect(formatearFechaLocal(new Date(2026, 8, 5, 23, 30))).toBe('2026-09-05');
    expect(formatearFechaLocal(new Date(2026, 0, 1))).toBe('2026-01-01');
  });

  it('fechaHaceDias retrocede en el calendario local', () => {
    expect(fechaHaceDias(6, new Date(2026, 8, 15))).toBe('2026-09-09');
    expect(fechaHaceDias(0, new Date(2026, 8, 15))).toBe('2026-09-15');
    // Cruza el borde de mes sin corrimientos de zona.
    expect(fechaHaceDias(1, new Date(2026, 8, 1))).toBe('2026-08-31');
  });

  it('agruparPorBascula intercala subtotales por báscula preservando el orden', () => {
    const filas = [
      fila({ basculaId: 'A', basculaNombre: 'A1', fecha: '2026-09-10', cantidadBoletas: 2, pesoNetoTotal: 800 }),
      fila({ basculaId: 'A', basculaNombre: 'A1', fecha: '2026-09-11', cantidadBoletas: 1, pesoNetoTotal: 100 }),
      fila({ basculaId: 'B', basculaNombre: 'B2', fecha: '2026-09-10', cantidadBoletas: 3, pesoNetoTotal: 900 }),
    ];

    const filasTabla = agruparPorBascula(filas);

    expect(filasTabla.map((f) => f.tipo)).toEqual(['dia', 'dia', 'subtotal', 'dia', 'subtotal']);
    const subtotalA = filasTabla[2];
    if (subtotalA.tipo !== 'subtotal') throw new Error('esperado subtotal');
    expect(subtotalA.cantidadBoletas).toBe(3);
    expect(subtotalA.pesoNetoTotal).toBe(900);
    expect(subtotalA.basculaNombre).toBe('A1');
  });

  it('totalGeneral suma boletas y netos de toda la consulta', () => {
    const total = totalGeneral([
      fila({ basculaId: 'A', cantidadBoletas: 2, pesoNetoTotal: 800 }),
      fila({ basculaId: 'B', cantidadBoletas: 3, pesoNetoTotal: 900 }),
    ]);
    expect(total).toEqual({ cantidadBoletas: 5, pesoNetoTotal: 1700 });
  });

  it('totalGeneral de lista vacía es cero, no NaN', () => {
    expect(totalGeneral([])).toEqual({ cantidadBoletas: 0, pesoNetoTotal: 0 });
  });
});

describe('ResumenBasculasPage (TestBed + HttpTestingController)', () => {
  let httpMock: HttpTestingController;
  const message = { error: vi.fn(), success: vi.fn(), warning: vi.fn() };

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 15, 10, 0)); // 15-sep-2026 local

    await TestBed.configureTestingModule({
      imports: [ResumenBasculasPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: NzMessageService, useValue: message },
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function crear(): ResumenBasculasPage {
    return TestBed.createComponent(ResumenBasculasPage).componentInstance;
  }

  it('al iniciar pide por default los últimos 7 días (inclusive hoy)', () => {
    const component = crear();

    httpMock
      .expectOne(`${CENTRAL}/api/reportes/resumen-basculas?desde=2026-09-09&hasta=2026-09-15`)
      .flush([fila({ basculaId: 'A' })]);

    expect(component.filas().length).toBe(2); // 1 día + su subtotal
    expect(component.total()).toEqual({ cantidadBoletas: 1, pesoNetoTotal: 100 });
    expect(component.desde()).toBe('2026-09-09');
    expect(component.hasta()).toBe('2026-09-15');
  });

  it('generar con un rango personalizado re-consulta', () => {
    const component = crear();
    httpMock.expectOne(`${CENTRAL}/api/reportes/resumen-basculas?desde=2026-09-09&hasta=2026-09-15`).flush([]);

    component.desde.set('2026-09-01');
    component.hasta.set('2026-09-05');
    component.generar();

    httpMock
      .expectOne(`${CENTRAL}/api/reportes/resumen-basculas?desde=2026-09-01&hasta=2026-09-05`)
      .flush([]);
    expect(message.error).not.toHaveBeenCalled();
  });

  it('hasta anterior a desde avisa y no dispara la consulta', () => {
    const component = crear();
    httpMock.expectOne(`${CENTRAL}/api/reportes/resumen-basculas?desde=2026-09-09&hasta=2026-09-15`).flush([]);

    component.desde.set('2026-09-20');
    component.hasta.set('2026-09-10');
    component.generar();

    expect(message.warning).toHaveBeenCalled();
    httpMock.expectNone(`${CENTRAL}/api/reportes/resumen-basculas?desde=2026-09-20&hasta=2026-09-10`);
  });

  it('una fecha incompleta avisa y no dispara la consulta', () => {
    const component = crear();
    httpMock.expectOne(`${CENTRAL}/api/reportes/resumen-basculas?desde=2026-09-09&hasta=2026-09-15`).flush([]);

    component.desde.set('');
    component.generar();

    expect(message.warning).toHaveBeenCalled();
    httpMock.expectNone(`${CENTRAL}/api/reportes/resumen-basculas?desde=&hasta=2026-09-15`);
  });

  it('un error HTTP muestra el mensaje y deja la tabla vacía', () => {
    const component = crear();
    httpMock
      .expectOne(`${CENTRAL}/api/reportes/resumen-basculas?desde=2026-09-09&hasta=2026-09-15`)
      .error(new ErrorEvent('network'));

    expect(message.error).toHaveBeenCalled();
    expect(component.filas()).toEqual([]);
    expect(component.cargando()).toBe(false);
  });
});
