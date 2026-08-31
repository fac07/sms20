import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzInputNumberModule } from 'ng-zorro-antd/input-number';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalModule } from 'ng-zorro-antd/modal';
import { NzPopconfirmModule } from 'ng-zorro-antd/popconfirm';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { catchError, forkJoin, of } from 'rxjs';
import { Maestro, MaestrosService } from '../../../api/maestros.service';
import { TipoMovimiento, TiposMovimientoService } from '../../../api/tipos-movimiento.service';
import {
  AgregarBoletaCaracteristicaInput,
  AgregarBoletaDetalleFrutaInput,
  BoletaCalidadLocal,
  BoletaCaracteristicaLocal,
  BoletaComposteraLocal,
  BoletaDetalleFrutaLocal,
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
    NzInputModule,
    NzInputNumberModule,
    NzModalModule,
    NzPopconfirmModule,
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
  readonly camas = signal<Maestro[]>([]);
  readonly seccionesCompostera = signal<Maestro[]>([]);
  readonly ciclosCompostera = signal<Maestro[]>([]);

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

  // Modal de Detalle — extensiones de Boleta (Calidad, DetalleFruta,
  // Compostera, Caracteristica). Ver abrirDetalle().
  readonly boletaDetalle = signal<BoletaLocal | null>(null);
  readonly cargandoDetalle = signal(false);
  readonly guardandoCalidad = signal(false);
  readonly calidad = signal<BoletaCalidadLocal | null>(null);
  readonly guardandoCompostera = signal(false);
  readonly compostera = signal<BoletaComposteraLocal | null>(null);
  readonly detalleFruta = signal<BoletaDetalleFrutaLocal[]>([]);
  readonly agregandoDetalleFruta = signal(false);
  readonly caracteristicas = signal<BoletaCaracteristicaLocal[]>([]);
  readonly agregandoCaracteristica = signal(false);

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

  readonly formCalidad = this.fb.nonNullable.group({
    acidez: [null as number | null],
    dobi: [null as number | null],
    humedad: [null as number | null],
    temperatura: [null as number | null],
    numeroRevisionQA: [''],
  });

  readonly formCompostera = this.fb.nonNullable.group({
    cui: ['', Validators.required],
    camaId: ['', Validators.required],
    seccionId: ['', Validators.required],
    cicloId: ['', Validators.required],
  });

  readonly formDetalleFruta = this.fb.nonNullable.group({
    racimosVerdes: [0, Validators.required],
    racimosMaduros: [0, Validators.required],
    racimosSobreMaduros: [0, Validators.required],
    racimosPasados: [0, Validators.required],
    pedunculoLargo: [0, Validators.required],
    sacos: [0, Validators.required],
    jornales: [0, Validators.required],
    hectareas: [0, Validators.required],
  });

  readonly formCaracteristica = this.fb.nonNullable.group({
    clave: ['', Validators.required],
    valor: ['', Validators.required],
    tipoDato: ['texto', Validators.required],
  });

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
      camas: this.maestrosService.listar({ tipoCatalogo: 'Cama' }),
      seccionesCompostera: this.maestrosService.listar({ tipoCatalogo: 'SeccionCompostera' }),
      ciclosCompostera: this.maestrosService.listar({ tipoCatalogo: 'CicloCompostera' }),
    }).subscribe({
      next: ({
        pilotos,
        transportistas,
        equipos,
        terceros,
        productos,
        almacenes,
        camas,
        seccionesCompostera,
        ciclosCompostera,
      }) => {
        this.pilotos.set(pilotos);
        this.transportistas.set(transportistas);
        this.equipos.set(equipos);
        this.terceros.set(terceros);
        this.productos.set(productos);
        this.almacenes.set(almacenes);
        this.camas.set(camas);
        this.seccionesCompostera.set(seccionesCompostera);
        this.ciclosCompostera.set(ciclosCompostera);
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
      habilitaCalidad: tipoMovimiento.habilitaCalidad,
      habilitaDetalleFruta: tipoMovimiento.habilitaDetalleFruta,
      habilitaCompostera: tipoMovimiento.habilitaCompostera,
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

  // Modal de Detalle — extensiones de Boleta. Solo se cargan las secciones
  // que el TipoMovimiento de esta boleta tiene habilitadas (flags
  // denormalizados en BoletaLocal); Características es ungated, igual que
  // en el servidor local. Un 404 en Calidad/Compostera es normal cuando
  // todavía no se guardó nada — no es error.
  abrirDetalle(boleta: BoletaLocal): void {
    this.boletaDetalle.set(boleta);
    this.formCalidad.reset({
      acidez: null,
      dobi: null,
      humedad: null,
      temperatura: null,
      numeroRevisionQA: '',
    });
    this.formCompostera.reset({ cui: '', camaId: '', seccionId: '', cicloId: '' });
    this.formDetalleFruta.reset({
      racimosVerdes: 0,
      racimosMaduros: 0,
      racimosSobreMaduros: 0,
      racimosPasados: 0,
      pedunculoLargo: 0,
      sacos: 0,
      jornales: 0,
      hectareas: 0,
    });
    this.formCaracteristica.reset({ clave: '', valor: '', tipoDato: 'texto' });
    this.calidad.set(null);
    this.compostera.set(null);
    this.detalleFruta.set([]);
    this.caracteristicas.set([]);

    this.cargandoDetalle.set(true);

    const calidad$ = boleta.habilitaCalidad
      ? this.localServer.obtenerCalidad(boleta.id).pipe(
          catchError((err) => {
            if (err?.status !== 404) {
              this.message.error(err?.error?.error ?? 'No se pudo cargar Calidad.');
            }
            return of(null);
          }),
        )
      : of(null);

    const compostera$ = boleta.habilitaCompostera
      ? this.localServer.obtenerCompostera(boleta.id).pipe(
          catchError((err) => {
            if (err?.status !== 404) {
              this.message.error(err?.error?.error ?? 'No se pudo cargar Compostera.');
            }
            return of(null);
          }),
        )
      : of(null);

    const detalleFruta$ = boleta.habilitaDetalleFruta
      ? this.localServer.listarDetalleFruta(boleta.id).pipe(
          catchError((err) => {
            this.message.error(err?.error?.error ?? 'No se pudo cargar Detalle de fruta.');
            return of([] as BoletaDetalleFrutaLocal[]);
          }),
        )
      : of([] as BoletaDetalleFrutaLocal[]);

    const caracteristicas$ = this.localServer.listarCaracteristicas(boleta.id).pipe(
      catchError((err) => {
        this.message.error(err?.error?.error ?? 'No se pudo cargar Características.');
        return of([] as BoletaCaracteristicaLocal[]);
      }),
    );

    forkJoin({
      calidad: calidad$,
      compostera: compostera$,
      detalleFruta: detalleFruta$,
      caracteristicas: caracteristicas$,
    }).subscribe(({ calidad, compostera, detalleFruta, caracteristicas }) => {
      this.cargandoDetalle.set(false);
      this.calidad.set(calidad);
      this.compostera.set(compostera);
      this.detalleFruta.set(detalleFruta);
      this.caracteristicas.set(caracteristicas);

      if (calidad) {
        this.formCalidad.patchValue({
          acidez: calidad.acidez,
          dobi: calidad.dobi,
          humedad: calidad.humedad,
          temperatura: calidad.temperatura,
          numeroRevisionQA: calidad.numeroRevisionQA ?? '',
        });
      }
      if (compostera) {
        this.formCompostera.patchValue({
          cui: compostera.cui,
          camaId: compostera.camaId,
          seccionId: compostera.seccionId,
          cicloId: compostera.cicloId,
        });
      }
    });
  }

  cerrarDetalle(): void {
    this.boletaDetalle.set(null);
    this.calidad.set(null);
    this.compostera.set(null);
    this.detalleFruta.set([]);
    this.caracteristicas.set([]);
  }

  guardarCalidad(): void {
    if (this.formCalidad.invalid) {
      this.formCalidad.markAllAsTouched();
      return;
    }
    const boleta = this.boletaDetalle();
    if (!boleta) return;

    this.guardandoCalidad.set(true);
    this.localServer.guardarCalidad(boleta.id, this.formCalidad.getRawValue()).subscribe({
      next: (calidad) => {
        this.message.success('Calidad guardada.');
        this.calidad.set(calidad);
        this.guardandoCalidad.set(false);
      },
      error: (err) => {
        this.message.error(err?.error?.error ?? 'No se pudo guardar Calidad.');
        this.guardandoCalidad.set(false);
      },
    });
  }

  guardarCompostera(): void {
    if (this.formCompostera.invalid) {
      this.formCompostera.markAllAsTouched();
      return;
    }
    const boleta = this.boletaDetalle();
    if (!boleta) return;

    this.guardandoCompostera.set(true);
    this.localServer.guardarCompostera(boleta.id, this.formCompostera.getRawValue()).subscribe({
      next: (compostera) => {
        this.message.success('Compostera guardada.');
        this.compostera.set(compostera);
        this.guardandoCompostera.set(false);
      },
      error: (err) => {
        this.message.error(err?.error?.error ?? 'No se pudo guardar Compostera.');
        this.guardandoCompostera.set(false);
      },
    });
  }

  agregarDetalleFruta(): void {
    if (this.formDetalleFruta.invalid) {
      this.formDetalleFruta.markAllAsTouched();
      return;
    }
    const boleta = this.boletaDetalle();
    if (!boleta) return;

    const input: AgregarBoletaDetalleFrutaInput = this.formDetalleFruta.getRawValue();

    this.agregandoDetalleFruta.set(true);
    this.localServer.agregarDetalleFruta(boleta.id, input).subscribe({
      next: (detalle) => {
        this.message.success('Detalle de fruta agregado.');
        this.detalleFruta.update((lista) => [...lista, detalle]);
        this.agregandoDetalleFruta.set(false);
        this.formDetalleFruta.reset({
          racimosVerdes: 0,
          racimosMaduros: 0,
          racimosSobreMaduros: 0,
          racimosPasados: 0,
          pedunculoLargo: 0,
          sacos: 0,
          jornales: 0,
          hectareas: 0,
        });
      },
      error: (err) => {
        this.message.error(err?.error?.error ?? 'No se pudo agregar el detalle de fruta.');
        this.agregandoDetalleFruta.set(false);
      },
    });
  }

  eliminarDetalleFruta(id: string): void {
    const boleta = this.boletaDetalle();
    if (!boleta) return;

    this.localServer.eliminarDetalleFruta(boleta.id, id).subscribe({
      next: () => this.detalleFruta.update((lista) => lista.filter((d) => d.id !== id)),
      error: (err) => this.message.error(err?.error?.error ?? 'No se pudo eliminar el detalle de fruta.'),
    });
  }

  agregarCaracteristica(): void {
    if (this.formCaracteristica.invalid) {
      this.formCaracteristica.markAllAsTouched();
      return;
    }
    const boleta = this.boletaDetalle();
    if (!boleta) return;

    const input: AgregarBoletaCaracteristicaInput = this.formCaracteristica.getRawValue();

    this.agregandoCaracteristica.set(true);
    this.localServer.agregarCaracteristica(boleta.id, input).subscribe({
      next: (caracteristica) => {
        this.message.success('Característica agregada.');
        this.caracteristicas.update((lista) => [...lista, caracteristica]);
        this.agregandoCaracteristica.set(false);
        this.formCaracteristica.reset({ clave: '', valor: '', tipoDato: 'texto' });
      },
      error: (err) => {
        this.message.error(err?.error?.error ?? 'No se pudo agregar la característica.');
        this.agregandoCaracteristica.set(false);
      },
    });
  }

  eliminarCaracteristica(id: string): void {
    const boleta = this.boletaDetalle();
    if (!boleta) return;

    this.localServer.eliminarCaracteristica(boleta.id, id).subscribe({
      next: () => this.caracteristicas.update((lista) => lista.filter((c) => c.id !== id)),
      error: (err) => this.message.error(err?.error?.error ?? 'No se pudo eliminar la característica.'),
    });
  }
}
