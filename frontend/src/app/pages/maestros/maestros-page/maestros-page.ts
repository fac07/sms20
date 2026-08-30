import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalModule } from 'ng-zorro-antd/modal';
import { NzPopconfirmModule } from 'ng-zorro-antd/popconfirm';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzTabsModule } from 'ng-zorro-antd/tabs';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';
import {
  GuardarMaestroInput,
  Maestro,
  MaestrosService,
  TIPOS_CATALOGO,
  TipoCatalogo,
} from '../../../api/maestros.service';

@Component({
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    NzButtonModule,
    NzCardModule,
    NzFormModule,
    NzIconModule,
    NzInputModule,
    NzModalModule,
    NzPopconfirmModule,
    NzSelectModule,
    NzTableModule,
    NzTabsModule,
    NzTagModule,
    NzTooltipModule,
  ],
  selector: 'app-maestros-page',
  styleUrl: './maestros-page.css',
  templateUrl: './maestros-page.html',
})
export class MaestrosPage {
  private readonly service = inject(MaestrosService);
  private readonly message = inject(NzMessageService);
  private readonly fb = inject(FormBuilder);

  readonly tipos = TIPOS_CATALOGO;
  readonly tipoActivo = signal<TipoCatalogo>('Piloto');

  readonly maestros = signal<Maestro[]>([]);
  readonly cargando = signal(false);
  readonly guardando = signal(false);
  readonly editando = signal<Maestro | null>(null);
  readonly modalAbierto = signal(false);

  readonly fusionandoDesde = signal<Maestro | null>(null);
  readonly candidatosFusion = signal<Maestro[]>([]);
  readonly oficialSeleccionado = signal<string | null>(null);

  readonly oficiales = computed(() => this.maestros().filter((m) => m.estado === 'Oficial'));
  readonly provisionales = computed(() =>
    this.maestros().filter((m) => m.estado === 'Provisional'),
  );

  readonly form = this.fb.nonNullable.group({
    tipoCatalogo: ['Piloto' as TipoCatalogo, Validators.required],
    codigo: ['', Validators.required],
    nombre: ['', Validators.required],
    datosAdicionales: [''],
  });

  constructor() {
    this.cargar();
  }

  cambiarTipo(tipo: TipoCatalogo): void {
    this.tipoActivo.set(tipo);
    this.cargar();
  }

  cambiarTipoPorIndice(indice: number): void {
    this.cambiarTipo(this.tipos[indice]);
  }

  private cargar(): void {
    this.cargando.set(true);
    this.service.listar({ tipoCatalogo: this.tipoActivo(), incluirInactivos: true }).subscribe({
      next: (maestros) => {
        this.maestros.set(maestros);
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
      tipoCatalogo: this.tipoActivo(),
      codigo: '',
      nombre: '',
      datosAdicionales: '',
    });
    this.modalAbierto.set(true);
  }

  abrirModalEditar(maestro: Maestro): void {
    this.editando.set(maestro);
    this.form.reset({
      tipoCatalogo: maestro.tipoCatalogo,
      codigo: maestro.codigo,
      nombre: maestro.nombre,
      datosAdicionales: maestro.datosAdicionales ?? '',
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

    const valores = this.form.getRawValue();
    const input: GuardarMaestroInput = {
      ...valores,
      datosAdicionales: valores.datosAdicionales.trim() || null,
    };
    const editando = this.editando();
    this.guardando.set(true);

    const request$ = editando
      ? this.service.actualizar(editando.id, input)
      : this.service.crear(input);

    request$.subscribe({
      next: () => {
        this.message.success(editando ? 'Ítem actualizado.' : 'Ítem creado.');
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

  desactivar(maestro: Maestro): void {
    this.service.desactivar(maestro.id).subscribe({
      next: () => {
        this.message.success('Ítem desactivado.');
        this.cargar();
      },
      error: (err) => this.message.error(err?.error ?? 'No se pudo desactivar.'),
    });
  }

  aprobar(maestro: Maestro): void {
    this.service.aprobar(maestro.id).subscribe({
      next: () => {
        this.message.success('Ítem oficializado — se distribuye a las básculas en el próximo sync.');
        this.cargar();
      },
      error: (err) => this.message.error(err?.error ?? 'No se pudo aprobar.'),
    });
  }

  abrirFusion(provisional: Maestro): void {
    this.fusionandoDesde.set(provisional);
    this.oficialSeleccionado.set(null);
    this.candidatosFusion.set(
      this.oficiales().filter((m) => m.tipoCatalogo === provisional.tipoCatalogo),
    );
  }

  cerrarFusion(): void {
    this.fusionandoDesde.set(null);
  }

  confirmarFusion(): void {
    const provisional = this.fusionandoDesde();
    const oficialId = this.oficialSeleccionado();
    if (!provisional || !oficialId) return;

    this.service.fusionar(provisional.id, oficialId).subscribe({
      next: () => {
        this.message.success('Ítems fusionados.');
        this.cerrarFusion();
        this.cargar();
      },
      error: (err) => this.message.error(err?.error ?? 'No se pudo fusionar.'),
    });
  }
}
