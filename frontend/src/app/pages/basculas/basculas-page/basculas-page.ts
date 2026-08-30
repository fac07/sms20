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
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';
import { Maestro, MaestrosService } from '../../../api/maestros.service';
import {
  Bascula,
  BasculasService,
  CodigoAprovisionamiento,
  GuardarBasculaInput,
  TipoConexion,
} from '../../../api/basculas.service';

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
    NzTooltipModule,
  ],
  selector: 'app-basculas-page',
  styleUrl: './basculas-page.css',
  templateUrl: './basculas-page.html',
})
export class BasculasPage {
  private readonly service = inject(BasculasService);
  private readonly maestrosService = inject(MaestrosService);
  private readonly message = inject(NzMessageService);
  private readonly fb = inject(FormBuilder);

  readonly basculas = signal<Bascula[]>([]);
  readonly centros = signal<Maestro[]>([]);
  readonly cargando = signal(false);
  readonly guardando = signal(false);
  readonly editando = signal<Bascula | null>(null);
  readonly modalAbierto = signal(false);
  readonly codigoGenerado = signal<CodigoAprovisionamiento | null>(null);

  readonly form = this.fb.nonNullable.group({
    codigo: ['', Validators.required],
    nombre: ['', Validators.required],
    centroId: ['', Validators.required],
    tipoConexion: ['Serial' as TipoConexion, Validators.required],
    puerto: [''],
    ip: [''],
    puertoTcp: this.fb.control<number | null>(null),
    velocidad: this.fb.control<number | null>(9600),
    bitsDatos: this.fb.control<number | null>(8),
    modoComunicacion: [''],
  });

  // Los controles de Reactive Forms no son señales — sin este puente,
  // `esSerial` no se re-evaluaría cuando cambia tipoConexion.
  private readonly tipoConexionValor = toSignal(this.form.controls.tipoConexion.valueChanges, {
    initialValue: this.form.controls.tipoConexion.value,
  });
  readonly esSerial = computed(() => this.tipoConexionValor() === 'Serial');

  constructor() {
    this.cargar();
    this.maestrosService
      .listar({ tipoCatalogo: 'Centro' })
      .subscribe((centros) => this.centros.set(centros));
  }

  private cargar(): void {
    this.cargando.set(true);
    this.service.listar(true).subscribe({
      next: (basculas) => {
        this.basculas.set(basculas);
        this.cargando.set(false);
      },
      error: () => {
        this.message.error('No se pudo cargar el listado — ¿el backend central está arriba?');
        this.cargando.set(false);
      },
    });
  }

  abrirModalCrear(): void {
    this.editando.set(null);
    this.form.reset({
      codigo: '',
      nombre: '',
      centroId: '',
      tipoConexion: 'Serial',
      puerto: '',
      ip: '',
      puertoTcp: null,
      velocidad: 9600,
      bitsDatos: 8,
      modoComunicacion: '',
    });
    this.modalAbierto.set(true);
  }

  abrirModalEditar(bascula: Bascula): void {
    this.editando.set(bascula);
    this.form.reset({
      codigo: bascula.codigo,
      nombre: bascula.nombre,
      centroId: bascula.centroId,
      tipoConexion: bascula.tipoConexion,
      puerto: bascula.puerto ?? '',
      ip: bascula.ip ?? '',
      puertoTcp: bascula.puertoTcp,
      velocidad: bascula.velocidad,
      bitsDatos: bascula.bitsDatos,
      modoComunicacion: bascula.modoComunicacion ?? '',
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
    const input: GuardarBasculaInput = {
      codigo: v.codigo,
      nombre: v.nombre,
      centroId: v.centroId,
      tipoConexion: v.tipoConexion,
      puerto: v.tipoConexion === 'Serial' ? v.puerto || null : null,
      ip: v.tipoConexion === 'Ethernet' ? v.ip || null : null,
      puertoTcp: v.tipoConexion === 'Ethernet' ? v.puertoTcp : null,
      velocidad: v.tipoConexion === 'Serial' ? v.velocidad : null,
      bitsDatos: v.tipoConexion === 'Serial' ? v.bitsDatos : null,
      modoComunicacion: v.modoComunicacion || null,
    };

    const editando = this.editando();
    this.guardando.set(true);
    const request$ = editando
      ? this.service.actualizar(editando.id, input)
      : this.service.crear(input);

    request$.subscribe({
      next: () => {
        this.message.success(editando ? 'Báscula actualizada.' : 'Báscula creada.');
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

  desactivar(bascula: Bascula): void {
    this.service.desactivar(bascula.id).subscribe({
      next: () => {
        this.message.success('Báscula desactivada.');
        this.cargar();
      },
      error: (err) => this.message.error(err?.error ?? 'No se pudo desactivar.'),
    });
  }

  generarCodigo(bascula: Bascula): void {
    this.service.generarCodigo(bascula.id).subscribe({
      next: (codigo) => {
        this.codigoGenerado.set(codigo);
        this.cargar();
      },
      error: (err) => this.message.error(err?.error ?? 'No se pudo generar el código.'),
    });
  }

  cerrarCodigoGenerado(): void {
    this.codigoGenerado.set(null);
  }
}
