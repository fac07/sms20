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
import { catchError, forkJoin, of } from 'rxjs';
import { Maestro, MaestrosService } from '../../../api/maestros.service';
import { TipoMovimiento, TiposMovimientoService } from '../../../api/tipos-movimiento.service';
import {
  BoletaLocal,
  CerrarBoletaInput,
  CrearBoletaInput,
  EstadoLocal,
  LecturaPeso,
  LocalServerService,
} from '../../../api/local-server.service';

// No hay auth real todavía (SSO/Entra ID no implementado) — mismo espíritu
// que el resto de la app: un placeholder explícito en vez de una pantalla de
// login falsa, hasta que exista autenticación de verdad.
const USUARIO_PLACEHOLDER = 'operador@naturaceites.com';

const POLL_PESO_MS = 1500;

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
  private readonly maestrosService = inject(MaestrosService);
  private readonly tiposMovimientoService = inject(TiposMovimientoService);
  private readonly message = inject(NzMessageService);
  private readonly fb = inject(FormBuilder);

  readonly tiposMovimiento = signal<TipoMovimiento[]>([]);
  readonly pilotos = signal<Maestro[]>([]);
  readonly transportistas = signal<Maestro[]>([]);
  readonly equipos = signal<Maestro[]>([]);
  readonly terceros = signal<Maestro[]>([]);
  readonly productos = signal<Maestro[]>([]);
  readonly almacenes = signal<Maestro[]>([]);

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
      !this.basculaSinCodigo() && this.lecturaPeso().peso !== null && this.form.valid && !this.guardando(),
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
    // GAP DOCUMENTADO: todavía no existe el snapshot/caché offline de
    // catálogos (esa es la feature "Aprovisionamiento", aún sin construir).
    // Por ahora esta pantalla necesita conectividad con el backend central
    // para poblar estos combos, aunque la Boleta en sí sea 100% offline.
    this.tiposMovimientoService.listar().subscribe({
      next: (tipos) => this.tiposMovimiento.set(tipos),
      error: () => this.message.error('No se pudo cargar Tipos de movimiento — ¿el backend central está arriba?'),
    });

    forkJoin({
      pilotos: this.maestrosService.listar({ tipoCatalogo: 'Piloto' }),
      transportistas: this.maestrosService.listar({ tipoCatalogo: 'Transportista' }),
      equipos: this.maestrosService.listar({ tipoCatalogo: 'Equipo' }),
      terceros: this.maestrosService.listar({ tipoCatalogo: 'Tercero' }),
      productos: this.maestrosService.listar({ tipoCatalogo: 'Producto' }),
      almacenes: this.maestrosService.listar({ tipoCatalogo: 'Almacen' }),
    }).subscribe({
      next: ({ pilotos, transportistas, equipos, terceros, productos, almacenes }) => {
        this.pilotos.set(pilotos);
        this.transportistas.set(transportistas);
        this.equipos.set(equipos);
        this.terceros.set(terceros);
        this.productos.set(productos);
        this.almacenes.set(almacenes);
      },
      error: () => this.message.error('No se pudo cargar Maestros — ¿el backend central está arriba?'),
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
    // En producción esto reflejaría el puerto real conectado a la báscula;
    // hoy en dev lo alimenta el panel flotante de simulación (peso-simulado-panel).
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
        this.cargarBoletasEnTransito();
      },
      error: (err) => {
        this.message.error(err?.error?.error ?? 'No se pudo crear la boleta.');
        this.guardando.set(false);
      },
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
