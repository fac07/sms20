import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { NzMessageService } from 'ng-zorro-antd/message';
import { environment } from '../../../environments/environment';
import { routes } from '../../app.routes';
import { Maestro, TipoCatalogo } from '../../api/maestros.service';
import { PreIngreso } from '../../api/preingresos.service';
import { formatearAntiguedad, PreingresoColaPage } from './preingreso-cola-page';

const CENTRAL = environment.apiUrl;

function centro(id: string, nombre: string): Maestro {
  return {
    id,
    tipoCatalogo: 'Centro' as TipoCatalogo,
    codigo: id,
    nombre,
    datosAdicionales: null,
    estado: 'Oficial',
    fusionadoConId: null,
    fechaModificacion: '',
    activo: true,
  };
}

function preingreso(id: string, estado: PreIngreso['estado'] = 'Pendiente'): PreIngreso {
  return {
    id,
    centroId: 'centro-1',
    pilotoId: null,
    transportistaId: null,
    equipoId: null,
    regionId: null,
    fincaId: null,
    numeroEnvio: `ENV-${id}`,
    pesoEnviado: 20000,
    racimos: null,
    sacos: null,
    estado,
    boletaId: null,
    usuarioCreacion: 'admin@naturaceites.com',
    usuarioCancela: null,
    motivoCancelacion: null,
    fechaCreacion: '2026-09-15T10:00:00Z',
    fechaModificacion: '2026-09-15T10:00:00Z',
  };
}

describe('PreingresoColaPage', () => {
  let httpMock: HttpTestingController;
  const message = { error: vi.fn() };

  beforeEach(async () => {
    message.error.mockReset();
    await TestBed.configureTestingModule({
      imports: [PreingresoColaPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: NzMessageService, useValue: message },
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.useRealTimers();
    httpMock.verify();
  });

  it('solicita y muestra exclusivamente la cola Pendiente', () => {
    const fixture = TestBed.createComponent(PreingresoColaPage);

    httpMock.expectOne(`${CENTRAL}/api/preingresos?estado=Pendiente`).flush([
      preingreso('pendiente'),
      preingreso('vinculado', 'Vinculado'),
      preingreso('cancelado', 'Cancelado'),
    ]);
    httpMock
      .expectOne(`${CENTRAL}/api/maestros?tipoCatalogo=Centro&incluirInactivos=false`)
      .flush([centro('centro-1', 'Centro Norte')]);

    expect(fixture.componentInstance.preingresos().map((p) => p.id)).toEqual(['pendiente']);
  });

  it('recarga la cola Pendiente escopada por el centro elegido', () => {
    const fixture = TestBed.createComponent(PreingresoColaPage);
    httpMock.expectOne(`${CENTRAL}/api/preingresos?estado=Pendiente`).flush([]);
    httpMock
      .expectOne(`${CENTRAL}/api/maestros?tipoCatalogo=Centro&incluirInactivos=false`)
      .flush([centro('centro-1', 'Centro Norte')]);

    fixture.componentInstance.filtrarPorCentro('centro-1');

    httpMock
      .expectOne(`${CENTRAL}/api/preingresos?centroId=centro-1&estado=Pendiente`)
      .flush([preingreso('pendiente')]);
    expect(fixture.componentInstance.preingresos().map((p) => p.id)).toEqual(['pendiente']);
  });

  it('actualiza la antigüedad cada minuto mientras la vista está abierta y detiene el reloj al destruirse', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T12:15:00Z'));
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const fixture = TestBed.createComponent(PreingresoColaPage);
    httpMock.expectOne(`${CENTRAL}/api/preingresos?estado=Pendiente`).flush([]);
    httpMock
      .expectOne(`${CENTRAL}/api/maestros?tipoCatalogo=Centro&incluirInactivos=false`)
      .flush([]);

    expect(fixture.componentInstance.antiguedad('2026-09-15T12:14:30Z')).toBe('0m');
    const indiceReloj = intervalSpy.mock.calls.findIndex(([, intervalo]) => intervalo === 60_000);
    expect(indiceReloj).toBeGreaterThanOrEqual(0);
    const relojId = intervalSpy.mock.results[indiceReloj].value;

    vi.advanceTimersByTime(60_000);

    expect(fixture.componentInstance.antiguedad('2026-09-15T12:14:30Z')).toBe('1m');
    fixture.destroy();
    expect(clearIntervalSpy).toHaveBeenCalledWith(relojId);
  });
});

describe('formatearAntiguedad', () => {
  const ahora = new Date('2026-09-15T12:15:00Z');

  it.each([
    ['2026-09-15T12:14:30Z', '0m'],
    ['2026-09-15T10:00:00Z', '2h 15m'],
    ['2026-09-15T10:00:00', '2h 15m'],
    ['2026-09-14T10:00:00Z', '1d 2h'],
    ['2026-09-15T12:16:00Z', '0m'],
  ])('formatea %s como %s', (fechaCreacion, esperado) => {
    expect(formatearAntiguedad(fechaCreacion, ahora)).toBe(esperado);
  });
});

describe('app.routes — /preingreso/cola requiere modo admin', () => {
  it('registra la vista de lectura bajo el shell', () => {
    const hijos = routes.find((r) => r.path === '' && r.children)?.children ?? [];
    const ruta = hijos.find((r) => r.path === 'preingreso/cola');

    expect(ruta?.component).toBe(PreingresoColaPage);
    expect(ruta?.data?.['modo']).toBe('admin');
    expect(ruta?.canActivate).toBeDefined();
  });
});
