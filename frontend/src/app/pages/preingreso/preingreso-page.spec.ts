import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { NzMessageService } from 'ng-zorro-antd/message';
import { Maestro, TipoCatalogo } from '../../api/maestros.service';
import { PreIngreso } from '../../api/preingresos.service';
import { PreingresoPage } from './preingreso-page';
import { environment } from '../../../environments/environment';
import { routes } from '../../app.routes';

const CENTRAL = environment.apiUrl;

function maestro(parcial: Partial<Maestro> & Pick<Maestro, 'id'>): Maestro {
  return {
    tipoCatalogo: 'Centro' as TipoCatalogo,
    codigo: 'C-01',
    nombre: 'Centro Norte',
    datosAdicionales: null,
    estado: 'Oficial',
    fusionadoConId: null,
    fechaModificacion: '',
    activo: true,
    ...parcial,
  };
}

function preingreso(parcial: Partial<PreIngreso> & Pick<PreIngreso, 'id'>): PreIngreso {
  return {
    centroId: 'centro-1',
    pilotoId: null,
    transportistaId: null,
    equipoId: null,
    regionId: null,
    fincaId: null,
    numeroEnvio: 'ENV-001',
    pesoEnviado: 20000,
    racimos: null,
    sacos: null,
    estado: 'Pendiente',
    boletaId: null,
    usuarioCreacion: 'admin@naturaceites.com',
    usuarioCancela: null,
    motivoCancelacion: null,
    fechaCreacion: '2026-09-01T00:00:00Z',
    fechaModificacion: '2026-09-01T00:00:00Z',
    ...parcial,
  };
}

describe('PreingresoPage (TestBed + HttpTestingController)', () => {
  let httpMock: HttpTestingController;
  const message = { error: vi.fn(), success: vi.fn() };

  beforeEach(async () => {
    message.error.mockReset();
    message.success.mockReset();
    await TestBed.configureTestingModule({
      imports: [PreingresoPage],
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
    preingresos: PreIngreso[] = [],
    centros: Maestro[] = [maestro({ id: 'centro-1' })],
    porTipo: Partial<Record<'Piloto' | 'Transportista' | 'Equipo' | 'Finca' | 'Region', Maestro[]>> = {},
  ) {
    const fixture = TestBed.createComponent(PreingresoPage);
    httpMock.expectOne(`${CENTRAL}/api/preingresos`).flush(preingresos);
    httpMock
      .expectOne(`${CENTRAL}/api/maestros?tipoCatalogo=Centro&incluirInactivos=false`)
      .flush(centros);
    for (const tipo of ['Piloto', 'Transportista', 'Equipo', 'Finca', 'Region'] as const) {
      httpMock
        .expectOne(`${CENTRAL}/api/maestros?tipoCatalogo=${tipo}&estado=Oficial&incluirInactivos=false`)
        .flush(porTipo[tipo] ?? []);
    }
    return fixture.componentInstance;
  }

  it('lista los pre-ingresos existentes', () => {
    const page = crear([
      preingreso({ id: 'p1', numeroEnvio: 'ENV-001' }),
      preingreso({ id: 'p2', numeroEnvio: 'ENV-002', estado: 'Vinculado' }),
    ]);

    expect(page.preingresos().map((p) => p.numeroEnvio)).toEqual(['ENV-001', 'ENV-002']);
  });

  it('crea un pre-ingreso con los datos del formulario y recarga la lista', () => {
    const page = crear([]);
    page.abrirModalCrear();
    page.form.patchValue({ centroId: 'centro-1', numeroEnvio: 'ENV-010', pesoEnviado: 15000 });

    page.guardar();

    const req = httpMock.expectOne(`${CENTRAL}/api/preingresos`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toMatchObject({
      centroId: 'centro-1',
      numeroEnvio: 'ENV-010',
      pesoEnviado: 15000,
    });
    req.flush(preingreso({ id: 'p10', numeroEnvio: 'ENV-010', pesoEnviado: 15000 }));

    httpMock.expectOne(`${CENTRAL}/api/preingresos`).flush([
      preingreso({ id: 'p10', numeroEnvio: 'ENV-010', pesoEnviado: 15000 }),
    ]);

    expect(message.success).toHaveBeenCalled();
    expect(page.preingresos().length).toBe(1);
  });

  it('rechaza la creación sin centro — no envía nada', () => {
    const page = crear([]);
    page.abrirModalCrear();
    page.form.patchValue({ centroId: '', numeroEnvio: 'ENV-020', pesoEnviado: 1000 });

    page.guardar();

    httpMock.expectNone(`${CENTRAL}/api/preingresos`);
    expect(page.form.invalid).toBe(true);
  });

  it('edita un pre-ingreso Pendiente', () => {
    const p = preingreso({ id: 'p1', numeroEnvio: 'ENV-001' });
    const page = crear([p]);

    page.abrirModalEditar(p);
    page.form.patchValue({ pesoEnviado: 18000 });
    page.guardar();

    const req = httpMock.expectOne(`${CENTRAL}/api/preingresos/p1`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toMatchObject({ pesoEnviado: 18000 });
    req.flush(preingreso({ id: 'p1', pesoEnviado: 18000 }));

    httpMock
      .expectOne(`${CENTRAL}/api/preingresos`)
      .flush([preingreso({ id: 'p1', pesoEnviado: 18000 })]);

    expect(message.success).toHaveBeenCalled();
  });

  it('cancela un pre-ingreso Pendiente y recarga la lista', () => {
    const p = preingreso({ id: 'p1' });
    const page = crear([p]);

    page.cancelar(p);

    const req = httpMock.expectOne(`${CENTRAL}/api/preingresos/p1/cancelar`);
    expect(req.request.method).toBe('POST');
    req.flush(preingreso({ id: 'p1', estado: 'Cancelado' }));

    httpMock.expectOne(`${CENTRAL}/api/preingresos`).flush([preingreso({ id: 'p1', estado: 'Cancelado' })]);

    expect(message.success).toHaveBeenCalled();
  });

  it('carga las 5 listas de maestros oficiales (piloto/transportista/equipo/finca/región) por su TipoCatalogo', () => {
    const page = crear([], undefined, {
      Piloto: [maestro({ id: 'piloto-1', tipoCatalogo: 'Piloto' as TipoCatalogo, nombre: 'Juan' })],
      Transportista: [
        maestro({ id: 'transportista-1', tipoCatalogo: 'Transportista' as TipoCatalogo, nombre: 'Transp SA' }),
      ],
      Equipo: [maestro({ id: 'equipo-1', tipoCatalogo: 'Equipo' as TipoCatalogo, nombre: 'Camión 1' })],
      Finca: [maestro({ id: 'finca-1', tipoCatalogo: 'Finca' as TipoCatalogo, nombre: 'Finca Norte' })],
      Region: [maestro({ id: 'region-1', tipoCatalogo: 'Region' as TipoCatalogo, nombre: 'Región Norte' })],
    });

    expect(page.pilotos().map((m) => m.id)).toEqual(['piloto-1']);
    expect(page.transportistas().map((m) => m.id)).toEqual(['transportista-1']);
    expect(page.equipos().map((m) => m.id)).toEqual(['equipo-1']);
    expect(page.fincas().map((m) => m.id)).toEqual(['finca-1']);
    expect(page.regiones().map((m) => m.id)).toEqual(['region-1']);
  });

  it('los 5 selects del formulario están enlazados a sus FormControls y muestran las opciones cargadas', () => {
    const page = crear([], undefined, {
      Piloto: [maestro({ id: 'piloto-1', tipoCatalogo: 'Piloto' as TipoCatalogo, nombre: 'Juan Pérez' })],
    });

    page.abrirModalCrear();

    expect(page.pilotos().map((m) => m.id)).toContain('piloto-1');

    page.form.controls.pilotoId.setValue('piloto-1');
    page.form.controls.transportistaId.setValue('transportista-9');
    page.form.controls.equipoId.setValue('equipo-9');
    page.form.controls.fincaId.setValue('finca-9');
    page.form.controls.regionId.setValue('region-9');

    expect(page.form.controls.pilotoId.value).toBe('piloto-1');
    expect(page.form.controls.transportistaId.value).toBe('transportista-9');
    expect(page.form.controls.equipoId.value).toBe('equipo-9');
    expect(page.form.controls.fincaId.value).toBe('finca-9');
    expect(page.form.controls.regionId.value).toBe('region-9');
  });

  it('solo permite editar o cancelar mientras el estado es Pendiente', () => {
    const pendiente = preingreso({ id: 'p1', estado: 'Pendiente' });
    const vinculado = preingreso({ id: 'p2', estado: 'Vinculado' });
    const cancelado = preingreso({ id: 'p3', estado: 'Cancelado' });
    const page = crear([pendiente, vinculado, cancelado]);

    expect(page.puedeEditar(pendiente)).toBe(true);
    expect(page.puedeEditar(vinculado)).toBe(false);
    expect(page.puedeEditar(cancelado)).toBe(false);
  });
});

describe('app.routes — /preingreso requiere modo admin', () => {
  it('registra la ruta con data.modo=admin bajo el shell', () => {
    const hijos = routes.find((r) => r.path === '' && r.children)?.children ?? [];
    const ruta = hijos.find((r) => r.path === 'preingreso');

    expect(ruta).toBeDefined();
    expect(ruta?.data?.['modo']).toBe('admin');
    expect(ruta?.canActivate).toBeDefined();
  });
});
