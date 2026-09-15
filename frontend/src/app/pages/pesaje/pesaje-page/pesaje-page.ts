import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import {
  AbstractControl,
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
import { Observable, Subscription, catchError, forkJoin, of } from 'rxjs';
import { CampoAplicable, ErrorCampo, TipoMovimiento } from '../../../api/configuracion.models';
import {
  AlertasOutbox,
  BoletaLocal,
  CerrarBoletaInput,
  CrearBoletaInput,
  EstadoLocal,
  LecturaPeso,
  LocalServerService,
  MaestroLocal,
  PreIngresoLocal,
  UbicacionDefaults,
  VinculoPilotoTransportistaLocal,
} from '../../../api/local-server.service';
import { hayDivergenciaPeso } from './advertencia-peso';
import { ControlCapturado, armarValores, valoresPrefillPreIngreso } from './armar-valores';
import {
  LineaResumen,
  aplicarErrores,
  construirMapaControles,
  limpiarErroresServidor,
} from './aplicar-errores';
import { AntiguedadSync, calcularAntiguedadSync } from './antiguedad-sync';
import {
  LABELS_MOTIVO_PESO_MANUAL,
  MOTIVO_PESO_MANUAL_OTRO,
  MotivoPesoManual,
} from '../../../api/motivo-peso-manual';
import {
  SeccionRenderizada,
  agruparSecciones,
  limitesNumericos,
  opcionesLista,
} from './secciones';

// No hay auth real todavía (SSO/Entra ID no implementado) — mismo espíritu
// que el resto de la app: un placeholder explícito en vez de una pantalla de
// login falsa, hasta que exista autenticación de verdad.
const USUARIO_PLACEHOLDER = 'operador@naturaceites.com';

const POLL_PESO_MS = 1500;

// Fallback de ingreso manual (decisión de producto #3 / #5, diseño D5): si la
// báscula habilitada lleva 15 s de reloj sin devolver una lectura, aparece la
// opción "Ingresar peso manualmente". Se mide por timestamp de la primera
// lectura nula (no por conteo de polls) para no acoplarse a `POLL_PESO_MS`.
const MS_ESPERA_INGRESO_MANUAL = 15_000;

// El banner de "provisional trabado" se refresca en su propio intervalo lento
// (~30s) — no hace falta la cadencia de 1.5s del peso y no debe martillar
// `GET /outbox/alertas`.
const POLL_ALERTAS_PROVISIONAL_MS = 30_000;

// Sección/clave estándar de la pareja piloto+transportista (PR5b, diseño
// D2/D3). El escopado del combo de piloto es un caso especial de ESTA página
// — no del motor genérico de campos — así que se identifica por
// `seccionClave`+`campoClave`, igual que el backend (`GuardiaVinculoTransporte`)
// lee la pareja por `Campo.Clave` en vez de asumir un `FormControl` fijo.
const SECCION_TRANSPORTE = 'transporte';
const CLAVE_PILOTO = 'piloto';
const CLAVE_TRANSPORTISTA = 'transportista';

// Slice C3 — sobre C1/C2 agrega:
//  - mapeo de `ErrorCampo[]` (400 al crear / 422 al cerrar) a cada control con
//    `{ servidor: mensaje }`, alertas por sección para los errores `(seccion)`
//    y un `nz-alert` de resumen arriba (helpers puros en `aplicar-errores.ts`).
//  - indicador no bloqueante de antigüedad del último sync de configuración,
//    en estilo warning cuando supera 24h (`antiguedad-sync.ts`).
// El agrupado/orden de secciones y los helpers de `Configuracion` viven ahora
// en `secciones.ts` (compartidos con `aplicar-errores.ts`).

/** ¿El cuerpo de la respuesta de error es un `ErrorCampo[]` del motor? */
function esErrorCampoArray(cuerpo: unknown): cuerpo is ErrorCampo[] {
  return (
    Array.isArray(cuerpo) &&
    cuerpo.length > 0 &&
    cuerpo.every(
      (e) =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as ErrorCampo).seccionClave === 'string' &&
        typeof (e as ErrorCampo).campoClave === 'string' &&
        typeof (e as ErrorCampo).ocurrencia === 'number' &&
        typeof (e as ErrorCampo).mensaje === 'string',
    )
  );
}

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
  private readonly message = inject(NzMessageService);
  private readonly fb = inject(FormBuilder);

  readonly tiposMovimiento = signal<TipoMovimiento[]>([]);

  // Se activa solo si, tras intentar un sync eager, el espejo local sigue vacío
  // (instalación nunca sincronizada). Dispara el aviso de "sin conexión" junto
  // al select vacío — nunca con una lista poblada.
  readonly tiposNoDisponibles = signal(false);

  readonly lecturaPeso = signal<LecturaPeso>({ peso: null, origen: null });
  readonly estadoLocal = signal<EstadoLocal>({
    aprovisionada: false,
    basculaId: null,
    basculaCodigo: null,
    dev: false,
  });

  // --- Ingreso manual de peso (fallback tras 15 s sin lectura) ---------------
  // Timestamp (ms) de la primera lectura nula de la racha actual; se limpia en
  // cuanto llega una lectura no nula. Campo plano, evaluado dentro del poll
  // existente — no hay timer nuevo.
  private primeraLecturaNulaEn: number | null = null;

  // La opción "Ingresar peso manualmente" ya está disponible (racha de nulos
  // >= 15 s con la báscula habilitada). Una lectura automática la vuelve a
  // ocultar y saca del modo manual (lo automático tiene prioridad — decisión #3).
  readonly ingresoManualDisponible = signal(false);
  // El operador abrió el formulario de captura manual.
  readonly modoIngresoManual = signal(false);

  readonly pesoManualCtrl = new FormControl<number | null>(null);
  readonly motivoManualCtrl = new FormControl<MotivoPesoManual | null>(null);
  readonly detalleManualCtrl = new FormControl<string>('', { nonNullable: true });

  readonly etiquetasMotivo = LABELS_MOTIVO_PESO_MANUAL;

  readonly guardando = signal(false);
  readonly cargandoFormulario = signal(false);
  readonly camposAplicables = signal<CampoAplicable[]>([]);

  // Opciones de `ReferenciaMaestro` indexadas por `TipoCatalogoRef` — snapshot
  // local, se recarga cada vez que cambia el tipo de movimiento.
  readonly maestrosPorCatalogo = signal<Record<string, MaestroLocal[]>>({});

  // Vínculos activos del transportista actualmente seleccionado en
  // `transporte.transportista` (PR5b, diseño D2/D3) — fuente de escopado
  // offline del combo de piloto, resuelta contra el espejo local vía
  // `GET /vinculos?transportistaId=` (PR5). Vacío mientras no hay
  // transportista elegido: el piloto no ofrece ninguna opción hasta entonces,
  // paridad con legacy `clsPilotos.dtPilotos(transportistaId)` — el combo de
  // piloto NUNCA muestra el catálogo completo como fallback.
  readonly pilotosVinculados = signal<VinculoPilotoTransportistaLocal[]>([]);
  // Suscripción al control `transporte.transportista` — se recrea en cada
  // `cargarFormulario` porque `formSecciones` se reconstruye por completo.
  private transportistaVinculoSub: Subscription | null = null;

  // Tipos de catálogo que la báscula puede coinar como provisional offline (M1)
  // — controla si un combo `ReferenciaMaestro` ofrece el "+ Crear provisional".
  readonly tiposProvisionables = signal<string[]>([]);

  // Diálogo mínimo de creación provisional inline: guarda el control del combo
  // que disparó la creación para poder seleccionar el nuevo provisional al éxito.
  readonly provisionalDialog = signal<{ control: AbstractControl | null; tipoCatalogo: string } | null>(
    null,
  );
  readonly creandoProvisional = signal(false);
  readonly nombreProvisionalCtrl = new FormControl<string>('', {
    nonNullable: true,
    validators: [Validators.required],
  });

  readonly cargandoTransito = signal(false);
  readonly boletasEnTransito = signal<BoletaLocal[]>([]);
  readonly boletaCerrando = signal<BoletaLocal | null>(null);
  readonly cerrando = signal(false);

  // --- Cola de transporte (PreIngreso) — selector, prefill y advertencia de peso ---
  // Lista pendiente del espejo local (offline-safe); se repuebla al filtrar por
  // número de envío y tras cada sync eager.
  readonly pendientesPreIngreso = signal<PreIngresoLocal[]>([]);
  readonly filtroNumeroEnvioCtrl = new FormControl<string>('', { nonNullable: true });
  // Pre-ingreso elegido en el selector — null cuando se pesa sin cola.
  readonly preIngresoSeleccionado = signal<PreIngresoLocal | null>(null);
  readonly preIngresoId = signal<string | null>(null);
  // Pre-ingreso de la boleta que se está cerrando (resuelto por id contra el
  // espejo local) — solo para comparar PesoEnviado vs. el peso neto al cierre.
  readonly preIngresoCerrando = signal<PreIngresoLocal | null>(null);

  // Errores del servidor (400 al crear / 422 al cerrar) mapeados a controles:
  // `resumenErrores` alimenta el `nz-alert` de arriba y `erroresPorSeccion` los
  // `nz-alert` por sección. Se limpian en cada envío y tras un éxito.
  readonly resumenErrores = signal<LineaResumen[]>([]);
  readonly erroresPorSeccion = signal<Record<string, string[]>>({});

  // Un provisional que no logra sincronizar (>= 5 intentos) enciende un banner
  // no bloqueante — el operador puede seguir pesando (M4b/M5b). Un poll fallido
  // se trata como "sin alerta": no se muestra un banner rancio.
  readonly hayAlertaProvisional = signal(false);

  // Indicador de antigüedad del último sync de configuración — nunca bloquea.
  readonly lastConfigSyncAt = signal<string | null>(null);
  readonly antiguedadSync = computed<AntiguedadSync>(() =>
    calcularAntiguedadSync(this.lastConfigSyncAt()),
  );

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

  // Defaults de rutas de transferencia del Centro (espejo de
  // NAT_BSC_Configuraciones del legacy), bajados junto con cada formulario en
  // `cargarFormulario`. Solo alimentan el `valorInicial` de los cuatro campos
  // de `ubicacion` (ver `valorInicialUbicacion`): el operador los edita como
  // cualquier otro campo — nunca se bloquean ni se re-ponen tras tocarlos.
  private ubicacionDefaults: UbicacionDefaults = {};

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
  private alertasIntervalId: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.cargarCatalogos();
    this.cargarEstadoLocal();
    this.cargarConfigEstado();
    this.cargarBoletasEnTransito();
    this.cargarTiposProvisionables();
    this.cargarAlertasProvisional();
    this.cargarPreIngresosPendientes();
    this.dispararSyncPreIngresoEager();

    this.tipoMovimientoCtrl.valueChanges.subscribe((id) => this.cargarFormulario(id));
    this.filtroNumeroEnvioCtrl.valueChanges.subscribe((numeroEnvio) =>
      this.cargarPreIngresosPendientes(numeroEnvio || undefined),
    );

    this.actualizarPeso();
    this.intervalId = setInterval(() => this.actualizarPeso(), POLL_PESO_MS);
    this.alertasIntervalId = setInterval(
      () => this.cargarAlertasProvisional(),
      POLL_ALERTAS_PROVISIONAL_MS,
    );
  }

  ngOnDestroy(): void {
    if (this.intervalId !== null) clearInterval(this.intervalId);
    if (this.alertasIntervalId !== null) clearInterval(this.alertasIntervalId);
    this.transportistaVinculoSub?.unsubscribe();
  }

  private cargarAlertasProvisional(): void {
    this.localServer
      .alertasOutbox()
      .pipe(catchError(() => of<AlertasOutbox | null>(null)))
      .subscribe((alerta) => this.hayAlertaProvisional.set(alerta?.hayAlertaProvisional ?? false));
  }

  private cargarPreIngresosPendientes(numeroEnvio?: string): void {
    this.localServer
      .listarPreIngresosPendientes(numeroEnvio)
      .pipe(catchError(() => of<PreIngresoLocal[]>([])))
      .subscribe((pendientes) => this.pendientesPreIngreso.set(pendientes));
  }

  /** Sync eager de la cola de transporte al entrar a `/pesaje` (D5) + refresco de la lista al terminar. */
  private dispararSyncPreIngresoEager(): void {
    this.localServer
      .sincronizarPreIngreso()
      .pipe(catchError(() => of(null)))
      .subscribe(() =>
        this.cargarPreIngresosPendientes(this.filtroNumeroEnvioCtrl.value || undefined),
      );
  }

  /**
   * Elige un pre-ingreso pendiente: lo recuerda para el payload de creación
   * (`preIngresoId`) y prefillea piloto/transportista/equipo/región/finca
   * como valores EDITABLES — nunca disabled (la observación del operador
   * puede pisar la declaración de logística).
   */
  seleccionarPreIngreso(preIngreso: PreIngresoLocal): void {
    this.preIngresoSeleccionado.set(preIngreso);
    this.preIngresoId.set(preIngreso.id);
    this.prefillDesdePreIngreso(preIngreso);
  }

  /** El operador pesa sin cola — vuelve al camino por defecto (`preIngresoId` null). */
  limpiarPreIngreso(): void {
    this.preIngresoSeleccionado.set(null);
    this.preIngresoId.set(null);
  }

  private prefillDesdePreIngreso(preIngreso: PreIngresoLocal): void {
    const valores = valoresPrefillPreIngreso(this.camposAplicables(), preIngreso);
    for (const [campoId, valor] of Object.entries(valores)) {
      const campo = this.camposAplicables().find((c) => c.campoId === campoId);
      if (campo === undefined) continue;
      this.grupoDeSeccion(campo.seccionClave).get(campoId)?.setValue(valor);
    }
  }

  private cargarCatalogos(): void {
    // A4 — paint desde el espejo local primero (instantáneo, offline-safe),
    // después dispara un sync eager y re-lee la lista cuando termina. La ruta
    // local ya devuelve solo `Activo = 1`, así que el filtro de activos se
    // preserva sin lógica extra acá.
    this.localServer
      .tiposMovimiento()
      .pipe(catchError(() => of<TipoMovimiento[]>([])))
      .subscribe((tipos) => {
        this.tiposMovimiento.set(tipos);
        this.dispararSyncEager();
      });
  }

  /** Sync eager al entrar a `/pesaje` (A3) + refresco del dropdown al terminar (A4). */
  private dispararSyncEager(): void {
    this.localServer
      .sincronizarConfig()
      .pipe(catchError(() => of(null)))
      .subscribe(() => this.refrescarTiposMovimiento());
  }

  private refrescarTiposMovimiento(): void {
    this.localServer
      .tiposMovimiento()
      .pipe(catchError(() => of<TipoMovimiento[]>([])))
      .subscribe((tipos) => {
        this.tiposMovimiento.set(tipos);
        // Instalación nunca sincronizada: el espejo sigue vacío incluso después
        // del sync eager → avisá sin bloquear. No usa `message.error`.
        this.tiposNoDisponibles.set(tipos.length === 0);
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

  private cargarConfigEstado(): void {
    this.localServer
      .configEstado()
      .pipe(catchError(() => of({ lastConfigSyncAt: null })))
      .subscribe((estado) => this.lastConfigSyncAt.set(estado.lastConfigSyncAt));
  }

  private cargarFormulario(tipoMovimientoId: string): void {
    this.camposAplicables.set([]);
    this.maestrosPorCatalogo.set({});
    this.formSecciones.set(this.fb.group({}));
    this.transportistaVinculoSub?.unsubscribe();
    this.transportistaVinculoSub = null;
    this.pilotosVinculados.set([]);

    if (tipoMovimientoId === '') return;

    this.cargandoFormulario.set(true);
    // El formulario y los defaults del centro viajan EN PARALELO. Los defaults
    // son no-críticos: un fallo ahí degrada a `{}` (sin precarga) en vez de
    // tumbar el formulario, del que sí depende la captura.
    forkJoin({
      campos: this.localServer.formulario(tipoMovimientoId),
      defaults: this.localServer
        .configuracionCentro()
        .pipe(catchError(() => of<UbicacionDefaults>({}))),
    })
      .pipe(catchError(() => of(null)))
      .subscribe((par) => {
        this.cargandoFormulario.set(false);
        if (par === null) {
          this.message.error('No se pudo cargar el formulario del tipo de movimiento.');
          return;
        }
        const { campos, defaults } = par;
        this.ubicacionDefaults = defaults;
        this.camposAplicables.set(campos);
        this.formSecciones.set(this.construirFormulario(campos));
        this.cargarMaestrosReferencia(campos);
        this.suscribirTransportistaVinculo(campos);
      });
  }

  /**
   * Escopado offline del combo de piloto (PR5b, diseño D2/D3): se suscribe al
   * control `transporte.transportista` (si el formulario del tipo de
   * movimiento actual lo incluye) para recargar `pilotosVinculados` en cada
   * cambio. Vive FUERA del motor genérico de campos a propósito — es la regla
   * de negocio piloto+transportista que `MotorCampos`/`motor-campos.ts` no
   * debe conocer (17 vectores dorados de paridad).
   */
  private suscribirTransportistaVinculo(campos: readonly CampoAplicable[]): void {
    const campoTransportista = campos.find(
      (c) => c.seccionClave === SECCION_TRANSPORTE && c.campoClave === CLAVE_TRANSPORTISTA,
    );
    if (campoTransportista === undefined) return;

    const control = this.grupoDeSeccion(campoTransportista.seccionClave).get(campoTransportista.campoId);
    if (control === null) return;

    this.transportistaVinculoSub = control.valueChanges.subscribe((transportistaId: unknown) =>
      this.refrescarPilotosVinculados((transportistaId as string | null) || null, campos),
    );
  }

  /**
   * Recarga `pilotosVinculados` para el transportista dado (o la vacía sin
   * transportista) y limpia una selección de piloto que ya no sea válida.
   * Fully offline: `vinculosPorTransportista` resuelve contra el espejo local
   * (`GET /vinculos?transportistaId=`, PR5) — no hay ruta de red central acá.
   */
  private refrescarPilotosVinculados(
    transportistaId: string | null,
    campos: readonly CampoAplicable[],
  ): void {
    if (transportistaId === null) {
      this.pilotosVinculados.set([]);
      this.limpiarPilotoSiInvalido(campos, []);
      return;
    }

    this.localServer
      .vinculosPorTransportista(transportistaId)
      .pipe(catchError(() => of<VinculoPilotoTransportistaLocal[]>([])))
      .subscribe((vinculos) => {
        this.pilotosVinculados.set(vinculos);
        this.limpiarPilotoSiInvalido(campos, vinculos);
      });
  }

  /** Si el piloto seleccionado ya no está entre los vínculos vigentes, lo limpia (nunca lo deja stale/inválido en silencio). */
  private limpiarPilotoSiInvalido(
    campos: readonly CampoAplicable[],
    vinculos: readonly VinculoPilotoTransportistaLocal[],
  ): void {
    const campoPiloto = campos.find(
      (c) => c.seccionClave === SECCION_TRANSPORTE && c.campoClave === CLAVE_PILOTO,
    );
    if (campoPiloto === undefined) return;

    const control = this.grupoDeSeccion(campoPiloto.seccionClave).get(campoPiloto.campoId);
    if (control === null || control.value === null) return;

    const sigueValido = vinculos.some((v) => v.pilotoId === control.value);
    if (!sigueValido) control.setValue(null);
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

    const inicial: unknown =
      campo.tipoCampo === 'Booleano' ? (campo.requerido ? false : null) : this.valorInicialUbicacion(campo);
    return this.fb.control(inicial, validators);
  }

  /**
   * Default del centro para un campo de `ubicacion`, o null. Escopado a la
   * sección y al tipo exactos (ReferenciaMaestro) para no tocar ningún otro
   * campo del formulario; el mapeo clave→default replica el cuarteto de
   * `ConfiguracionCentroDto` central. `agregarOcurrencia` reusa este mismo
   * path (`ubicacion` es Unica, pero la consistencia no depende de eso).
   */
  private valorInicialUbicacion(campo: CampoAplicable): string | null {
    if (campo.seccionClave !== 'ubicacion' || campo.tipoCampo !== 'ReferenciaMaestro') {
      return null;
    }
    const id = (v: string | null | undefined): string | null => v ?? null;
    switch (campo.campoClave) {
      case 'sitio_origen':
        return id(this.ubicacionDefaults.sitioOrigenDefaultId);
      case 'sitio_destino':
        return id(this.ubicacionDefaults.sitioDestinoDefaultId);
      case 'almacen_origen':
        return id(this.ubicacionDefaults.almacenOrigenDefaultId);
      case 'almacen_destino':
        return id(this.ubicacionDefaults.almacenDestinoDefaultId);
      default:
        return null;
    }
  }

  opciones(campo: CampoAplicable): string[] {
    return opcionesLista(campo.configuracion);
  }

  opcionesMaestro(campo: CampoAplicable): MaestroLocal[] {
    const catalogo =
      campo.tipoCatalogoRef !== null ? this.maestrosPorCatalogo()[campo.tipoCatalogoRef] ?? [] : [];

    // Caso especial de ESTA página (PR5b): el combo de piloto se escopa a los
    // vínculos activos del transportista elegido — cualquier otro campo
    // `ReferenciaMaestro` sigue el camino genérico sin tocar.
    if (campo.seccionClave !== SECCION_TRANSPORTE || campo.campoClave !== CLAVE_PILOTO) {
      return catalogo;
    }

    const idsVinculados = new Set(this.pilotosVinculados().map((v) => v.pilotoId));
    return catalogo.filter((m) => idsVinculados.has(m.id));
  }

  private cargarTiposProvisionables(): void {
    this.localServer
      .tiposProvisionables()
      .pipe(catchError(() => of<string[]>([])))
      .subscribe((tipos) => this.tiposProvisionables.set(tipos));
  }

  /** El FormGroup de la ocurrencia 0 de una sección Única — contexto del template. */
  grupoDeSeccion(seccionClave: string): FormGroup {
    const grupo = this.formSecciones().get(seccionClave);
    return grupo instanceof FormGroup ? grupo : this.fb.group({});
  }

  /** ¿El combo de este campo permite coinar un provisional inline (M1)? */
  puedeCrearProvisional(campo: CampoAplicable): boolean {
    return (
      campo.tipoCampo === 'ReferenciaMaestro' &&
      campo.tipoCatalogoRef !== null &&
      this.tiposProvisionables().includes(campo.tipoCatalogoRef)
    );
  }

  abrirCrearProvisional(campo: CampoAplicable, grupo: FormGroup): void {
    if (campo.tipoCatalogoRef === null) return;
    this.nombreProvisionalCtrl.reset('');
    this.provisionalDialog.set({
      control: grupo.get(campo.campoId),
      tipoCatalogo: campo.tipoCatalogoRef,
    });
  }

  cerrarCrearProvisional(): void {
    this.provisionalDialog.set(null);
  }

  confirmarCrearProvisional(): void {
    const ctx = this.provisionalDialog();
    this.nombreProvisionalCtrl.markAsTouched();
    if (!ctx || this.nombreProvisionalCtrl.invalid) return;

    this.creandoProvisional.set(true);
    this.localServer
      .crearMaestroProvisional(ctx.tipoCatalogo, this.nombreProvisionalCtrl.value)
      .subscribe({
        next: (maestro) => {
          this.creandoProvisional.set(false);
          this.provisionalDialog.set(null);

          const mapa = { ...this.maestrosPorCatalogo() };
          mapa[ctx.tipoCatalogo] = [...(mapa[ctx.tipoCatalogo] ?? []), maestro];
          this.maestrosPorCatalogo.set(mapa);

          ctx.control?.setValue(maestro.id);
          this.message.success(`Provisional ${maestro.codigo} creado.`);
        },
        error: (err: unknown) => {
          this.creandoProvisional.set(false);
          const cuerpo = (err as { error?: { mensaje?: string } })?.error;
          this.message.error(cuerpo?.mensaje ?? 'No se pudo crear el registro provisional.');
        },
      });
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
      .pipe(catchError(() => of<LecturaPeso | null>(null)))
      .subscribe((lectura) => {
        // Un fallo HTTP (servidor local caído) se trata igual que una lectura
        // vacía: se limpia `lecturaPeso` para que `puedeCrear()`, el indicador
        // y el fallback de ingreso manual no queden con un valor stale.
        const efectiva: LecturaPeso = lectura ?? { peso: null, origen: null };
        this.lecturaPeso.set(efectiva);
        this.evaluarIngresoManual(efectiva.peso);
      });
  }

  /**
   * Evaluado en cada poll de peso (cada 1.5 s). Marca la disponibilidad del
   * ingreso manual cuando la báscula habilitada acumula >= 15 s sin lectura; una
   * lectura no nula limpia la racha, oculta la opción y sale del modo manual.
   */
  private evaluarIngresoManual(peso: number | null): void {
    if (peso !== null) {
      this.primeraLecturaNulaEn = null;
      if (this.ingresoManualDisponible() || this.modoIngresoManual()) this.salirModoIngresoManual();
      return;
    }

    if (!this.permiteIngresoManual()) {
      this.primeraLecturaNulaEn = null;
      return;
    }

    const ahora = Date.now();
    this.primeraLecturaNulaEn ??= ahora;
    if (ahora - this.primeraLecturaNulaEn >= MS_ESPERA_INGRESO_MANUAL) {
      this.ingresoManualDisponible.set(true);
    }
  }

  /** ¿La báscula tiene habilitado el ingreso manual (config propagada en `/estado`)? */
  permiteIngresoManual(): boolean {
    return this.estadoLocal().permiteIngresoManual === true;
  }

  motivosPesoManual(): MotivoPesoManual[] {
    return this.estadoLocal().motivosPesoManual ?? [];
  }

  private pesoMinimoManual(): number | null {
    return this.estadoLocal().pesoMinimoManual ?? null;
  }

  private pesoMaximoManual(): number | null {
    return this.estadoLocal().pesoMaximoManual ?? null;
  }

  /** El motivo seleccionado exige un detalle libre obligatorio. */
  detalleManualRequerido(): boolean {
    return this.motivoManualCtrl.value === MOTIVO_PESO_MANUAL_OTRO;
  }

  abrirIngresoManual(): void {
    this.modoIngresoManual.set(true);
  }

  /** El operador descarta la captura manual; la opción reaparece si sigue sin lectura. */
  cancelarIngresoManual(): void {
    this.salirModoIngresoManual();
  }

  private salirModoIngresoManual(): void {
    this.ingresoManualDisponible.set(false);
    this.modoIngresoManual.set(false);
    this.pesoManualCtrl.reset(null);
    this.motivoManualCtrl.reset(null);
    this.detalleManualCtrl.reset('');
  }

  /**
   * ¿La captura manual está completa y dentro de rango? El servidor local sigue
   * siendo la autoridad (422); esto solo habilita el botón de envío.
   */
  entradaManualValida(): boolean {
    if (!this.permiteIngresoManual() || !this.modoIngresoManual()) return false;

    const peso = this.pesoManualCtrl.value;
    if (peso === null || !Number.isFinite(peso)) return false;

    const min = this.pesoMinimoManual();
    const max = this.pesoMaximoManual();
    if (min === null && max === null) {
      if (peso <= 0) return false;
    } else if ((min !== null && peso < min) || (max !== null && peso > max)) {
      return false;
    }

    const motivo = this.motivoManualCtrl.value;
    if (motivo === null || !this.motivosPesoManual().includes(motivo)) return false;
    if (motivo === MOTIVO_PESO_MANUAL_OTRO && this.detalleManualCtrl.value.trim() === '') return false;

    return true;
  }

  /** El pesaje se resuelve con la captura manual (no hay lectura automática y la entrada es válida). */
  private usandoEntradaManual(): boolean {
    return this.lecturaPeso().peso === null && this.entradaManualValida();
  }

  private motivoManualPayload(): Pick<CrearBoletaInput, 'motivoPesoManual' | 'motivoPesoManualDetalle'> {
    const detalle = this.detalleManualCtrl.value.trim();
    return {
      motivoPesoManual: this.motivoManualCtrl.value ?? undefined,
      motivoPesoManualDetalle: detalle === '' ? null : detalle,
    };
  }

  nombreTipoMovimiento(tipoMovimientoId: string): string {
    return this.tiposMovimiento().find((t) => t.id === tipoMovimientoId)?.nombre ?? tipoMovimientoId;
  }

  puedeCrear(): boolean {
    return (
      !this.basculaSinCodigo() &&
      (this.lecturaPeso().peso !== null || this.entradaManualValida()) &&
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

    this.limpiarResumenErrores();

    const tipoMovimiento = this.tiposMovimiento().find((t) => t.id === this.tipoMovimientoCtrl.value);
    const lectura = this.lecturaPeso();
    const estado = this.estadoLocal();

    const manual = this.usandoEntradaManual();
    const peso = manual ? this.pesoManualCtrl.value : lectura.peso;

    if (!tipoMovimiento || peso === null || !estado.basculaCodigo) return;

    const input: CrearBoletaInput = {
      numeroBoletaPrefijo: tipoMovimiento.prefijo,
      codigoBascula: estado.basculaCodigo,
      tipoMovimientoId: this.tipoMovimientoCtrl.value,
      pesoIngreso: peso,
      origenPesoIngreso: manual ? 'Manual' : lectura.origen ?? 'Bascula',
      usuarioIngreso: USUARIO_PLACEHOLDER,
      creadaOffline: true,
      valores: armarValores(this.capturarControles()),
      preIngresoId: this.preIngresoId(),
      ...(manual ? this.motivoManualPayload() : {}),
    };

    this.guardando.set(true);
    this.localServer.crearBoleta(input).subscribe({
      next: (boleta) => {
        this.message.success(`Boleta ${boleta.numeroBoleta} creada.`);
        this.guardando.set(false);
        this.limpiarResumenErrores();
        this.resetearFormulario();
        this.cargarBoletasEnTransito();
      },
      error: (err) => {
        this.manejarErrorValidacion(err, 'No se pudo crear la boleta.');
        this.guardando.set(false);
      },
    });
  }

  /** `seccionClave` -> mensajes para el `nz-alert` a nivel de sección (template). */
  mensajesDeSeccion(seccionClave: string): string[] {
    return this.erroresPorSeccion()[seccionClave] ?? [];
  }

  private limpiarResumenErrores(): void {
    limpiarErroresServidor(construirMapaControles(this.secciones(), this.formSecciones()));
    this.resumenErrores.set([]);
    this.erroresPorSeccion.set({});
  }

  /**
   * Ruta de error de crear/cerrar: si el cuerpo es un `ErrorCampo[]`, lo mapea a
   * los controles + alertas por sección + resumen; si no, muestra un mensaje
   * genérico (o el `{ error }` del servidor local).
   */
  private manejarErrorValidacion(err: unknown, fallback: string): void {
    const cuerpo = (err as { error?: unknown })?.error;

    if (esErrorCampoArray(cuerpo)) {
      const mapa = construirMapaControles(this.secciones(), this.formSecciones());
      limpiarErroresServidor(mapa);
      const aplicados = aplicarErrores(cuerpo, mapa, this.camposAplicables());
      this.resumenErrores.set(aplicados.resumen);
      this.erroresPorSeccion.set(aplicados.porSeccion);
      this.message.error('Hay campos con errores de validación — revisá el detalle.');
      return;
    }

    this.resumenErrores.set([]);
    this.erroresPorSeccion.set({});
    if (typeof cuerpo === 'object' && cuerpo !== null && 'error' in cuerpo) {
      const mensaje = (cuerpo as { error?: unknown }).error;
      if (typeof mensaje === 'string') {
        this.message.error(mensaje);
        return;
      }
    }
    this.message.error(fallback);
  }

  private resetearFormulario(): void {
    this.tipoMovimientoCtrl.reset('');
    this.camposAplicables.set([]);
    this.maestrosPorCatalogo.set({});
    this.formSecciones.set(this.fb.group({}));
    this.salirModoIngresoManual();
    this.limpiarPreIngreso();
  }

  abrirCierre(boleta: BoletaLocal): void {
    this.boletaCerrando.set(boleta);
    this.preIngresoCerrando.set(null);
    if (boleta.preIngresoId !== null) {
      this.localServer
        .preIngreso(boleta.preIngresoId)
        .pipe(catchError(() => of<PreIngresoLocal | null>(null)))
        .subscribe((preIngreso) => this.preIngresoCerrando.set(preIngreso));
    }
  }

  cerrarModalCierre(): void {
    this.boletaCerrando.set(null);
    this.preIngresoCerrando.set(null);
  }

  /**
   * Advertencia NO bloqueante de divergencia entre el peso declarado en el
   * pre-ingreso enlazado y el peso neto real estimado con la lectura actual.
   * `null` cuando no hay pre-ingreso enlazado o todavía no hay peso de
   * salida — nunca condiciona `puedeCerrar()`.
   */
  advertenciaPesoPreIngreso(): { pesoEnviado: number; pesoNeto: number } | null {
    const boleta = this.boletaCerrando();
    const preIngreso = this.preIngresoCerrando();
    if (!boleta || !preIngreso) return null;

    const lectura = this.lecturaPeso();
    const pesoSalida = this.usandoEntradaManual() ? this.pesoManualCtrl.value : lectura.peso;
    if (pesoSalida === null) return null;

    const pesoNeto = boleta.pesoIngreso - pesoSalida;
    return hayDivergenciaPeso(preIngreso.pesoEnviado, pesoNeto)
      ? { pesoEnviado: preIngreso.pesoEnviado, pesoNeto }
      : null;
  }

  /** Cierre habilitado: lectura automática disponible o captura manual válida. */
  puedeCerrar(): boolean {
    return this.lecturaPeso().peso !== null || this.entradaManualValida();
  }

  confirmarCierre(): void {
    const boleta = this.boletaCerrando();
    const lectura = this.lecturaPeso();
    const manual = this.usandoEntradaManual();
    const peso = manual ? this.pesoManualCtrl.value : lectura.peso;
    if (!boleta || peso === null) return;

    const input: CerrarBoletaInput = {
      pesoSalida: peso,
      origenPesoSalida: manual ? 'Manual' : lectura.origen ?? 'Bascula',
      usuarioSalida: USUARIO_PLACEHOLDER,
      ...(manual ? this.motivoManualPayload() : {}),
    };

    this.limpiarResumenErrores();
    this.cerrando.set(true);
    this.localServer.cerrarBoleta(boleta.id, input).subscribe({
      next: (cerrada) => {
        this.message.success(
          `Boleta ${cerrada.numeroBoleta} cerrada — peso neto ${cerrada.pesoNeto ?? '—'}.`,
        );
        this.cerrando.set(false);
        this.boletaCerrando.set(null);
        this.preIngresoCerrando.set(null);
        this.limpiarResumenErrores();
        this.salirModoIngresoManual();
        this.cargarBoletasEnTransito();
      },
      error: (err) => {
        // 422 con `ErrorCampo[]`: los errores `(seccion)` de `validarCierre` se
        // muestran en el resumen; la boleta queda `EnTransito`.
        this.manejarErrorValidacion(err, 'No se pudo cerrar la boleta.');
        this.cerrando.set(false);
      },
    });
  }
}
