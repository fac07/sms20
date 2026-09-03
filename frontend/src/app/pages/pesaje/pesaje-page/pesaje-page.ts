import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import {
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
import { NzDatePickerModule } from 'ng-zorro-antd/date-picker';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzInputNumberModule } from 'ng-zorro-antd/input-number';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalModule } from 'ng-zorro-antd/modal';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { Observable, catchError, forkJoin, of } from 'rxjs';
import { CampoAplicable } from '../../../api/configuracion.models';
import { TipoMovimiento, TiposMovimientoService } from '../../../api/tipos-movimiento.service';
import {
  BoletaLocal,
  CerrarBoletaInput,
  CrearBoletaInput,
  EstadoLocal,
  LecturaPeso,
  LocalServerService,
  MaestroLocal,
} from '../../../api/local-server.service';
import { ControlCapturado, armarValores } from './armar-valores';

// No hay auth real todavía (SSO/Entra ID no implementado) — mismo espíritu
// que el resto de la app: un placeholder explícito en vez de una pantalla de
// login falsa, hasta que exista autenticación de verdad.
const USUARIO_PLACEHOLDER = 'operador@naturaceites.com';

const POLL_PESO_MS = 1500;

/** Una sección agrupada del formulario, ya ordenada y con sus campos ordenados por `orden`. */
interface SeccionRenderizada {
  clave: string;
  titulo: string;
  requerida: boolean;
  cardinalidad: 'Unica' | 'Repetible';
  seccionOrden: number;
  campos: CampoAplicable[];
}

/** `snake_clave` -> "Snake Clave" — fallback del encabezado cuando `seccionEtiqueta` viene vacía. */
function titulizarClave(clave: string): string {
  return clave
    .split(/[_\s]+/)
    .filter((p) => p.length > 0)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

/** Claves de `Configuracion` JSON case-insensitive, como el motor (`PropertyNameCaseInsensitive`). */
function leerConfiguracion(configuracion: string | null): Record<string, unknown> {
  if (configuracion === null || configuracion.trim() === '') return {};
  try {
    const crudo = JSON.parse(configuracion) as Record<string, unknown>;
    const norm: Record<string, unknown> = {};
    for (const clave of Object.keys(crudo)) norm[clave.toLowerCase()] = crudo[clave];
    return norm;
  } catch {
    return {};
  }
}

/** Opciones de un campo `Lista` desde su `Configuracion` JSON. */
function opcionesLista(configuracion: string | null): string[] {
  const valor = leerConfiguracion(configuracion)['opciones'];
  return Array.isArray(valor)
    ? valor.filter((o: unknown): o is string => typeof o === 'string')
    : [];
}

/** Cotas numéricas (`min` / `max`) de un campo `Entero` / `Decimal` desde su `Configuracion`. */
function limitesNumericos(configuracion: string | null): { min?: number; max?: number } {
  const cfg = leerConfiguracion(configuracion);
  const out: { min?: number; max?: number } = {};
  if (typeof cfg['min'] === 'number') out.min = cfg['min'];
  if (typeof cfg['max'] === 'number') out.max = cfg['max'];
  return out;
}

/**
 * Agrupa `CampoAplicable[]` por sección y ordena de forma determinista:
 * secciones por `seccionOrden` (luego clave), campos por `orden` (luego clave).
 * El encabezado usa `seccionEtiqueta` (`Seccion.Nombre`) y cae a la clave
 * titulizada cuando viene vacía.
 */
function agruparSecciones(campos: readonly CampoAplicable[]): SeccionRenderizada[] {
  const porClave = new Map<string, SeccionRenderizada>();
  for (const campo of campos) {
    let seccion = porClave.get(campo.seccionClave);
    if (seccion === undefined) {
      seccion = {
        clave: campo.seccionClave,
        titulo: campo.seccionEtiqueta.trim() !== ''
          ? campo.seccionEtiqueta
          : titulizarClave(campo.seccionClave),
        requerida: campo.seccionRequerida,
        cardinalidad: campo.cardinalidad,
        seccionOrden: campo.seccionOrden,
        campos: [],
      };
      porClave.set(campo.seccionClave, seccion);
    }
    seccion.campos.push(campo);
  }

  const secciones = [...porClave.values()];
  for (const seccion of secciones) {
    seccion.campos.sort((a, b) => a.orden - b.orden || a.campoClave.localeCompare(b.campoClave));
  }
  secciones.sort((a, b) => a.seccionOrden - b.seccionOrden || a.clave.localeCompare(b.clave));
  return secciones;
}

// Slice C2 — renderer del motor configurable sobre C1. Agrega:
//  - secciones `Repetible` como `FormArray` de ocurrencias con "Agregar" y
//    quitar por fila; `Unica` sigue siendo un único grupo en la ocurrencia 0.
//  - opciones de `ReferenciaMaestro` cargadas del cache local de maestros por
//    `TipoCatalogoRef` (batch `forkJoin`).
//  - cotas numéricas de `Configuracion` (min/max) mapeadas a validators.
//  - orden determinista de secciones/campos vía `Orden` / `SeccionOrden`.
//
// Fuera de C2 (llega en C3): mapeo de 422/400 -> control + resumen, banner de
// staleness de config, ruta/menú y el spec dedicado de `pesaje-page`.
@Component({
  imports: [
    CommonModule,
    ReactiveFormsModule,
    NzAlertModule,
    NzButtonModule,
    NzCardModule,
    NzCheckboxModule,
    NzDatePickerModule,
    NzFormModule,
    NzIconModule,
    NzInputModule,
    NzInputNumberModule,
    NzModalModule,
    NzSelectModule,
    NzTableModule,
    NzTagModule,
  ],
  selector: 'app-pesaje-page',
  styleUrl: './pesaje-page.css',
  templateUrl: './pesaje-page.html',
})
export class PesajePage implements OnInit, OnDestroy {
  private readonly localServer = inject(LocalServerService);
  private readonly tiposMovimientoService = inject(TiposMovimientoService);
  private readonly message = inject(NzMessageService);
  private readonly fb = inject(FormBuilder);

  readonly tiposMovimiento = signal<TipoMovimiento[]>([]);

  readonly lecturaPeso = signal<LecturaPeso>({ peso: null, origen: null });
  readonly estadoLocal = signal<EstadoLocal>({
    aprovisionada: false,
    basculaId: null,
    basculaCodigo: null,
    dev: false,
  });

  readonly guardando = signal(false);
  readonly cargandoFormulario = signal(false);
  readonly camposAplicables = signal<CampoAplicable[]>([]);

  // Opciones de `ReferenciaMaestro` indexadas por `TipoCatalogoRef` — snapshot
  // local, se recarga cada vez que cambia el tipo de movimiento.
  readonly maestrosPorCatalogo = signal<Record<string, MaestroLocal[]>>({});

  readonly cargandoTransito = signal(false);
  readonly boletasEnTransito = signal<BoletaLocal[]>([]);
  readonly boletaCerrando = signal<BoletaLocal | null>(null);
  readonly cerrando = signal(false);

  readonly basculaSinCodigo = computed(() => this.estadoLocal().basculaCodigo === null);

  // Control del tipo de movimiento: dispara la carga del formulario. Va aparte
  // del FormGroup dinámico de secciones porque su ciclo de vida es distinto
  // (persiste mientras las secciones se reconstruyen).
  readonly tipoMovimientoCtrl = new FormControl<string>('', {
    nonNullable: true,
    validators: [Validators.required],
  });

  // FormGroup dinámico: { [seccionClave]: FormGroup | FormArray<FormGroup> }.
  // `Unica` -> un FormGroup (ocurrencia 0). `Repetible` -> un FormArray de
  // FormGroups, uno por ocurrencia.
  formSecciones = signal<FormGroup>(this.fb.group({}));

  readonly secciones = computed<SeccionRenderizada[]>(() =>
    agruparSecciones(this.camposAplicables()),
  );

  readonly tipoMovimientoSeleccionado = computed(() => this.tipoMovimientoCtrl.value !== '');
  readonly sinSecciones = computed(
    () =>
      this.tipoMovimientoSeleccionado() &&
      !this.cargandoFormulario() &&
      this.camposAplicables().length === 0,
  );

  private intervalId: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.cargarCatalogos();
    this.cargarEstadoLocal();
    this.cargarBoletasEnTransito();

    this.tipoMovimientoCtrl.valueChanges.subscribe((id) => this.cargarFormulario(id));

    this.actualizarPeso();
    this.intervalId = setInterval(() => this.actualizarPeso(), POLL_PESO_MS);
  }

  ngOnDestroy(): void {
    if (this.intervalId !== null) clearInterval(this.intervalId);
  }

  private cargarCatalogos(): void {
    // TipoMovimiento sigue pegando directo a Central (gap abierto); los campos
    // configurables sí se resuelven contra el espejo local, offline-capable.
    this.tiposMovimientoService.listar().subscribe({
      next: (tipos) => this.tiposMovimiento.set(tipos),
      error: () =>
        this.message.error(
          'No se pudo cargar Tipos de movimiento — ¿el backend central está arriba?',
        ),
    });
  }

  private cargarEstadoLocal(): void {
    this.localServer
      .obtenerEstado()
      .pipe(catchError(() => of(null)))
      .subscribe((estado) => {
        if (!estado) {
          this.message.error('No se pudo conectar con el servidor local (127.0.0.1:4127).');
          return;
        }
        this.estadoLocal.set(estado);
      });
  }

  private cargarFormulario(tipoMovimientoId: string): void {
    this.camposAplicables.set([]);
    this.maestrosPorCatalogo.set({});
    this.formSecciones.set(this.fb.group({}));

    if (tipoMovimientoId === '') return;

    this.cargandoFormulario.set(true);
    this.localServer
      .formulario(tipoMovimientoId)
      .pipe(catchError(() => of(null)))
      .subscribe((campos) => {
        this.cargandoFormulario.set(false);
        if (campos === null) {
          this.message.error('No se pudo cargar el formulario del tipo de movimiento.');
          return;
        }
        this.camposAplicables.set(campos);
        this.formSecciones.set(this.construirFormulario(campos));
        this.cargarMaestrosReferencia(campos);
      });
  }

  /** Batch-load de los catálogos referenciados por los campos `ReferenciaMaestro`. */
  private cargarMaestrosReferencia(campos: readonly CampoAplicable[]): void {
    const catalogos = [
      ...new Set(
        campos
          .filter((c) => c.tipoCampo === 'ReferenciaMaestro' && c.tipoCatalogoRef !== null)
          .map((c) => c.tipoCatalogoRef as string),
      ),
    ];
    if (catalogos.length === 0) {
      this.maestrosPorCatalogo.set({});
      return;
    }

    const peticiones: Record<string, Observable<MaestroLocal[]>> = {};
    for (const catalogo of catalogos) {
      peticiones[catalogo] = this.localServer
        .listarMaestros(catalogo)
        .pipe(catchError(() => of([] as MaestroLocal[])));
    }

    forkJoin(peticiones).subscribe((mapa) => this.maestrosPorCatalogo.set(mapa));
  }

  private construirFormulario(campos: readonly CampoAplicable[]): FormGroup {
    const grupo: Record<string, FormGroup | FormArray> = {};
    for (const seccion of agruparSecciones(campos)) {
      if (seccion.cardinalidad === 'Repetible') {
        // Una sección repetible requerida arranca con una fila; una opcional
        // arranca vacía (cero ocurrencias cierra bien — regla de `validarCierre`).
        const filas = seccion.requerida ? [this.crearGrupoOcurrencia(seccion.campos)] : [];
        grupo[seccion.clave] = this.fb.array(filas);
      } else {
        grupo[seccion.clave] = this.crearGrupoOcurrencia(seccion.campos);
      }
    }
    return this.fb.group(grupo);
  }

  private crearGrupoOcurrencia(campos: readonly CampoAplicable[]): FormGroup {
    const grupo: Record<string, FormControl> = {};
    for (const campo of campos) grupo[campo.campoId] = this.crearControl(campo);
    return this.fb.group(grupo);
  }

  private crearControl(campo: CampoAplicable): FormControl {
    const validators: ValidatorFn[] = campo.requerido ? [Validators.required] : [];

    if (campo.tipoCampo === 'Entero' || campo.tipoCampo === 'Decimal') {
      const { min, max } = limitesNumericos(campo.configuracion);
      if (min !== undefined) validators.push(Validators.min(min));
      if (max !== undefined) validators.push(Validators.max(max));
    }

    const inicial: unknown = campo.tipoCampo === 'Booleano' ? (campo.requerido ? false : null) : null;
    return this.fb.control(inicial, validators);
  }

  opciones(campo: CampoAplicable): string[] {
    return opcionesLista(campo.configuracion);
  }

  opcionesMaestro(campo: CampoAplicable): MaestroLocal[] {
    return campo.tipoCatalogoRef !== null
      ? this.maestrosPorCatalogo()[campo.tipoCatalogoRef] ?? []
      : [];
  }

  ocurrenciasDe(seccionClave: string): FormGroup[] {
    const arr = this.formSecciones().get(seccionClave);
    return arr instanceof FormArray ? (arr.controls as FormGroup[]) : [];
  }

  agregarOcurrencia(seccionClave: string): void {
    const arr = this.formSecciones().get(seccionClave);
    const seccion = this.secciones().find((s) => s.clave === seccionClave);
    if (arr instanceof FormArray && seccion !== undefined) {
      arr.push(this.crearGrupoOcurrencia(seccion.campos));
    }
  }

  quitarOcurrencia(seccionClave: string, indice: number): void {
    const arr = this.formSecciones().get(seccionClave);
    if (!(arr instanceof FormArray)) return;
    const seccion = this.secciones().find((s) => s.clave === seccionClave);
    // Una sección requerida no se queda sin ninguna fila desde la UI.
    if (seccion?.requerida && arr.length <= 1) return;
    arr.removeAt(indice);
  }

  private cargarBoletasEnTransito(): void {
    this.cargandoTransito.set(true);
    this.localServer
      .listarBoletasEnTransito()
      .pipe(catchError(() => of(null)))
      .subscribe((boletas) => {
        this.cargandoTransito.set(false);
        if (!boletas) {
          this.message.error('No se pudo conectar con el servidor local (127.0.0.1:4127).');
          return;
        }
        this.boletasEnTransito.set(boletas);
      });
  }

  private actualizarPeso(): void {
    this.localServer
      .obtenerPeso()
      .pipe(catchError(() => of(null)))
      .subscribe((lectura) => {
        if (lectura) this.lecturaPeso.set(lectura);
      });
  }

  nombreTipoMovimiento(tipoMovimientoId: string): string {
    return this.tiposMovimiento().find((t) => t.id === tipoMovimientoId)?.nombre ?? tipoMovimientoId;
  }

  puedeCrear(): boolean {
    return (
      !this.basculaSinCodigo() &&
      this.lecturaPeso().peso !== null &&
      this.tipoMovimientoCtrl.valid &&
      this.formSecciones().valid &&
      !this.cargandoFormulario() &&
      !this.guardando()
    );
  }

  private capturarControles(): ControlCapturado[] {
    const form = this.formSecciones();
    const capturados: ControlCapturado[] = [];

    for (const seccion of this.secciones()) {
      const ctrl = form.get(seccion.clave);

      if (seccion.cardinalidad === 'Repetible' && ctrl instanceof FormArray) {
        ctrl.controls.forEach((grupo, ocurrencia) => {
          for (const campo of seccion.campos) {
            capturados.push({
              campo,
              ocurrencia,
              valor: grupo.get(campo.campoId)?.value ?? null,
            });
          }
        });
      } else if (ctrl instanceof FormGroup) {
        for (const campo of seccion.campos) {
          capturados.push({
            campo,
            ocurrencia: 0,
            valor: ctrl.get(campo.campoId)?.value ?? null,
          });
        }
      }
    }

    return capturados;
  }

  crearBoleta(): void {
    this.tipoMovimientoCtrl.markAsTouched();
    this.formSecciones().markAllAsTouched();

    if (!this.puedeCrear()) return;

    const tipoMovimiento = this.tiposMovimiento().find((t) => t.id === this.tipoMovimientoCtrl.value);
    const lectura = this.lecturaPeso();
    const estado = this.estadoLocal();

    if (!tipoMovimiento || lectura.peso === null || !estado.basculaCodigo) return;

    const input: CrearBoletaInput = {
      numeroBoletaPrefijo: tipoMovimiento.prefijo,
      codigoBascula: estado.basculaCodigo,
      tipoMovimientoId: this.tipoMovimientoCtrl.value,
      pesoIngreso: lectura.peso,
      origenPesoIngreso: lectura.origen ?? 'Bascula',
      usuarioIngreso: USUARIO_PLACEHOLDER,
      creadaOffline: true,
      valores: armarValores(this.capturarControles()),
    };

    this.guardando.set(true);
    this.localServer.crearBoleta(input).subscribe({
      next: (boleta) => {
        this.message.success(`Boleta ${boleta.numeroBoleta} creada.`);
        this.guardando.set(false);
        this.resetearFormulario();
        this.cargarBoletasEnTransito();
      },
      error: (err) => {
        // El mapeo de `ErrorCampo[]` (400) a cada control llega en C3; por ahora
        // un mensaje genérico.
        this.message.error(this.mensajeError(err, 'No se pudo crear la boleta.'));
        this.guardando.set(false);
      },
    });
  }

  private mensajeError(err: unknown, fallback: string): string {
    const cuerpo = (err as { error?: unknown })?.error;
    if (typeof cuerpo === 'object' && cuerpo !== null && 'error' in cuerpo) {
      const mensaje = (cuerpo as { error?: unknown }).error;
      if (typeof mensaje === 'string') return mensaje;
    }
    if (Array.isArray(cuerpo) && cuerpo.length > 0) {
      return 'Hay campos con errores de validación — revisá los datos capturados.';
    }
    return fallback;
  }

  private resetearFormulario(): void {
    this.tipoMovimientoCtrl.reset('');
    this.camposAplicables.set([]);
    this.maestrosPorCatalogo.set({});
    this.formSecciones.set(this.fb.group({}));
  }

  abrirCierre(boleta: BoletaLocal): void {
    this.boletaCerrando.set(boleta);
  }

  cerrarModalCierre(): void {
    this.boletaCerrando.set(null);
  }

  confirmarCierre(): void {
    const boleta = this.boletaCerrando();
    const lectura = this.lecturaPeso();
    if (!boleta || lectura.peso === null) return;

    const input: CerrarBoletaInput = {
      pesoSalida: lectura.peso,
      origenPesoSalida: lectura.origen ?? 'Bascula',
      usuarioSalida: USUARIO_PLACEHOLDER,
    };

    this.cerrando.set(true);
    this.localServer.cerrarBoleta(boleta.id, input).subscribe({
      next: (cerrada) => {
        this.message.success(
          `Boleta ${cerrada.numeroBoleta} cerrada — peso neto ${cerrada.pesoNeto ?? '—'}.`,
        );
        this.cerrando.set(false);
        this.boletaCerrando.set(null);
        this.cargarBoletasEnTransito();
      },
      error: (err) => {
        // 422 con `ErrorCampo[]`: el mapeo a control + resumen llega en C3.
        this.message.error(this.mensajeError(err, 'No se pudo cerrar la boleta.'));
        this.cerrando.set(false);
      },
    });
  }
}
