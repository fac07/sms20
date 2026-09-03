import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
import { NzDrawerModule } from 'ng-zorro-antd/drawer';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzGridModule } from 'ng-zorro-antd/grid';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzInputNumberModule } from 'ng-zorro-antd/input-number';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalModule } from 'ng-zorro-antd/modal';
import { NzPopconfirmModule } from 'ng-zorro-antd/popconfirm';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzStatisticModule } from 'ng-zorro-antd/statistic';
import { NzSwitchModule } from 'ng-zorro-antd/switch';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';
import { OperacionD365 } from '../../../api/configuracion.models';
import { SeccionDto, SeccionesService } from '../../../api/secciones.service';
import {
  AsignacionSeccionInput,
  DireccionMovimiento,
  GuardarTipoMovimientoInput,
  TipoMovimiento,
  TiposMovimientoService,
} from '../../../api/tipos-movimiento.service';

// Fila de la sub-vista de asignación de secciones: una por SeccionDto, con el
// estado editable (asignada / orden / requerida) inicializado desde las
// asignaciones vigentes del tipo de movimiento.
interface FilaSeccion {
  seccion: SeccionDto;
  asignada: boolean;
  orden: number;
  requerida: boolean;
}

// El contrato TipoMovimiento perdió los 6 flags habilita* (el motor
// configurable resuelve qué secciones aplican) y el bool integracionD365
// (reemplazado por operacionD365 nullable). La asignación de secciones llega
// como sub-vista en PR4.
const OPERACIONES_D365: OperacionD365[] = [
  'IngresoFruta',
  'TransferenciaCreacion',
  'TransferenciaRecepcion',
  'RecepcionOC',
  'SalidaOV',
];

const DIRECCION_UI: Record<
  DireccionMovimiento,
  { tagColor: string; iconColor: string; iconBg: string; icon: string }
> = {
  Entrada: { tagColor: 'green', iconColor: '#3F8F6E', iconBg: '#3F8F6E1a', icon: 'import' },
  Salida: { tagColor: 'gold', iconColor: '#B8711F', iconBg: '#B8711F1a', icon: 'export' },
  Transferencia: { tagColor: 'blue', iconColor: '#2F6FED', iconBg: '#2F6FED1a', icon: 'swap' },
};

@Component({
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    NzButtonModule,
    NzCardModule,
    NzCheckboxModule,
    NzDrawerModule,
    NzEmptyModule,
    NzFormModule,
    NzGridModule,
    NzIconModule,
    NzInputModule,
    NzInputNumberModule,
    NzModalModule,
    NzPopconfirmModule,
    NzSelectModule,
    NzStatisticModule,
    NzSwitchModule,
    NzTableModule,
    NzTagModule,
    NzTooltipModule,
  ],
  selector: 'app-tipos-movimiento-page',
  styleUrl: './tipos-movimiento-page.css',
  templateUrl: './tipos-movimiento-page.html',
})
export class TiposMovimientoPage {
  private readonly service = inject(TiposMovimientoService);
  private readonly seccionesService = inject(SeccionesService);
  private readonly message = inject(NzMessageService);
  private readonly fb = inject(FormBuilder);

  readonly operacionesD365 = OPERACIONES_D365;
  readonly direccionUi = DIRECCION_UI;

  readonly tipos = signal<TipoMovimiento[]>([]);
  readonly cargando = signal(false);
  readonly guardando = signal(false);
  readonly editando = signal<TipoMovimiento | null>(null);
  readonly modalAbierto = signal(false);

  // Sub-vista de asignación de secciones (drawer). El PUT es declarativo: se
  // envía el set deseado completo y las secciones omitidas quedan
  // desasignadas (VigenteHasta) por el backend, nunca borradas.
  readonly seccionesDrawerAbierto = signal(false);
  readonly asignando = signal<TipoMovimiento | null>(null);
  readonly cargandoSecciones = signal(false);
  readonly guardandoSecciones = signal(false);
  readonly filasSeccion = signal<FilaSeccion[]>([]);

  readonly stats = computed(() => {
    const lista = this.tipos();
    return {
      total: lista.length,
      activos: lista.filter((t) => t.activo).length,
      inactivos: lista.filter((t) => !t.activo).length,
      d365: lista.filter((t) => t.operacionD365 !== null && t.activo).length,
    };
  });

  readonly form = this.fb.nonNullable.group({
    codigo: ['', Validators.required],
    nombre: ['', Validators.required],
    prefijo: ['', Validators.required],
    direccion: ['Entrada' as DireccionMovimiento, Validators.required],
    operacionD365: [null as OperacionD365 | null],
    generaQR: [false],
  });

  constructor() {
    this.cargar();
  }

  private cargar(): void {
    this.cargando.set(true);
    this.service.listar(true).subscribe({
      next: (tipos) => {
        this.tipos.set(tipos);
        this.cargando.set(false);
      },
      error: () => {
        this.message.error('No se pudo cargar el catálogo — ¿el backend central está arriba?');
        this.cargando.set(false);
      },
    });
  }

  abrirModalCrear(): void {
    this.editando.set(null);
    this.form.reset({
      codigo: '',
      nombre: '',
      prefijo: '',
      direccion: 'Entrada',
      operacionD365: null,
      generaQR: false,
    });
    this.modalAbierto.set(true);
  }

  abrirModalEditar(tipo: TipoMovimiento): void {
    this.editando.set(tipo);
    this.form.reset(tipo);
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

    const input: GuardarTipoMovimientoInput = { ...this.form.getRawValue(), formatoBoletaId: null };
    const editando = this.editando();
    this.guardando.set(true);

    const request$ = editando
      ? this.service.actualizar(editando.id, input)
      : this.service.crear(input);

    request$.subscribe({
      next: () => {
        this.message.success(editando ? 'Tipo de movimiento actualizado.' : 'Tipo de movimiento creado.');
        this.guardando.set(false);
        this.cerrarModal();
        this.cargar();
      },
      error: (err) => {
        this.message.error(err?.error ?? 'No se pudo guardar.');
        this.guardando.set(false);
      },
    });
  }

  desactivar(tipo: TipoMovimiento): void {
    this.service.desactivar(tipo.id).subscribe({
      next: () => {
        this.message.success('Tipo de movimiento desactivado.');
        this.cargar();
      },
      error: (err) => this.message.error(err?.error ?? 'No se pudo desactivar.'),
    });
  }

  abrirSecciones(tipo: TipoMovimiento): void {
    this.asignando.set(tipo);
    this.seccionesDrawerAbierto.set(true);
    this.filasSeccion.set([]);
    this.cargandoSecciones.set(true);

    forkJoin({
      secciones: this.seccionesService.listar(),
      asignadas: this.service.listarSecciones(tipo.id),
    }).subscribe({
      next: ({ secciones, asignadas }) => {
        const porId = new Map(asignadas.map((a) => [a.seccionId, a]));
        this.filasSeccion.set(
          [...secciones]
            .sort((a, b) => a.orden - b.orden)
            .map((seccion) => {
              const vigente = porId.get(seccion.id);
              return {
                seccion,
                asignada: vigente !== undefined,
                orden: vigente?.orden ?? seccion.orden,
                requerida: vigente?.requerida ?? false,
              };
            }),
        );
        this.cargandoSecciones.set(false);
      },
      error: (err) => {
        this.message.error(err?.error ?? 'No se pudieron cargar las secciones.');
        this.cargandoSecciones.set(false);
      },
    });
  }

  cerrarSecciones(): void {
    this.seccionesDrawerAbierto.set(false);
    this.asignando.set(null);
    this.filasSeccion.set([]);
  }

  alternarSeccion(seccionId: string, asignada: boolean): void {
    this.filasSeccion.update((filas) =>
      filas.map((f) => (f.seccion.id === seccionId ? { ...f, asignada } : f)),
    );
  }

  cambiarOrdenSeccion(seccionId: string, orden: number): void {
    this.filasSeccion.update((filas) =>
      filas.map((f) => (f.seccion.id === seccionId ? { ...f, orden: orden ?? 0 } : f)),
    );
  }

  cambiarRequeridaSeccion(seccionId: string, requerida: boolean): void {
    this.filasSeccion.update((filas) =>
      filas.map((f) => (f.seccion.id === seccionId ? { ...f, requerida } : f)),
    );
  }

  guardarSecciones(): void {
    const tipo = this.asignando();
    if (!tipo) return;

    const payload: AsignacionSeccionInput[] = this.filasSeccion()
      .filter((f) => f.asignada)
      .map((f) => ({ seccionId: f.seccion.id, requerida: f.requerida, orden: f.orden }));

    this.guardandoSecciones.set(true);
    this.service.asignarSecciones(tipo.id, payload).subscribe({
      next: () => {
        this.message.success('Secciones actualizadas.');
        this.guardandoSecciones.set(false);
        this.cerrarSecciones();
      },
      error: (err) => {
        this.message.error(err?.error ?? 'No se pudieron guardar las secciones.');
        this.guardandoSecciones.set(false);
      },
    });
  }
}
