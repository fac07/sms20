import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
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
import { Cardinalidad } from '../../../api/configuracion.models';
import {
  GuardarSeccionInput,
  SeccionDto,
  SeccionesService,
} from '../../../api/secciones.service';

// Las secciones marcadas `estandar` son parte del seed inmutable del backend
// (SeccionEstandar.cs). El servidor rechaza con 409 GuardiaEstandar cualquier
// intento de renombrar la clave, desactivarlas o borrarlas. El bloqueo en la
// UI (controles deshabilitados, sin acción de borrado) es solo un adelanto:
// la fuente de verdad es el 409 del servidor, que siempre se muestra literal.
const CARDINALIDADES: Cardinalidad[] = ['Unica', 'Repetible'];

const LOCK_TOOLTIP = 'Sección estándar — bloqueada';

@Component({
  imports: [
    CommonModule,
    ReactiveFormsModule,
    NzButtonModule,
    NzCardModule,
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
  selector: 'app-secciones-page',
  styleUrl: './secciones-page.css',
  templateUrl: './secciones-page.html',
})
export class SeccionesPage {
  private readonly service = inject(SeccionesService);
  private readonly message = inject(NzMessageService);
  private readonly fb = inject(FormBuilder);

  readonly cardinalidades = CARDINALIDADES;
  readonly lockTooltip = LOCK_TOOLTIP;

  readonly lista = signal<SeccionDto[]>([]);
  readonly cargando = signal(false);
  readonly guardando = signal(false);
  readonly editando = signal<SeccionDto | null>(null);
  readonly modalAbierto = signal(false);

  readonly stats = computed(() => {
    const lista = this.lista();
    return {
      total: lista.length,
      activas: lista.filter((s) => s.activa).length,
      estandar: lista.filter((s) => s.estandar).length,
      configurables: lista.filter((s) => !s.estandar).length,
    };
  });

  readonly form = this.fb.nonNullable.group({
    clave: [
      '',
      [Validators.required, Validators.pattern(/^[a-z][a-z0-9_]{0,49}$/)],
    ],
    nombre: ['', Validators.required],
    cardinalidad: ['Unica' as Cardinalidad, Validators.required],
    reportable: [false],
    orden: [0, Validators.required],
    activa: [true],
  });

  constructor() {
    this.cargar();
  }

  private cargar(): void {
    this.cargando.set(true);
    this.service.listar(true).subscribe({
      next: (lista) => {
        this.lista.set(lista);
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
      clave: '',
      nombre: '',
      cardinalidad: 'Unica',
      reportable: false,
      orden: 0,
      activa: true,
    });
    this.form.controls.clave.enable();
    this.form.controls.activa.enable();
    this.modalAbierto.set(true);
  }

  abrirModalEditar(seccion: SeccionDto): void {
    this.editando.set(seccion);
    this.form.reset({
      clave: seccion.clave,
      nombre: seccion.nombre,
      cardinalidad: seccion.cardinalidad,
      reportable: seccion.reportable,
      orden: seccion.orden,
      activa: seccion.activa,
    });
    // Candado estándar (adelanto de la GuardiaEstandar del servidor): la clave
    // y el estado activa no se pueden tocar en una sección estándar.
    if (seccion.estandar) {
      this.form.controls.clave.disable();
      this.form.controls.activa.disable();
    } else {
      this.form.controls.clave.enable();
      this.form.controls.activa.enable();
    }
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

    const valores = this.form.getRawValue();
    const editando = this.editando();
    this.guardando.set(true);

    const request$ = editando
      ? this.service.actualizar(editando.id, valores as GuardarSeccionInput)
      : this.service.crear({
          clave: valores.clave,
          nombre: valores.nombre,
          cardinalidad: valores.cardinalidad,
          reportable: valores.reportable,
          orden: valores.orden,
        });

    request$.subscribe({
      next: () => {
        this.message.success(editando ? 'Sección actualizada.' : 'Sección creada.');
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

  eliminar(seccion: SeccionDto): void {
    this.service.eliminar(seccion.id).subscribe({
      next: () => {
        this.message.success('Sección eliminada.');
        this.cargar();
      },
      error: (err) => this.message.error(err?.error ?? 'No se pudo eliminar.'),
    });
  }
}
