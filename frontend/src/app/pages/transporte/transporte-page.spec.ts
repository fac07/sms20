import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { NzMessageService } from 'ng-zorro-antd/message';
import { Maestro, TipoCatalogo } from '../../api/maestros.service';
import { VinculoPilotoTransportista } from '../../api/transporte.service';
import { TransportePage } from './transporte-page';
import { environment } from '../../../environments/environment';
import { routes } from '../../app.routes';

const CENTRAL = environment.apiUrl;

// El listado admin usa el modo delta del endpoint (PR3) con un
// `modificadoDesde` anterior a cualquier alta posible, para traer activos E
// inactivos (los inactivos son necesarios para poder reactivarlos) — sin
// `modificadoDesde` el endpoint sólo devuelve los activos.
const URL_VINCULOS_TODOS = `${CENTRAL}/api/vinculos-piloto-transportista?modificadoDesde=1970-01-01T00%3A00%3A00.000Z`;

function maestro(parcial: Partial<Maestro> & Pick<Maestro, 'id'>): Maestro {
  return {
    tipoCatalogo: 'Piloto' as TipoCatalogo,
    codigo: 'P-01',
    nombre: 'Juan Pérez',
    datosAdicionales: null,
    estado: 'Oficial',
    fusionadoConId: null,
    fechaModificacion: '',
    activo: true,
    ...parcial,
  };
}

function vinculo(
  parcial: Partial<VinculoPilotoTransportista> & Pick<VinculoPilotoTransportista, 'id'>,
): VinculoPilotoTransportista {
  return {
    pilotoId: 'piloto-1',
    transportistaId: 'transportista-1',
    activo: true,
    usuarioCreacion: 'admin@naturaceites.com',
    fechaCreacion: '2026-09-01T00:00:00Z',
    fechaModificacion: '2026-09-01T00:00:00Z',
    ...parcial,
  };
}

describe('TransportePage (TestBed + HttpTestingController)', () => {
  let httpMock: HttpTestingController;
  const message = { error: vi.fn(), success: vi.fn() };

  beforeEach(async () => {
    message.error.mockReset();
    message.success.mockReset();
    await TestBed.configureTestingModule({
      imports: [TransportePage],
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
  });

  function crear(
    vinculos: VinculoPilotoTransportista[] = [],
    pilotos: Maestro[] = [],
    transportistas: Maestro[] = [],
  ) {
    const fixture = TestBed.createComponent(TransportePage);
    httpMock.expectOne(URL_VINCULOS_TODOS).flush(vinculos);
    httpMock
      .expectOne(`${CENTRAL}/api/maestros?tipoCatalogo=Piloto&estado=Oficial&incluirInactivos=false`)
      .flush(pilotos);
    httpMock
      .expectOne(`${CENTRAL}/api/maestros?tipoCatalogo=Transportista&estado=Oficial&incluirInactivos=false`)
      .flush(transportistas);
    return fixture.componentInstance;
  }

  it('lista los vínculos existentes (activos e inactivos)', () => {
    const page = crear([
      vinculo({ id: 'v1', pilotoId: 'p1', transportistaId: 't1', activo: true }),
      vinculo({ id: 'v2', pilotoId: 'p2', transportistaId: 't1', activo: false }),
    ]);

    expect(page.vinculos().map((v) => v.id)).toEqual(['v1', 'v2']);
  });

  it('carga los pilotos y transportistas oficiales activos para los selects', () => {
    const page = crear(
      [],
      [maestro({ id: 'piloto-1', tipoCatalogo: 'Piloto' as TipoCatalogo, nombre: 'Juan' })],
      [
        maestro({
          id: 'transportista-1',
          tipoCatalogo: 'Transportista' as TipoCatalogo,
          nombre: 'Transp SA',
        }),
      ],
    );

    expect(page.pilotos().map((m) => m.id)).toEqual(['piloto-1']);
    expect(page.transportistas().map((m) => m.id)).toEqual(['transportista-1']);
  });

  it('crea un vínculo con los datos del formulario y recarga la lista', () => {
    const page = crear([]);
    page.form.patchValue({ pilotoId: 'piloto-1', transportistaId: 'transportista-1' });

    page.crear();

    const req = httpMock.expectOne(`${CENTRAL}/api/vinculos-piloto-transportista`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toMatchObject({
      pilotoId: 'piloto-1',
      transportistaId: 'transportista-1',
    });
    req.flush(vinculo({ id: 'v10', pilotoId: 'piloto-1', transportistaId: 'transportista-1' }));

    httpMock
      .expectOne(URL_VINCULOS_TODOS)
      .flush([vinculo({ id: 'v10', pilotoId: 'piloto-1', transportistaId: 'transportista-1' })]);

    expect(message.success).toHaveBeenCalled();
    expect(page.vinculos().length).toBe(1);
  });

  it('rechaza la creación sin piloto o transportista — no envía nada', () => {
    const page = crear([]);
    page.form.patchValue({ pilotoId: '', transportistaId: '' });

    page.crear();

    httpMock.expectNone(`${CENTRAL}/api/vinculos-piloto-transportista`);
    expect(page.form.invalid).toBe(true);
  });

  it('desactiva un vínculo activo (soft) y recarga la lista', () => {
    const v = vinculo({ id: 'v1', activo: true });
    const page = crear([v]);

    page.desactivar(v);

    const req = httpMock.expectOne(`${CENTRAL}/api/vinculos-piloto-transportista/v1/desactivar`);
    expect(req.request.method).toBe('POST');
    req.flush(vinculo({ id: 'v1', activo: false }));

    httpMock.expectOne(URL_VINCULOS_TODOS).flush([vinculo({ id: 'v1', activo: false })]);

    expect(message.success).toHaveBeenCalled();
  });

  it('reactiva un vínculo inactivo y recarga la lista', () => {
    const v = vinculo({ id: 'v1', activo: false });
    const page = crear([v]);

    page.reactivar(v);

    const req = httpMock.expectOne(`${CENTRAL}/api/vinculos-piloto-transportista/v1/reactivar`);
    expect(req.request.method).toBe('POST');
    req.flush(vinculo({ id: 'v1', activo: true }));

    httpMock.expectOne(URL_VINCULOS_TODOS).flush([vinculo({ id: 'v1', activo: true })]);

    expect(message.success).toHaveBeenCalled();
  });
});

describe('app.routes — /transporte requiere modo admin', () => {
  it('registra la ruta con data.modo=admin bajo el shell', () => {
    const hijos = routes.find((r) => r.path === '' && r.children)?.children ?? [];
    const ruta = hijos.find((r) => r.path === 'transporte');

    expect(ruta).toBeDefined();
    expect(ruta?.data?.['modo']).toBe('admin');
    expect(ruta?.canActivate).toBeDefined();
  });
});
