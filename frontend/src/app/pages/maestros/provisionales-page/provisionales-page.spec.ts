import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { NzMessageService } from 'ng-zorro-antd/message';
import { Maestro, TipoCatalogo } from '../../../api/maestros.service';
import { AprobarDialog } from '../dialogs/aprobar-dialog';
import { FusionarDialog } from '../dialogs/fusionar-dialog';
import { ProvisionalesPage } from './provisionales-page';
import { basculaDeCodigoProvisional, buscarSimilar } from './similares';

const CENTRAL = 'http://localhost:5094';

function maestro(parcial: Partial<Maestro> & Pick<Maestro, 'id'>): Maestro {
  return {
    tipoCatalogo: 'Piloto' as TipoCatalogo,
    codigo: 'PROV-B01-1',
    nombre: 'Sin nombre',
    datosAdicionales: null,
    estado: 'Provisional',
    fusionadoConId: null,
    fechaModificacion: '',
    activo: true,
    ...parcial,
  };
}

describe('similares (helpers puros)', () => {
  it('basculaDeCodigoProvisional extrae el código de báscula, cae a "—"', () => {
    expect(basculaDeCodigoProvisional('PROV-B02-7')).toBe('B02');
    expect(basculaDeCodigoProvisional('P-001')).toBe('—');
  });

  it('buscarSimilar cruza acentos/caso en el mismo tipo e ignora otros tipos y a sí mismo', () => {
    const objetivo = maestro({ id: 'p1', nombre: 'Juan  Perez', tipoCatalogo: 'Piloto' });
    expect(
      buscarSimilar(objetivo, [
        objetivo,
        maestro({ id: 'x', nombre: 'Juán Pérez', tipoCatalogo: 'Transportista', estado: 'Oficial' }),
        maestro({ id: 'o1', nombre: 'Juán Pérez', tipoCatalogo: 'Piloto', estado: 'Oficial' }),
      ]),
    ).toEqual({ nombre: 'Juán Pérez', estado: 'Oficial' });
  });
});

describe('ProvisionalesPage (TestBed + HttpTestingController)', () => {
  let httpMock: HttpTestingController;
  const message = { error: vi.fn(), success: vi.fn() };

  beforeEach(async () => {
    message.error.mockReset();
    message.success.mockReset();
    await TestBed.configureTestingModule({
      imports: [ProvisionalesPage],
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

  function crear(provisionales: Maestro[], universo?: Maestro[]) {
    const fixture = TestBed.createComponent(ProvisionalesPage);
    httpMock
      .expectOne(`${CENTRAL}/api/maestros?estado=Provisional&incluirInactivos=false`)
      .flush(provisionales);
    httpMock
      .expectOne(`${CENTRAL}/api/maestros?incluirInactivos=false`)
      .flush(universo ?? provisionales);
    return fixture.componentInstance;
  }

  it('lista todos los provisionales de cualquier tipo en una sola cola', () => {
    const component = crear([
      maestro({ id: 'p1', tipoCatalogo: 'Piloto', codigo: 'PROV-B01-1', nombre: 'Ana' }),
      maestro({ id: 'p2', tipoCatalogo: 'Finca', codigo: 'PROV-B02-3', nombre: 'La Loma' }),
      maestro({ id: 'p3', tipoCatalogo: 'Transportista', codigo: 'PROV-B01-4', nombre: 'TransSur' }),
    ]);

    expect(component.filas().map((f) => f.maestro.tipoCatalogo)).toEqual([
      'Piloto',
      'Finca',
      'Transportista',
    ]);
    expect(component.filas().map((f) => f.bascula)).toEqual(['B01', 'B02', 'B01']);
  });

  it('marca la pista de duplicado cuando hay un nombre parecido del mismo tipo', () => {
    const component = crear(
      [maestro({ id: 'p1', tipoCatalogo: 'Piloto', nombre: 'Juan Perez' })],
      [
        maestro({ id: 'p1', tipoCatalogo: 'Piloto', nombre: 'Juan Perez' }),
        maestro({
          id: 'o1',
          tipoCatalogo: 'Piloto',
          nombre: 'Juán Pérez',
          estado: 'Oficial',
          codigo: 'P-001',
        }),
      ],
    );

    expect(component.filas()[0].similar).toEqual({ nombre: 'Juán Pérez', estado: 'Oficial' });
  });

});

describe('AprobarDialog (TestBed + HttpTestingController)', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AprobarDialog],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function abierto(codigoSugerido = 'P-010') {
    const component = TestBed.createComponent(AprobarDialog).componentInstance;
    component.abrir(maestro({ id: 'p1', tipoCatalogo: 'Piloto', nombre: 'Ana Lopez' }));
    httpMock
      .expectOne(`${CENTRAL}/api/maestros/siguiente-codigo?tipoCatalogo=Piloto`)
      .flush({ codigoSugerido });
    return component;
  }

  it('prefiere la sugerencia y el nombre del provisional, luego confirma el código editado', () => {
    const component = abierto('P-042');
    expect(component.codigo()).toBe('P-042');
    expect(component.nombre()).toBe('Ana Lopez');

    component.codigo.set('P-999');
    let resuelto = 0;
    component.resuelto.subscribe(() => (resuelto += 1));

    component.confirmar();
    const req = httpMock.expectOne(`${CENTRAL}/api/maestros/p1/aprobar`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ codigo: 'P-999', nombre: 'Ana Lopez' });
    req.flush(maestro({ id: 'p1', estado: 'Oficial', codigo: 'P-999' }));

    expect(resuelto).toBe(1);
    expect(component.maestro()).toBeNull();
  });

  it('un 409 se muestra inline y deja el diálogo abierto para reintentar', () => {
    const component = abierto();
    let resuelto = 0;
    component.resuelto.subscribe(() => (resuelto += 1));

    component.confirmar();
    httpMock
      .expectOne(`${CENTRAL}/api/maestros/p1/aprobar`)
      .flush('El código ya está en uso.', { status: 409, statusText: 'Conflict' });

    expect(component.errorColision()).toBe('El código ya está en uso.');
    expect(component.maestro()).not.toBeNull();
    expect(resuelto).toBe(0);
  });
});

describe('FusionarDialog (TestBed + HttpTestingController)', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FusionarDialog],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('el picker ofrece solo oficiales activos del mismo tipo y fusiona', () => {
    const component = TestBed.createComponent(FusionarDialog).componentInstance;
    component.abrir(maestro({ id: 'p1', tipoCatalogo: 'Finca', nombre: 'La Loma' }));

    const req = httpMock.expectOne(
      `${CENTRAL}/api/maestros?tipoCatalogo=Finca&estado=Oficial&incluirInactivos=false`,
    );
    expect(req.request.method).toBe('GET');
    req.flush([
      maestro({ id: 'o1', tipoCatalogo: 'Finca', estado: 'Oficial', codigo: 'F-001', nombre: 'La Loma' }),
    ]);

    expect(component.oficiales().map((o) => o.id)).toEqual(['o1']);

    let resuelto = 0;
    component.resuelto.subscribe(() => (resuelto += 1));
    component.seleccionado.set('o1');
    component.confirmar();

    const fusion = httpMock.expectOne(`${CENTRAL}/api/maestros/p1/fusionar/o1`);
    expect(fusion.request.method).toBe('POST');
    fusion.flush(maestro({ id: 'p1', estado: 'Provisional', fusionadoConId: 'o1', activo: false }));

    expect(resuelto).toBe(1);
    expect(component.maestro()).toBeNull();
  });
});
