import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalModule } from 'ng-zorro-antd/modal';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { catchError, of } from 'rxjs';
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

// No hay auth real todavía (SSO/Entra ID no implementado) — mismo espíritu
// que el resto de la app: un placeholder explícito en vez de una pantalla de
// login falsa, hasta que exista autenticación de verdad.
const USUARIO_PLACEHOLDER = 'operador@naturaceites.com';

const POLL_PESO_MS = 1500;

// PR4 — motor configurable pendiente (slice C). Esta pantalla quedó reducida a
// la captura de peso + creación/cierre de boleta contra el servidor local. Las
// secciones de extensión (Calidad, DetalleFruta, Compostera, Características) y
// la cascada post-POST que las persistía se removieron: las reemplaza el
// renderer de campos configurables (`GET /tipos-movimiento/{id}/formulario`).
// La ruta `pesaje` ya no está en el menú y apunta a un placeholder; este
// componente sigue compilando para que slice C lo reconstruya.
@Component({
  imports: [
    CommonModule,
    ReactiveFormsModule,
    NzAlertModule,
    NzButtonModule,
    NzCardModule,
    NzFormModule,
    NzIconModule,
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
  readonly pilotos = signal<MaestroLocal[]>([]);
  readonly transportistas = signal<MaestroLocal[]>([]);
  readonly equipos = signal<MaestroLocal[]>([]);
  readonly terceros = signal<MaestroLocal[]>([]);
  readonly productos = signal<MaestroLocal[]>([]);
  readonly almacenes = signal<MaestroLocal[]>([]);

  readonly lecturaPeso = signal<LecturaPeso>({ peso: null, origen: null });
  readonly estadoLocal = signal<EstadoLocal>({
    aprovisionada: false,
    basculaId: null,
    basculaCodigo: null,
    dev: false,
  });

  readonly guardando = signal(false);
  readonly cargandoTransito = signal(false);
  readonly boletasEnTransito = signal<BoletaLocal[]>([]);
  readonly boletaCerrando = signal<BoletaLocal | null>(null);
  readonly cerrando = signal(false);

  readonly basculaSinCodigo = computed(() => this.estadoLocal().basculaCodigo === null);

  readonly form = this.fb.nonNullable.group({
    tipoMovimientoId: ['', Validators.required],
    equipoId: ['', Validators.required],
    transportistaId: ['', Validators.required],
    pilotoId: ['', Validators.required],
    terceroId: ['', Validators.required],
    productoId: ['', Validators.required],
    almacenOrigenId: [''],
    almacenDestinoId: [''],
  });

  readonly puedeCrear = computed(
    () =>
      !this.basculaSinCodigo() &&
      this.lecturaPeso().peso !== null &&
      this.form.valid &&
      !this.guardando(),
  );

  private intervalId: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.cargarCatalogos();
    this.cargarEstadoLocal();
    this.cargarBoletasEnTransito();

    this.actualizarPeso();
    this.intervalId = setInterval(() => this.actualizarPeso(), POLL_PESO_MS);
  }

  ngOnDestroy(): void {
    if (this.intervalId !== null) clearInterval(this.intervalId);
  }

  private cargarCatalogos(): void {
    // TipoMovimiento sigue pegando directo a Central (gap abierto); los Maestros
    // se leen del caché local (SQLite vía servidor local), offline-capable.
    this.tiposMovimientoService.listar().subscribe({
      next: (tipos) => this.tiposMovimiento.set(tipos),
      error: () =>
        this.message.error(
          'No se pudo cargar Tipos de movimiento — ¿el backend central está arriba?',
        ),
    });

    const maestro = (tipo: string) =>
      this.localServer.listarMaestros(tipo).pipe(catchError(() => of([] as MaestroLocal[])));

    maestro('Piloto').subscribe((m) => this.pilotos.set(m));
    maestro('Transportista').subscribe((m) => this.transportistas.set(m));
    maestro('Equipo').subscribe((m) => this.equipos.set(m));
    maestro('Tercero').subscribe((m) => this.terceros.set(m));
    maestro('Producto').subscribe((m) => this.productos.set(m));
    maestro('Almacen').subscribe((m) => this.almacenes.set(m));
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
    return (
      this.tiposMovimiento().find((t) => t.id === tipoMovimientoId)?.nombre ?? tipoMovimientoId
    );
  }

  crearBoleta(): void {
    if (this.form.invalid || !this.puedeCrear()) {
      this.form.markAllAsTouched();
      return;
    }

    const v = this.form.getRawValue();
    const tipoMovimiento = this.tiposMovimiento().find((t) => t.id === v.tipoMovimientoId);
    const lectura = this.lecturaPeso();
    const estado = this.estadoLocal();

    if (!tipoMovimiento || lectura.peso === null || !estado.basculaCodigo) return;

    const input: CrearBoletaInput = {
      numeroBoletaPrefijo: tipoMovimiento.prefijo,
      codigoBascula: estado.basculaCodigo,
      tipoMovimientoId: v.tipoMovimientoId,
      equipoId: v.equipoId,
      transportistaId: v.transportistaId,
      pilotoId: v.pilotoId,
      terceroId: v.terceroId,
      productoId: v.productoId,
      almacenOrigenId: v.almacenOrigenId || null,
      almacenDestinoId: v.almacenDestinoId || null,
      pesoIngreso: lectura.peso,
      origenPesoIngreso: lectura.origen ?? 'Bascula',
      usuarioIngreso: USUARIO_PLACEHOLDER,
      creadaOffline: true,
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
        this.message.error(err?.error?.error ?? 'No se pudo crear la boleta.');
        this.guardando.set(false);
      },
    });
  }

  private resetearFormulario(): void {
    this.form.reset({
      tipoMovimientoId: '',
      equipoId: '',
      transportistaId: '',
      pilotoId: '',
      terceroId: '',
      productoId: '',
      almacenOrigenId: '',
      almacenDestinoId: '',
    });
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
        this.message.error(err?.error?.error ?? 'No se pudo cerrar la boleta.');
        this.cerrando.set(false);
      },
    });
  }
}
