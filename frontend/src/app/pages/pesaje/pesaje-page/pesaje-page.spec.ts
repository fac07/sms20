import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormArray, FormControl, FormGroup } from '@angular/forms';
import { NzMessageService } from 'ng-zorro-antd/message';
import { CampoAplicable, ErrorCampo } from '../../../api/configuracion.models';
import { PesajePage } from './pesaje-page';
import {
  CLAVE_SECCION,
  aplicarErrores,
  claveControl,
  construirMapaControles,
  limpiarErroresServidor,
} from './aplicar-errores';
import { calcularAntiguedadSync } from './antiguedad-sync';
import { agruparSecciones } from './secciones';

const LOCAL = 'http://127.0.0.1:4127';

function campo(parcial: Partial<CampoAplicable> & Pick<CampoAplicable, 'campoId' | 'campoClave'>): CampoAplicable {
  return {
    seccionId: 'sec-' + (parcial.seccionClave ?? 'calidad'),
    seccionClave: 'calidad',
    etiqueta: parcial.campoClave,
    tipoCampo: 'Texto',
    tipoCatalogoRef: null,
    requerido: false,
    cardinalidad: 'Unica',
    seccionRequerida: false,
    configuracion: null,
    orden: 0,
    seccionOrden: 0,
    seccionEtiqueta: '',
    ...parcial,
  };
}

describe('calcularAntiguedadSync (helper de staleness)', () => {
  it('nunca sincronizado -> viejo, "config sin sincronizar"', () => {
    const r = calcularAntiguedadSync(null, new Date('2026-09-03T12:00:00Z'));
    expect(r.esViejo).toBe(true);
    expect(r.texto).toBe('config sin sincronizar');
  });

  it('sync reciente (< 24h) -> no viejo, "config actualizada hace …"', () => {
    const ahora = new Date('2026-09-03T12:00:00Z');
    const hace2h = new Date('2026-09-03T10:00:00Z').toISOString();
    const r = calcularAntiguedadSync(hace2h, ahora);
    expect(r.esViejo).toBe(false);
    expect(r.texto).toBe('config actualizada hace 2 horas');
  });

  it('sync viejo (> 24h) -> viejo', () => {
    const ahora = new Date('2026-09-03T12:00:00Z');
    const hace30h = new Date('2026-09-02T06:00:00Z').toISOString();
    const r = calcularAntiguedadSync(hace30h, ahora);
    expect(r.esViejo).toBe(true);
    expect(r.texto).toBe('config actualizada hace 1 día');
  });
});

describe('aplicarErrores (400/422 -> control map)', () => {
  it('mapea un error de campo a su control y arma el resumen', () => {
    const campos = [
      campo({ campoId: 'c1', campoClave: 'acidez', etiqueta: 'Acidez', seccionClave: 'calidad' }),
    ];
    const secciones = agruparSecciones(campos);
    const form = new FormGroup({
      calidad: new FormGroup({ c1: new FormControl<number | null>(null) }),
    });
    const mapa = construirMapaControles(secciones, form);

    const errores: ErrorCampo[] = [
      { seccionClave: 'calidad', campoClave: 'acidez', ocurrencia: 0, mensaje: 'Fuera de rango.' },
    ];
    const res = aplicarErrores(errores, mapa, campos);

    expect((form.get('calidad') as FormGroup).get('c1')!.hasError('servidor')).toBe(true);
    expect((form.get('calidad') as FormGroup).get('c1')!.getError('servidor')).toBe('Fuera de rango.');
    expect(res.resumen[0].texto).toContain('Acidez');
    expect(res.porSeccion['calidad']).toBeUndefined();
  });

  it('un error "(seccion)" alimenta erroresPorSeccion y el resumen', () => {
    const campos = [
      campo({
        campoId: 'c1',
        campoClave: 'articulo',
        seccionClave: 'producto',
        cardinalidad: 'Repetible',
        seccionRequerida: true,
      }),
    ];
    const secciones = agruparSecciones(campos);
    const form = new FormGroup({ producto: new FormArray<FormGroup>([]) });
    const mapa = construirMapaControles(secciones, form);

    const errores: ErrorCampo[] = [
      {
        seccionClave: 'producto',
        campoClave: CLAVE_SECCION,
        ocurrencia: 0,
        mensaje: 'La sección es requerida y no tiene ninguna ocurrencia capturada.',
      },
    ];
    const res = aplicarErrores(errores, mapa, campos);

    expect(res.porSeccion['producto']).toEqual([
      'La sección es requerida y no tiene ninguna ocurrencia capturada.',
    ]);
    expect(form.get('producto')!.hasError('servidor')).toBe(true);
  });

  it('merge: conserva errores previos (required) al setear servidor', () => {
    const ctrl = new FormControl('', { nonNullable: true });
    ctrl.setErrors({ required: true });
    const mapa = new Map([[claveControl('calidad', 'acidez', 0), ctrl]]);
    aplicarErrores(
      [{ seccionClave: 'calidad', campoClave: 'acidez', ocurrencia: 0, mensaje: 'x' }],
      mapa,
      [campo({ campoId: 'c1', campoClave: 'acidez' })],
    );
    expect(ctrl.hasError('required')).toBe(true);
    expect(ctrl.hasError('servidor')).toBe(true);
  });

  it('limpiarErroresServidor quita solo el flag servidor', () => {
    const ctrl = new FormControl('');
    ctrl.setErrors({ required: true, servidor: 'x' });
    const mapa = new Map([[claveControl('s', 'c', 0), ctrl]]);
    limpiarErroresServidor(mapa);
    expect(ctrl.hasError('servidor')).toBe(false);
    expect(ctrl.hasError('required')).toBe(true);
  });
});

describe('PesajePage (TestBed + HttpTestingController)', () => {
  let fixture: ComponentFixture<PesajePage>;
  let component: PesajePage;
  let httpMock: HttpTestingController;
  const message = { error: vi.fn(), success: vi.fn() };

  beforeEach(async () => {
    message.error.mockReset();
    message.success.mockReset();
    // El poll de peso usa setInterval — se neutraliza para tests deterministas.
    vi.spyOn(globalThis, 'setInterval').mockReturnValue(0 as unknown as ReturnType<typeof setInterval>);
    vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => undefined);

    await TestBed.configureTestingModule({
      imports: [PesajePage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: NzMessageService, useValue: message },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PesajePage);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    vi.restoreAllMocks();
  });

  function flushInit(opciones?: {
    tipos?: unknown[];
    tiposRefresh?: unknown[];
    estado?: unknown;
    configEstado?: { lastConfigSyncAt: string | null };
    boletas?: unknown[];
  }): void {
    component.ngOnInit();
    const tipos = opciones?.tipos ?? [
      {
        id: 'tm-1',
        codigo: 'ING',
        nombre: 'Ingreso de fruta',
        prefijo: 'IF',
        direccion: 'Entrada',
        operacionD365: null,
        generaQR: false,
        formatoBoletaId: null,
        activo: true,
      },
    ];
    // Paint desde el espejo local, luego sync eager (POST) y refresco (GET) —
    // las 3 se flushean acá o `httpMock.verify()` en `afterEach` rompe la suite.
    httpMock.expectOne(`${LOCAL}/tipos-movimiento`).flush(tipos);
    httpMock
      .expectOne(`${LOCAL}/config/sincronizar`)
      .flush({ secciones: 0, campos: 0, tiposMovimientoSeccion: 0, tiposMovimiento: tipos.length });
    httpMock.expectOne(`${LOCAL}/tipos-movimiento`).flush(opciones?.tiposRefresh ?? tipos);
    httpMock
      .expectOne(`${LOCAL}/estado`)
      .flush(
        opciones?.estado ?? {
          aprovisionada: true,
          basculaId: 'b1',
          basculaCodigo: 'B01',
          dev: true,
        },
      );
    httpMock
      .expectOne(`${LOCAL}/config/estado`)
      .flush(opciones?.configEstado ?? { lastConfigSyncAt: new Date().toISOString() });
    httpMock.expectOne(`${LOCAL}/boletas?estado=EnTransito`).flush(opciones?.boletas ?? []);
    httpMock.expectOne(`${LOCAL}/peso`).flush({ peso: 100, origen: 'Bascula' });
  }

  function seleccionarTipo(campos: CampoAplicable[]): void {
    component.tipoMovimientoCtrl.setValue('tm-1');
    httpMock.expectOne(`${LOCAL}/tipos-movimiento/tm-1/formulario`).flush(campos);
  }

  it('construye el formulario a partir de /formulario, con validators required', () => {
    flushInit();
    seleccionarTipo([
      campo({
        campoId: 'c1',
        campoClave: 'acidez',
        seccionClave: 'calidad',
        requerido: true,
        tipoCampo: 'Decimal',
      }),
    ]);

    const grupo = component.formSecciones().get('calidad') as FormGroup;
    expect(grupo).toBeInstanceOf(FormGroup);
    const ctrl = grupo.get('c1')!;
    expect(ctrl.hasError('required')).toBe(true);
    ctrl.setValue(3);
    expect(ctrl.valid).toBe(true);
  });

  it('cotas numéricas de Configuracion -> Validators.min/max', () => {
    flushInit();
    seleccionarTipo([
      campo({
        campoId: 'c1',
        campoClave: 'dobi',
        tipoCampo: 'Decimal',
        configuracion: '{"min":1,"max":100}',
      }),
    ]);
    const ctrl = (component.formSecciones().get('calidad') as FormGroup).get('c1')!;
    ctrl.setValue(250);
    expect(ctrl.hasError('max')).toBe(true);
    ctrl.setValue(0);
    expect(ctrl.hasError('min')).toBe(true);
    ctrl.setValue(50);
    expect(ctrl.valid).toBe(true);
  });

  it('secciones Repetible: agregar / quitar ocurrencias (requerida no baja de 1)', () => {
    flushInit();
    seleccionarTipo([
      campo({
        campoId: 'c1',
        campoClave: 'articulo',
        seccionClave: 'producto',
        cardinalidad: 'Repetible',
        seccionRequerida: true,
      }),
    ]);

    expect(component.ocurrenciasDe('producto').length).toBe(1);
    component.agregarOcurrencia('producto');
    expect(component.ocurrenciasDe('producto').length).toBe(2);
    component.quitarOcurrencia('producto', 1);
    expect(component.ocurrenciasDe('producto').length).toBe(1);
    // Requerida: no se puede quitar la última fila.
    component.quitarOcurrencia('producto', 0);
    expect(component.ocurrenciasDe('producto').length).toBe(1);
  });

  it('carga opciones de ReferenciaMaestro por TipoCatalogoRef (batch)', () => {
    flushInit();
    const refCampo = campo({
      campoId: 'c1',
      campoClave: 'transportista',
      seccionClave: 'transporte',
      tipoCampo: 'ReferenciaMaestro',
      tipoCatalogoRef: 'Transportista',
    });
    component.tipoMovimientoCtrl.setValue('tm-1');
    httpMock.expectOne(`${LOCAL}/tipos-movimiento/tm-1/formulario`).flush([refCampo]);
    httpMock.expectOne(`${LOCAL}/maestros?tipoCatalogo=Transportista`).flush([
      { id: 'm1', tipoCatalogo: 'Transportista', codigo: 'T1', nombre: 'Transporte 1', datosAdicionales: null, estado: 'Oficial', fusionadoConId: null, fechaModificacion: '', activo: true },
    ]);

    expect(component.opcionesMaestro(refCampo).map((m) => m.nombre)).toEqual(['Transporte 1']);
  });

  it('ordena secciones por seccionOrden y campos por orden', () => {
    flushInit();
    seleccionarTipo([
      campo({ campoId: 'b', campoClave: 'b', seccionClave: 'z', seccionOrden: 2, orden: 1 }),
      campo({ campoId: 'a', campoClave: 'a', seccionClave: 'z', seccionOrden: 2, orden: 0 }),
      campo({ campoId: 'p', campoClave: 'p', seccionClave: 'a', seccionOrden: 1, orden: 0 }),
    ]);
    const secciones = component.secciones();
    expect(secciones.map((s) => s.clave)).toEqual(['a', 'z']);
    expect(secciones[1].campos.map((c) => c.campoClave)).toEqual(['a', 'b']);
  });

  it('un 400 ErrorCampo[] al crear marca el control y llena el resumen', () => {
    flushInit();
    seleccionarTipo([
      campo({
        campoId: 'c1',
        campoClave: 'acidez',
        etiqueta: 'Acidez',
        seccionClave: 'calidad',
        tipoCampo: 'Decimal',
        requerido: true,
      }),
    ]);
    (component.formSecciones().get('calidad') as FormGroup).get('c1')!.setValue(5);

    component.crearBoleta();
    const req = httpMock.expectOne(`${LOCAL}/boletas`);
    expect(req.request.method).toBe('POST');
    req.flush(
      [{ seccionClave: 'calidad', campoClave: 'acidez', ocurrencia: 0, mensaje: 'Fuera de rango.' }],
      { status: 400, statusText: 'Bad Request' },
    );

    const ctrl = (component.formSecciones().get('calidad') as FormGroup).get('c1')!;
    expect(ctrl.hasError('servidor')).toBe(true);
    expect(component.resumenErrores().length).toBe(1);
    expect(component.resumenErrores()[0].texto).toContain('Acidez');
  });

  it('el dropdown se sirve del espejo local (127.0.0.1) y dispara el sync eager', () => {
    flushInit({
      tipos: [
        {
          id: 'tm-1',
          codigo: 'ING',
          nombre: 'Ingreso de fruta',
          prefijo: 'IF',
          direccion: 'Entrada',
          operacionD365: null,
          generaQR: false,
          formatoBoletaId: null,
          activo: true,
        },
      ],
    });
    expect(component.tiposMovimiento().map((t) => t.nombre)).toEqual(['Ingreso de fruta']);
    expect(component.tiposNoDisponibles()).toBe(false);
    expect(message.error).not.toHaveBeenCalled();
  });

  it('espejo nunca sincronizado -> select vacío + alerta offline, sin message.error', () => {
    flushInit({ tipos: [], tiposRefresh: [] });
    expect(component.tiposMovimiento()).toEqual([]);
    expect(component.tiposNoDisponibles()).toBe(true);
    expect(message.error).not.toHaveBeenCalled();
  });

  it('el indicador de staleness es no bloqueante y warna > 24h', () => {
    flushInit({ configEstado: { lastConfigSyncAt: new Date(Date.now() - 30 * 3_600_000).toISOString() } });
    expect(component.antiguedadSync().esViejo).toBe(true);
    expect(component.antiguedadSync().texto).toContain('config actualizada hace');

    component.lastConfigSyncAt.set(new Date(Date.now() - 2 * 3_600_000).toISOString());
    expect(component.antiguedadSync().esViejo).toBe(false);
  });
});
