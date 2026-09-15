import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormArray, FormControl, FormGroup } from '@angular/forms';
import { NzMessageService } from 'ng-zorro-antd/message';
import { CampoAplicable, ErrorCampo } from '../../../api/configuracion.models';
import { BoletaLocal, MaestroLocal } from '../../../api/local-server.service';
import { PesajePage } from './pesaje-page';
import {
  CLAVE_SECCION,
  aplicarErrores,
  claveControl,
  construirMapaControles,
  limpiarErroresServidor,
} from './aplicar-errores';
import { hayDivergenciaPeso } from './advertencia-peso';
import { calcularAntiguedadSync } from './antiguedad-sync';
import { valoresPrefillPreIngreso } from './armar-valores';
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

describe('valoresPrefillPreIngreso (helper de prefill, cola-transporte slice 6)', () => {
  const camposTransporte: CampoAplicable[] = [
    campo({ campoId: 'c-piloto', campoClave: 'piloto', seccionClave: 'transporte' }),
    campo({ campoId: 'c-transportista', campoClave: 'transportista', seccionClave: 'transporte' }),
    campo({ campoId: 'c-equipo', campoClave: 'equipo', seccionClave: 'transporte' }),
    campo({ campoId: 'c-region', campoClave: 'region', seccionClave: 'transporte' }),
    campo({ campoId: 'c-finca', campoClave: 'finca', seccionClave: 'detalle_fruta' }),
    campo({ campoId: 'c-otro', campoClave: 'acidez', seccionClave: 'calidad' }),
  ];

  it('mapea las 5 claves de piloto/transportista/equipo/region/finca a su campoId', () => {
    const mapa = valoresPrefillPreIngreso(camposTransporte, {
      pilotoId: 'piloto-1',
      transportistaId: 'transportista-1',
      equipoId: 'equipo-1',
      regionId: 'region-1',
      fincaId: 'finca-1',
    });
    expect(mapa).toEqual({
      'c-piloto': 'piloto-1',
      'c-transportista': 'transportista-1',
      'c-equipo': 'equipo-1',
      'c-region': 'region-1',
      'c-finca': 'finca-1',
    });
  });

  it('omite las claves null del pre-ingreso y los campos sin correspondencia', () => {
    const mapa = valoresPrefillPreIngreso(camposTransporte, {
      pilotoId: 'piloto-1',
      transportistaId: null,
      equipoId: null,
      regionId: null,
      fincaId: null,
    });
    expect(mapa).toEqual({ 'c-piloto': 'piloto-1' });
  });
});

describe('hayDivergenciaPeso (helper de advertencia de peso, cola-transporte slice 6)', () => {
  it('marca divergencia cuando la diferencia entre peso enviado y peso neto supera la tolerancia', () => {
    expect(hayDivergenciaPeso(20000, 17000)).toBe(true);
  });

  it('no marca divergencia dentro de la tolerancia', () => {
    expect(hayDivergenciaPeso(20000, 19980)).toBe(false);
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

  /** Reejecuta el poll de peso (privado) y flushea la respuesta de `/peso`. */
  function pollPeso(lectura: { peso: number | null; origen: string | null }): void {
    (component as unknown as Record<string, () => void>)['actualizarPeso']();
    httpMock.expectOne(`${LOCAL}/peso`).flush(lectura);
  }

  /** Reejecuta el poll de peso y hace fallar la respuesta de `/peso` (servidor local caído). */
  function pollPesoError(): void {
    (component as unknown as Record<string, () => void>)['actualizarPeso']();
    httpMock.expectOne(`${LOCAL}/peso`).error(new ProgressEvent('error'));
  }

  function flushInit(opciones?: {
    tipos?: unknown[];
    tiposRefresh?: unknown[];
    estado?: unknown;
    configEstado?: { lastConfigSyncAt: string | null };
    boletas?: unknown[];
    tiposProvisionables?: { tipos: string[] };
    alertas?: { hayAlertaProvisional: boolean; eventos: unknown[] };
    peso?: unknown;
    preIngresos?: unknown[];
    preIngresosSync?: { descargados: number };
    preIngresosRefresh?: unknown[];
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
    httpMock
      .expectOne(`${LOCAL}/maestros/tipos-provisionables`)
      .flush(opciones?.tiposProvisionables ?? { tipos: [] });
    httpMock
      .expectOne(`${LOCAL}/outbox/alertas`)
      .flush(opciones?.alertas ?? { hayAlertaProvisional: false, eventos: [] });
    // Cola de transporte (S6): paint desde el espejo local, luego sync eager
    // (POST) y refresco (GET) — mismo patrón A3/A4 que tipos-movimiento.
    httpMock.expectOne(`${LOCAL}/preingreso`).flush(opciones?.preIngresos ?? []);
    httpMock
      .expectOne(`${LOCAL}/preingreso/sincronizar`)
      .flush(opciones?.preIngresosSync ?? { descargados: 0 });
    httpMock
      .expectOne(`${LOCAL}/preingreso`)
      .flush(opciones?.preIngresosRefresh ?? opciones?.preIngresos ?? []);
    httpMock.expectOne(`${LOCAL}/peso`).flush(opciones?.peso ?? { peso: 100, origen: 'Bascula' });
  }

  const ESTADO_MANUAL = {
    aprovisionada: true,
    basculaId: 'b1',
    basculaCodigo: 'B01',
    dev: true,
    permiteIngresoManual: true,
    pesoMinimoManual: null,
    pesoMaximoManual: null,
    motivosPesoManual: ['IndicadorSinSenal', 'CorteEnergia', 'Otro'],
  };

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

  it('ofrece "+ Crear provisional" solo para un TipoCatalogoRef habilitado y lo selecciona al crear', () => {
    flushInit({ tiposProvisionables: { tipos: ['Transportista'] } });

    const refCampo = campo({
      campoId: 'c1',
      campoClave: 'transportista',
      seccionClave: 'transporte',
      tipoCampo: 'ReferenciaMaestro',
      tipoCatalogoRef: 'Transportista',
    });
    const noHabilitado = campo({
      campoId: 'c2',
      campoClave: 'finca',
      seccionClave: 'transporte',
      tipoCampo: 'ReferenciaMaestro',
      tipoCatalogoRef: 'Finca',
    });

    component.tipoMovimientoCtrl.setValue('tm-1');
    httpMock.expectOne(`${LOCAL}/tipos-movimiento/tm-1/formulario`).flush([refCampo, noHabilitado]);
    httpMock.expectOne(`${LOCAL}/maestros?tipoCatalogo=Transportista`).flush([]);
    httpMock.expectOne(`${LOCAL}/maestros?tipoCatalogo=Finca`).flush([]);

    // Solo el tipo dentro de la allow-list ofrece el "+ Crear provisional".
    expect(component.puedeCrearProvisional(refCampo)).toBe(true);
    expect(component.puedeCrearProvisional(noHabilitado)).toBe(false);

    const grupo = component.formSecciones().get('transporte') as FormGroup;
    component.abrirCrearProvisional(refCampo, grupo);
    component.nombreProvisionalCtrl.setValue('Nuevo Transportista');
    component.confirmarCrearProvisional();

    const req = httpMock.expectOne(`${LOCAL}/maestros`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      tipoCatalogo: 'Transportista',
      nombre: 'Nuevo Transportista',
      datosAdicionales: null,
    });
    req.flush({
      id: 'prov-1',
      tipoCatalogo: 'Transportista',
      codigo: 'PROV-B01-1',
      nombre: 'Nuevo Transportista',
      datosAdicionales: null,
      estado: 'Provisional',
      fusionadoConId: null,
      fechaModificacion: '',
      activo: true,
    });

    expect(grupo.get('c1')!.value).toBe('prov-1');
    expect(component.opcionesMaestro(refCampo).map((m) => m.id)).toContain('prov-1');
  });

  describe('selector de piloto escopado por transportista (PR5b — vínculo piloto-transportista, offline)', () => {
    const campoTransportista = campo({
      campoId: 'c-transportista',
      campoClave: 'transportista',
      seccionClave: 'transporte',
      tipoCampo: 'ReferenciaMaestro',
      tipoCatalogoRef: 'Transportista',
    });
    const campoPiloto = campo({
      campoId: 'c-piloto',
      campoClave: 'piloto',
      seccionClave: 'transporte',
      tipoCampo: 'ReferenciaMaestro',
      tipoCatalogoRef: 'Piloto',
    });

    function maestroPiloto(id: string, nombre: string): MaestroLocal {
      return {
        id,
        tipoCatalogo: 'Piloto',
        codigo: id.toUpperCase(),
        nombre,
        datosAdicionales: null,
        estado: 'Oficial',
        fusionadoConId: null,
        fechaModificacion: '',
        activo: true,
      };
    }

    /** Carga el formulario `transporte` (transportista + piloto) y flushea el batch de maestros. */
    function seleccionarTipoConTransporte(pilotos: MaestroLocal[] = [maestroPiloto('p1', 'Piloto Uno'), maestroPiloto('p2', 'Piloto Dos')]): void {
      component.tipoMovimientoCtrl.setValue('tm-1');
      httpMock
        .expectOne(`${LOCAL}/tipos-movimiento/tm-1/formulario`)
        .flush([campoTransportista, campoPiloto]);
      httpMock.expectOne(`${LOCAL}/maestros?tipoCatalogo=Transportista`).flush([]);
      httpMock.expectOne(`${LOCAL}/maestros?tipoCatalogo=Piloto`).flush(pilotos);
    }

    it('sin transportista seleccionado, el piloto no ofrece ninguna opción', () => {
      flushInit();
      seleccionarTipoConTransporte();

      expect(component.opcionesMaestro(campoPiloto)).toEqual([]);
    });

    it('seleccionar un transportista llama a GET /vinculos (servicio inyectado) y escopa el piloto a sus vínculos activos', () => {
      flushInit();
      seleccionarTipoConTransporte();

      const grupo = component.formSecciones().get('transporte') as FormGroup;
      grupo.get('c-transportista')!.setValue('t1');

      const req = httpMock.expectOne(`${LOCAL}/vinculos?transportistaId=t1`);
      expect(req.request.method).toBe('GET');
      req.flush([{ id: 'v1', pilotoId: 'p1', transportistaId: 't1', activo: true, fechaModificacion: '' }]);

      expect(component.opcionesMaestro(campoPiloto).map((m) => m.id)).toEqual(['p1']);
    });

    it('cambiar de transportista re-escopa el piloto y limpia una selección ya no válida', () => {
      flushInit();
      seleccionarTipoConTransporte();

      const grupo = component.formSecciones().get('transporte') as FormGroup;
      grupo.get('c-transportista')!.setValue('t1');
      httpMock
        .expectOne(`${LOCAL}/vinculos?transportistaId=t1`)
        .flush([{ id: 'v1', pilotoId: 'p1', transportistaId: 't1', activo: true, fechaModificacion: '' }]);
      grupo.get('c-piloto')!.setValue('p1');
      expect(grupo.get('c-piloto')!.value).toBe('p1');

      grupo.get('c-transportista')!.setValue('t2');
      httpMock
        .expectOne(`${LOCAL}/vinculos?transportistaId=t2`)
        .flush([{ id: 'v2', pilotoId: 'p2', transportistaId: 't2', activo: true, fechaModificacion: '' }]);

      expect(grupo.get('c-piloto')!.value).toBeNull();
      expect(component.opcionesMaestro(campoPiloto).map((m) => m.id)).toEqual(['p2']);
    });

    it('limpiar el transportista (valor vacío) vuelve el piloto a sin opciones', () => {
      flushInit();
      seleccionarTipoConTransporte();

      const grupo = component.formSecciones().get('transporte') as FormGroup;
      grupo.get('c-transportista')!.setValue('t1');
      httpMock
        .expectOne(`${LOCAL}/vinculos?transportistaId=t1`)
        .flush([{ id: 'v1', pilotoId: 'p1', transportistaId: 't1', activo: true, fechaModificacion: '' }]);

      grupo.get('c-transportista')!.setValue(null);

      httpMock.expectNone(`${LOCAL}/vinculos?transportistaId=null`);
      expect(component.opcionesMaestro(campoPiloto)).toEqual([]);
    });
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

  it('enciende el banner de provisional trabado cuando hayAlertaProvisional=true', () => {
    flushInit({ alertas: { hayAlertaProvisional: true, eventos: [] } });
    expect(component.hayAlertaProvisional()).toBe(true);
  });

  it('sin alerta cuando hayAlertaProvisional=false', () => {
    flushInit({ alertas: { hayAlertaProvisional: false, eventos: [] } });
    expect(component.hayAlertaProvisional()).toBe(false);
  });

  it('un poll de alertas que falla se trata como "sin alerta" (no banner rancio)', () => {
    component.ngOnInit();
    httpMock.expectOne(`${LOCAL}/tipos-movimiento`).flush([]);
    httpMock
      .expectOne(`${LOCAL}/config/sincronizar`)
      .flush({ secciones: 0, campos: 0, tiposMovimientoSeccion: 0, tiposMovimiento: 0 });
    httpMock.expectOne(`${LOCAL}/tipos-movimiento`).flush([]);
    httpMock
      .expectOne(`${LOCAL}/estado`)
      .flush({ aprovisionada: true, basculaId: 'b1', basculaCodigo: 'B01', dev: true });
    httpMock.expectOne(`${LOCAL}/config/estado`).flush({ lastConfigSyncAt: null });
    httpMock.expectOne(`${LOCAL}/boletas?estado=EnTransito`).flush([]);
    httpMock.expectOne(`${LOCAL}/maestros/tipos-provisionables`).flush({ tipos: [] });
    httpMock
      .expectOne(`${LOCAL}/outbox/alertas`)
      .flush('boom', { status: 500, statusText: 'Server Error' });
    httpMock.expectOne(`${LOCAL}/preingreso`).flush([]);
    httpMock.expectOne(`${LOCAL}/preingreso/sincronizar`).flush({ descargados: 0 });
    httpMock.expectOne(`${LOCAL}/preingreso`).flush([]);
    httpMock.expectOne(`${LOCAL}/peso`).flush({ peso: 100, origen: 'Bascula' });

    expect(component.hayAlertaProvisional()).toBe(false);
  });

  it('el banner no bloquea el pesaje — puedeCrear sigue verdadero', () => {
    flushInit({ alertas: { hayAlertaProvisional: true, eventos: [] } });
    seleccionarTipo([]);
    expect(component.hayAlertaProvisional()).toBe(true);
    expect(component.puedeCrear()).toBe(true);
  });

  describe('ingreso manual de peso (fallback tras 15 s sin lectura)', () => {
    it('la báscula habilitada muestra la opción tras 15 s de lecturas nulas', () => {
      const now = vi.spyOn(Date, 'now');
      now.mockReturnValue(1_000_000);
      flushInit({ peso: { peso: null, origen: null }, estado: ESTADO_MANUAL });

      expect(component.ingresoManualDisponible()).toBe(false);

      now.mockReturnValue(1_000_000 + 14_000);
      pollPeso({ peso: null, origen: null });
      expect(component.ingresoManualDisponible()).toBe(false);

      now.mockReturnValue(1_000_000 + 15_000);
      pollPeso({ peso: null, origen: null });
      expect(component.ingresoManualDisponible()).toBe(true);
    });

    it('una lectura que llega antes de los 15 s nunca dispara la opción', () => {
      const now = vi.spyOn(Date, 'now');
      now.mockReturnValue(2_000_000);
      flushInit({ peso: { peso: null, origen: null }, estado: ESTADO_MANUAL });

      now.mockReturnValue(2_000_000 + 5_000);
      pollPeso({ peso: 88, origen: 'Bascula' });
      now.mockReturnValue(2_000_000 + 30_000);
      pollPeso({ peso: null, origen: null });

      expect(component.ingresoManualDisponible()).toBe(false);
    });

    it('la báscula deshabilitada nunca muestra la opción', () => {
      const now = vi.spyOn(Date, 'now');
      now.mockReturnValue(3_000_000);
      flushInit({
        peso: { peso: null, origen: null },
        estado: { ...ESTADO_MANUAL, permiteIngresoManual: false },
      });

      now.mockReturnValue(3_000_000 + 40_000);
      pollPeso({ peso: null, origen: null });
      expect(component.ingresoManualDisponible()).toBe(false);
    });

    it('una lectura automática entrante saca del modo manual', () => {
      const now = vi.spyOn(Date, 'now');
      now.mockReturnValue(4_000_000);
      flushInit({ peso: { peso: null, origen: null }, estado: ESTADO_MANUAL });

      now.mockReturnValue(4_000_000 + 16_000);
      pollPeso({ peso: null, origen: null });
      component.abrirIngresoManual();
      component.pesoManualCtrl.setValue(1500);
      component.motivoManualCtrl.setValue('IndicadorSinSenal');
      expect(component.modoIngresoManual()).toBe(true);

      now.mockReturnValue(4_000_000 + 18_000);
      pollPeso({ peso: 210, origen: 'Bascula' });

      expect(component.ingresoManualDisponible()).toBe(false);
      expect(component.modoIngresoManual()).toBe(false);
      expect(component.lecturaPeso().peso).toBe(210);
    });

    it('un fallo HTTP del poll de peso limpia la lectura (no queda stale)', () => {
      const now = vi.spyOn(Date, 'now');
      now.mockReturnValue(6_000_000);
      flushInit({ peso: { peso: 210, origen: 'Bascula' }, estado: ESTADO_MANUAL });
      expect(component.lecturaPeso().peso).toBe(210);

      now.mockReturnValue(6_000_000 + 2_000);
      pollPesoError();

      expect(component.lecturaPeso().peso).toBeNull();
      expect(component.lecturaPeso().origen).toBeNull();

      // y la racha de nulos arranca desde el fallo -> 16 s después ofrece el ingreso manual
      now.mockReturnValue(6_000_000 + 18_000);
      pollPesoError();
      expect(component.ingresoManualDisponible()).toBe(true);
    });

    it('puedeCrear acepta una captura manual válida; "Otro" exige detalle', () => {
      const now = vi.spyOn(Date, 'now');
      now.mockReturnValue(5_000_000);
      flushInit({ peso: { peso: null, origen: null }, estado: ESTADO_MANUAL });
      seleccionarTipo([]);

      now.mockReturnValue(5_000_000 + 16_000);
      pollPeso({ peso: null, origen: null });
      component.abrirIngresoManual();
      component.pesoManualCtrl.setValue(1500);
      component.motivoManualCtrl.setValue('IndicadorSinSenal');
      expect(component.entradaManualValida()).toBe(true);
      expect(component.puedeCrear()).toBe(true);

      component.motivoManualCtrl.setValue('Otro');
      expect(component.entradaManualValida()).toBe(false);
      component.detalleManualCtrl.setValue('el indicador no encendía');
      expect(component.entradaManualValida()).toBe(true);
    });

    it('crearBoleta con captura manual manda origen Manual + motivo + detalle', () => {
      const now = vi.spyOn(Date, 'now');
      now.mockReturnValue(6_000_000);
      flushInit({ peso: { peso: null, origen: null }, estado: ESTADO_MANUAL });
      seleccionarTipo([]);

      now.mockReturnValue(6_000_000 + 16_000);
      pollPeso({ peso: null, origen: null });
      component.abrirIngresoManual();
      component.pesoManualCtrl.setValue(1500);
      component.motivoManualCtrl.setValue('Otro');
      component.detalleManualCtrl.setValue('el indicador no encendía');

      component.crearBoleta();

      const req = httpMock.expectOne(`${LOCAL}/boletas`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body.origenPesoIngreso).toBe('Manual');
      expect(req.request.body.pesoIngreso).toBe(1500);
      expect(req.request.body.motivoPesoManual).toBe('Otro');
      expect(req.request.body.motivoPesoManualDetalle).toBe('el indicador no encendía');
      req.flush({ numeroBoleta: 'IF-1' });

      httpMock.expectOne(`${LOCAL}/boletas?estado=EnTransito`).flush([]);
      expect(component.modoIngresoManual()).toBe(false);
    });

    it('el peso fuera de rango deja la captura manual inválida', () => {
      const now = vi.spyOn(Date, 'now');
      now.mockReturnValue(7_000_000);
      flushInit({
        peso: { peso: null, origen: null },
        estado: { ...ESTADO_MANUAL, pesoMinimoManual: 500, pesoMaximoManual: 30000 },
      });

      now.mockReturnValue(7_000_000 + 16_000);
      pollPeso({ peso: null, origen: null });
      component.abrirIngresoManual();
      component.motivoManualCtrl.setValue('IndicadorSinSenal');

      component.pesoManualCtrl.setValue(100);
      expect(component.entradaManualValida()).toBe(false);
      component.pesoManualCtrl.setValue(40000);
      expect(component.entradaManualValida()).toBe(false);
      component.pesoManualCtrl.setValue(1500);
      expect(component.entradaManualValida()).toBe(true);
    });

    it('flushInit sigue flusheando la misma lista fija de requests (sin GET nuevo)', () => {
      // Si S3 hubiera agregado un request en ngOnInit, httpMock.verify() del
      // afterEach rompería: este test solo llama flushInit y no espera nada más.
      flushInit({ estado: ESTADO_MANUAL });
      expect(component.permiteIngresoManual()).toBe(true);
      expect(component.motivosPesoManual()).toEqual(['IndicadorSinSenal', 'CorteEnergia', 'Otro']);
    });
  });

  describe('selector de pre-ingreso (cola-transporte slice 6)', () => {
    const preIngresoFixture = {
      id: 'pre-1',
      centroId: 'centro-1',
      pilotoId: 'piloto-1',
      transportistaId: 'transportista-1',
      equipoId: 'equipo-1',
      regionId: 'region-1',
      fincaId: 'finca-1',
      numeroEnvio: 'ENV-2024-001',
      pesoEnviado: 20000,
      racimos: 100,
      sacos: null,
      estado: 'Pendiente',
      boletaId: null,
      usuarioCreacion: 'admin',
      usuarioCancela: null,
      motivoCancelacion: null,
      fechaCreacion: '2026-09-10T00:00:00Z',
      fechaModificacion: '2026-09-10T00:00:00Z',
    };

    it('la lista pendiente se sirve del espejo local (offline-safe)', () => {
      flushInit({ preIngresos: [preIngresoFixture] });
      expect(component.pendientesPreIngreso()).toEqual([preIngresoFixture]);
    });

    it('el filtro por número de envío narrows la lista con coincidencia parcial', () => {
      flushInit({ preIngresos: [preIngresoFixture] });

      component.filtroNumeroEnvioCtrl.setValue('2024');
      httpMock.expectOne(`${LOCAL}/preingreso?numeroEnvio=2024`).flush([preIngresoFixture]);

      expect(component.pendientesPreIngreso()).toEqual([preIngresoFixture]);
    });

    it('seleccionar un pre-ingreso prefillea piloto/transportista/equipo/region/finca como valores editables y setea preIngresoId', () => {
      flushInit({ preIngresos: [preIngresoFixture] });
      seleccionarTipo([
        campo({
          campoId: 'c-piloto',
          campoClave: 'piloto',
          seccionClave: 'transporte',
          tipoCampo: 'ReferenciaMaestro',
          tipoCatalogoRef: 'Piloto',
        }),
        campo({
          campoId: 'c-transportista',
          campoClave: 'transportista',
          seccionClave: 'transporte',
          tipoCampo: 'ReferenciaMaestro',
          tipoCatalogoRef: 'Transportista',
        }),
        campo({
          campoId: 'c-equipo',
          campoClave: 'equipo',
          seccionClave: 'transporte',
          tipoCampo: 'ReferenciaMaestro',
          tipoCatalogoRef: 'Equipo',
        }),
        campo({
          campoId: 'c-region',
          campoClave: 'region',
          seccionClave: 'transporte',
          tipoCampo: 'ReferenciaMaestro',
          tipoCatalogoRef: 'Region',
        }),
        campo({
          campoId: 'c-finca',
          campoClave: 'finca',
          seccionClave: 'detalle_fruta',
          tipoCampo: 'ReferenciaMaestro',
          tipoCatalogoRef: 'Finca',
        }),
      ]);
      httpMock.expectOne(`${LOCAL}/maestros?tipoCatalogo=Piloto`).flush([]);
      httpMock.expectOne(`${LOCAL}/maestros?tipoCatalogo=Transportista`).flush([]);
      httpMock.expectOne(`${LOCAL}/maestros?tipoCatalogo=Equipo`).flush([]);
      httpMock.expectOne(`${LOCAL}/maestros?tipoCatalogo=Region`).flush([]);
      httpMock.expectOne(`${LOCAL}/maestros?tipoCatalogo=Finca`).flush([]);

      component.seleccionarPreIngreso(preIngresoFixture);

      expect(component.preIngresoId()).toBe('pre-1');
      const grupoTransporte = component.formSecciones().get('transporte') as FormGroup;
      expect(grupoTransporte.get('c-piloto')!.value).toBe('piloto-1');
      expect(grupoTransporte.get('c-transportista')!.value).toBe('transportista-1');
      expect(grupoTransporte.get('c-equipo')!.value).toBe('equipo-1');
      expect(grupoTransporte.get('c-region')!.value).toBe('region-1');
      // Editable: la selección no deshabilita el control — la observación del
      // operador puede seguir pisando la declaración de logística.
      expect(grupoTransporte.get('c-piloto')!.disabled).toBe(false);
      const grupoFruta = component.formSecciones().get('detalle_fruta') as FormGroup;
      expect(grupoFruta.get('c-finca')!.value).toBe('finca-1');
    });

    it('sin pre-ingreso seleccionado, crearBoleta manda preIngresoId null y no hay advertencia de vínculo', () => {
      flushInit();
      seleccionarTipo([]);
      component.crearBoleta();

      const req = httpMock.expectOne(`${LOCAL}/boletas`);
      expect(req.request.body.preIngresoId).toBeNull();
      req.flush({ numeroBoleta: 'IF-1' });
      httpMock.expectOne(`${LOCAL}/boletas?estado=EnTransito`).flush([]);

      expect(component.advertenciaPesoPreIngreso()).toBeNull();
    });

    it('la divergencia PesoEnviado/PesoNeto al cerrar muestra una advertencia no bloqueante y no impide cerrar', () => {
      const boletaFixture: BoletaLocal = {
        id: 'b-1',
        numeroBoleta: 'IF-B01-000001',
        tipoMovimientoId: 'tm-1',
        estado: 'EnTransito',
        estadoSync: 'Local',
        pesoIngreso: 20000,
        pesoSalida: null,
        pesoNeto: null,
        origenPesoIngreso: 'Bascula',
        origenPesoSalida: null,
        fechaHoraIngreso: '2026-09-10T12:00:00Z',
        fechaHoraSalida: null,
        usuarioIngreso: 'operador',
        usuarioSalida: null,
        usuarioAnula: null,
        usuarioAutoriza: null,
        motivoAnulacion: null,
        fechaHoraAnulacion: null,
        preIngresoId: 'pre-1',
        boletaReemplazoId: null,
        boletaOrigenId: null,
        basculaSalidaId: null,
        respuestaD365Id: null,
        creadaOffline: true,
      };

      flushInit({ peso: { peso: 3000, origen: 'Bascula' } });
      component.abrirCierre(boletaFixture);
      httpMock.expectOne(`${LOCAL}/preingreso/pre-1`).flush(preIngresoFixture);

      expect(component.advertenciaPesoPreIngreso()).toEqual({ pesoEnviado: 20000, pesoNeto: 17000 });
      // No bloqueante: el cierre sigue permitido pese a la advertencia.
      expect(component.puedeCerrar()).toBe(true);
    });
  });
});
