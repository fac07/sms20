import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { NzMessageService } from 'ng-zorro-antd/message';
import { Bascula } from '../../../api/basculas.service';
import { environment } from '../../../../environments/environment';
import { BasculasPage, estadoDeConexion } from './basculas-page';

const CENTRAL = environment.apiUrl;
const MIN = 60_000;

function bascula(parcial: Partial<Bascula> & Pick<Bascula, 'id'>): Bascula {
  return {
    codigo: 'B01',
    nombre: 'Báscula 1',
    centroId: 'c-1',
    centroNombre: 'Planta',
    tipoConexion: 'Serial',
    puerto: 'COM1',
    ip: null,
    puertoTcp: null,
    velocidad: 9600,
    bitsDatos: 8,
    modoComunicacion: 'STX',
    activa: true,
    aprovisionada: true,
    tieneCodigoVigente: false,
    ultimaConexion: null,
    ...parcial,
  };
}

describe('estadoDeConexion (helper puro)', () => {
  const ahora = Date.parse('2026-09-15T12:00:00Z');
  const hace = (ms: number) => new Date(ahora - ms).toISOString();

  it('null es gris "Sin datos" (nunca pingueó desde la instrumentación)', () => {
    expect(estadoDeConexion(null, ahora)).toEqual({ color: 'default', etiqueta: 'Sin datos' });
  });

  it('menos de 5 minutos es verde', () => {
    expect(estadoDeConexion(hace(2 * MIN), ahora).color).toBe('success');
    expect(estadoDeConexion(hace(2 * MIN), ahora).etiqueta).toBe('hace 2 min');
  });

  it('los 5 minutos exactos cruzan a amarillo (umbral inclusivo)', () => {
    expect(estadoDeConexion(hace(5 * MIN), ahora).color).toBe('warning');
  });

  it('de 5 a menos de 60 minutos es amarillo', () => {
    expect(estadoDeConexion(hace(59 * MIN), ahora)).toEqual({
      color: 'warning',
      etiqueta: 'hace 59 min',
    });
  });

  it('los 60 minutos exactos cruzan a rojo (umbral inclusivo)', () => {
    expect(estadoDeConexion(hace(60 * MIN), ahora).color).toBe('error');
  });

  it('≥1 hora muestra horas; ≥2 días muestra días', () => {
    expect(estadoDeConexion(hace(3 * 60 * MIN), ahora)).toEqual({
      color: 'error',
      etiqueta: 'hace 3 h',
    });
    expect(estadoDeConexion(hace(3 * 24 * 60 * MIN), ahora)).toEqual({
      color: 'error',
      etiqueta: 'hace 3 días',
    });
  });

  it('menos de un minuto o timestamp a futuro (reloj desfasado) es "hace instantes"', () => {
    expect(estadoDeConexion(hace(30_000), ahora)).toEqual({
      color: 'success',
      etiqueta: 'hace instantes',
    });
    expect(estadoDeConexion(new Date(ahora + 10 * MIN).toISOString(), ahora)).toEqual({
      color: 'success',
      etiqueta: 'hace instantes',
    });
  });
});

describe('BasculasPage — columna Última conexión (TestBed + HttpTestingController)', () => {
  let httpMock: HttpTestingController;
  const message = { error: vi.fn(), success: vi.fn() };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BasculasPage],
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
    vi.restoreAllMocks();
  });

  function crear(basculas: Bascula[]) {
    const fixture = TestBed.createComponent(BasculasPage);
    httpMock.expectOne(`${CENTRAL}/api/basculas?incluirInactivas=true`).flush(basculas);
    httpMock
      .expectOne(`${CENTRAL}/api/maestros?tipoCatalogo=Centro&incluirInactivos=false`)
      .flush([]);
    return fixture;
  }

  // Sin fixture.detectChanges() — convención del proyecto para páginas con
  // nz-icon (ver el comentario al pie de boletas-page.spec.ts): se valida la
  // API del componente que el template consume, no el HTML final.
  it('badgea la antigüedad del último ping con los umbrales aprobados', () => {
    const ahora = Date.parse('2026-09-15T12:00:00Z');
    vi.spyOn(Date, 'now').mockReturnValue(ahora);
    const component = crear([
      bascula({ id: 'b1', codigo: 'B01', ultimaConexion: new Date(ahora - 2 * MIN).toISOString() }),
      bascula({ id: 'b2', codigo: 'B02', ultimaConexion: new Date(ahora - 90 * MIN).toISOString() }),
      bascula({ id: 'b3', codigo: 'B03', ultimaConexion: null }),
    ]).componentInstance;

    expect(component.conexion(component.basculas()[0])).toEqual({
      color: 'success',
      etiqueta: 'hace 2 min',
    });
    expect(component.conexion(component.basculas()[1])).toEqual({
      color: 'error',
      etiqueta: 'hace 1 h',
    });
    expect(component.conexion(component.basculas()[2])).toEqual({
      color: 'default',
      etiqueta: 'Sin datos',
    });
  });
});
