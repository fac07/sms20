import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzGridModule } from 'ng-zorro-antd/grid';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalModule } from 'ng-zorro-antd/modal';
import { NzPopconfirmModule } from 'ng-zorro-antd/popconfirm';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzStatisticModule } from 'ng-zorro-antd/statistic';
import { NzSwitchModule } from 'ng-zorro-antd/switch';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';
import {
  DireccionMovimiento,
  GuardarTipoMovimientoInput,
  TipoMovimiento,
  TiposMovimientoService,
} from '../../../api/tipos-movimiento.service';

const CAMPOS_HABILITA: { name: keyof GuardarTipoMovimientoInput; label: string }[] = [
  { name: 'habilitaCalidad', label: 'Calidad' },
  { name: 'habilitaMarchamos', label: 'Marchamos' },
  { name: 'habilitaQR', label: 'QR (transferencias)' },
  { name: 'habilitaDatosFinca', label: 'Datos de finca' },
  { name: 'habilitaDetalleFruta', label: 'Detalle de fruta' },
  { name: 'habilitaCompostera', label: 'Compostera' },
  { name: 'integracionD365', label: 'Integración D365' },
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
    ReactiveFormsModule,
    NzButtonModule,
    NzCardModule,
    NzFormModule,
    NzGridModule,
    NzIconModule,
    NzInputModule,
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
  private readonly message = inject(NzMessageService);
  private readonly fb = inject(FormBuilder);

  readonly camposHabilita = CAMPOS_HABILITA;
  readonly direccionUi = DIRECCION_UI;

  readonly tipos = signal<TipoMovimiento[]>([]);
  readonly cargando = signal(false);
  readonly guardando = signal(false);
  readonly editando = signal<TipoMovimiento | null>(null);
  readonly modalAbierto = signal(false);

  readonly stats = computed(() => {
    const lista = this.tipos();
    return {
      total: lista.length,
      activos: lista.filter((t) => t.activo).length,
      inactivos: lista.filter((t) => !t.activo).length,
      d365: lista.filter((t) => t.integracionD365 && t.activo).length,
    };
  });

  readonly form = this.fb.nonNullable.group({
    codigo: ['', Validators.required],
    nombre: ['', Validators.required],
    prefijo: ['', Validators.required],
    direccion: ['Entrada' as DireccionMovimiento, Validators.required],
    habilitaCalidad: [false],
    habilitaMarchamos: [false],
    habilitaQR: [false],
    habilitaDatosFinca: [false],
    habilitaDetalleFruta: [false],
    habilitaCompostera: [false],
    integracionD365: [false],
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
      habilitaCalidad: false,
      habilitaMarchamos: false,
      habilitaQR: false,
      habilitaDatosFinca: false,
      habilitaDetalleFruta: false,
      habilitaCompostera: false,
      integracionD365: false,
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

  seccionesHabilitadas(tipo: TipoMovimiento): string[] {
    return this.camposHabilita.filter(({ name }) => tipo[name]).map(({ label }) => label);
  }
}
