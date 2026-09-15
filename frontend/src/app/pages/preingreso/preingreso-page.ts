import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
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
import { Maestro, MaestrosService } from '../../api/maestros.service';
import {
  GuardarPreIngresoInput,
  PreIngreso,
  PreingresosService,
} from '../../api/preingresos.service';
import { TransporteService, VinculoPilotoTransportista } from '../../api/transporte.service';

// No hay autenticación real todavía — mismo placeholder que pesaje-page hasta
// que exista un servicio de sesión/usuario.
const USUARIO_PLACEHOLDER = 'admin@naturaceites.com';

/**
 * CRUD admin de la cola de transporte (`preingreso-queue`): alta, edición y
 * cancelación de pre-ingresos. Edición y cancelación solo aplican mientras el
 * registro está `Pendiente` — una vez `Vinculado` o `Cancelado` la máquina de
 * estados del central (D4) es terminal para el CRUD admin.
 */
@Component({
  imports: [
    CommonModule,
    ReactiveFormsModule,
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
  selector: 'app-preingreso-page',
  styleUrl: './preingreso-page.css',
  templateUrl: './preingreso-page.html',
})
export class PreingresoPage {
  private readonly service = inject(PreingresosService);
  private readonly maestrosService = inject(MaestrosService);
  private readonly transporteService = inject(TransporteService);
  private readonly message = inject(NzMessageService);
  private readonly fb = inject(FormBuilder);

  readonly preingresos = signal<PreIngreso[]>([]);
  readonly centros = signal<Maestro[]>([]);
  readonly pilotos = signal<Maestro[]>([]);
  readonly transportistas = signal<Maestro[]>([]);
  readonly vinculos = signal<VinculoPilotoTransportista[]>([]);
  readonly equipos = signal<Maestro[]>([]);
  readonly fincas = signal<Maestro[]>([]);
  readonly regiones = signal<Maestro[]>([]);
  readonly cargando = signal(false);
  readonly guardando = signal(false);
  readonly editando = signal<PreIngreso | null>(null);
  readonly modalAbierto = signal(false);

  readonly form = this.fb.nonNullable.group({
    centroId: ['', Validators.required],
    numeroEnvio: ['', Validators.required],
    pesoEnviado: this.fb.control<number | null>(null, Validators.required),
    pilotoId: this.fb.control<string | null>(null),
    transportistaId: this.fb.control<string | null>(null),
    equipoId: this.fb.control<string | null>(null),
    regionId: this.fb.control<string | null>(null),
    fincaId: this.fb.control<string | null>(null),
    racimos: this.fb.control<number | null>(null),
    sacos: this.fb.control<number | null>(null),
  });

  /** Bridge de `transportistaId` (FormControl) a signal, para el `computed()` de abajo (design D8). */
  private readonly transportistaIdSeleccionado = toSignal(
    this.form.controls.transportistaId.valueChanges,
    { initialValue: this.form.controls.transportistaId.value },
  );

  /**
   * Pilotos habilitados para el transportista elegido, derivados de los
   * catálogos ya cargados — sin llamada HTTP por selección (design D8). Sin
   * transportista elegido, no se ofrece ningún piloto (misma regla de
   * paridad legacy que PR5b: nunca cae al catálogo completo sin escopar).
   */
  readonly pilotosVinculados = computed(() => {
    const transportistaId = this.transportistaIdSeleccionado();
    if (!transportistaId) return [];
    const idsVinculados = new Set(
      this.vinculos()
        .filter((v) => v.activo && v.transportistaId === transportistaId)
        .map((v) => v.pilotoId),
    );
    return this.pilotos().filter((p) => idsVinculados.has(p.id));
  });

  constructor() {
    this.cargar();
    this.maestrosService
      .listar({ tipoCatalogo: 'Centro' })
      .subscribe((centros) => this.centros.set(centros));
    this.maestrosService
      .listarOficialesActivos('Piloto')
      .subscribe((pilotos) => this.pilotos.set(pilotos));
    this.maestrosService
      .listarOficialesActivos('Transportista')
      .subscribe((transportistas) => this.transportistas.set(transportistas));
    this.maestrosService
      .listarOficialesActivos('Equipo')
      .subscribe((equipos) => this.equipos.set(equipos));
    this.maestrosService
      .listarOficialesActivos('Finca')
      .subscribe((fincas) => this.fincas.set(fincas));
    this.maestrosService
      .listarOficialesActivos('Region')
      .subscribe((regiones) => this.regiones.set(regiones));
    this.transporteService.listar().subscribe((vinculos) => this.vinculos.set(vinculos));

    // Si al cambiar de transportista el piloto ya elegido queda fuera del
    // nuevo alcance, se limpia — nunca se deja una selección inválida (task 6.3).
    this.form.controls.transportistaId.valueChanges.subscribe(() => {
      const pilotoActual = this.form.controls.pilotoId.value;
      if (pilotoActual && !this.pilotosVinculados().some((p) => p.id === pilotoActual)) {
        this.form.controls.pilotoId.setValue(null);
      }
    });
  }

  /** Solo se puede editar o cancelar mientras el estado es Pendiente (design D4). */
  puedeEditar(preingreso: PreIngreso): boolean {
    return preingreso.estado === 'Pendiente';
  }

  private cargar(): void {
    this.cargando.set(true);
    this.service.listar().subscribe({
      next: (preingresos) => {
        this.preingresos.set(preingresos);
        this.cargando.set(false);
      },
      error: () => {
        this.message.error('No se pudo cargar la cola de transporte.');
        this.cargando.set(false);
      },
    });
  }

  abrirModalCrear(): void {
    this.editando.set(null);
    this.form.reset({
      centroId: '',
      numeroEnvio: '',
      pesoEnviado: null,
      pilotoId: null,
      transportistaId: null,
      equipoId: null,
      regionId: null,
      fincaId: null,
      racimos: null,
      sacos: null,
    });
    this.modalAbierto.set(true);
  }

  abrirModalEditar(preingreso: PreIngreso): void {
    this.editando.set(preingreso);
    this.form.reset({
      centroId: preingreso.centroId,
      numeroEnvio: preingreso.numeroEnvio,
      pesoEnviado: preingreso.pesoEnviado,
      pilotoId: preingreso.pilotoId,
      transportistaId: preingreso.transportistaId,
      equipoId: preingreso.equipoId,
      regionId: preingreso.regionId,
      fincaId: preingreso.fincaId,
      racimos: preingreso.racimos,
      sacos: preingreso.sacos,
    });
    this.modalAbierto.set(true);
  }

  cerrarModal(): void {
    this.modalAbierto.set(false);
    this.editando.set(null);
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const v = this.form.getRawValue();
    const input: GuardarPreIngresoInput = {
      centroId: v.centroId,
      numeroEnvio: v.numeroEnvio,
      pesoEnviado: v.pesoEnviado ?? 0,
      pilotoId: v.pilotoId,
      transportistaId: v.transportistaId,
      equipoId: v.equipoId,
      regionId: v.regionId,
      fincaId: v.fincaId,
      racimos: v.racimos,
      sacos: v.sacos,
    };

    const editando = this.editando();
    this.guardando.set(true);
    const request$ = editando
      ? this.service.actualizar(editando.id, input)
      : this.service.crear({ ...input, usuarioCreacion: USUARIO_PLACEHOLDER });

    request$.subscribe({
      next: () => {
        this.message.success(editando ? 'Pre-ingreso actualizado.' : 'Pre-ingreso creado.');
        this.guardando.set(false);
        this.cerrarModal();
        this.cargar();
      },
      error: (err) => {
        this.message.error(err?.error ?? 'No se pudo guardar el pre-ingreso.');
        this.guardando.set(false);
      },
    });
  }

  cancelar(preingreso: PreIngreso): void {
    this.service
      .cancelar(preingreso.id, { usuarioCancela: USUARIO_PLACEHOLDER, motivoCancelacion: null })
      .subscribe({
        next: () => {
          this.message.success('Pre-ingreso cancelado.');
          this.cargar();
        },
        error: (err) => this.message.error(err?.error ?? 'No se pudo cancelar el pre-ingreso.'),
      });
  }
}
