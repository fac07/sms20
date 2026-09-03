import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
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
import {
  ActualizarCampoInput,
  CampoDto,
  CamposService,
  CrearCampoInput,
  NuevaVersionCampoInput,
} from '../../../api/campos.service';
import {
  RESERVED_CLAVES,
  TipoCampo,
  TipoCatalogoRef,
} from '../../../api/configuracion.models';
import { TIPOS_CATALOGO } from '../../../api/maestros.service';
import { SeccionDto, SeccionesService } from '../../../api/secciones.service';
import { ConfiguracionCampoEditor } from '../configuracion-campo-editor/configuracion-campo-editor';

const TIPOS_CAMPO: TipoCampo[] = [
  'Texto',
  'Entero',
  'Decimal',
  'Fecha',
  'FechaHora',
  'Booleano',
  'Lista',
  'ReferenciaMaestro',
];

const VERSION_AVISO =
  'Crea una versión nueva de este campo. La versión actual deja de aplicar a ' +
  'boletas creadas de ahora en más; las boletas existentes no cambian.';

@Component({
  imports: [
    CommonModule,
    FormsModule,
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
    ConfiguracionCampoEditor,
  ],
  selector: 'app-campos-page',
  styleUrl: './campos-page.css',
  templateUrl: './campos-page.html',
})
export class CamposPage {
  private readonly camposService = inject(CamposService);
  private readonly seccionesService = inject(SeccionesService);
  private readonly message = inject(NzMessageService);
  private readonly fb = inject(FormBuilder);

  readonly tiposCampo = TIPOS_CAMPO;
  readonly tiposCatalogo = TIPOS_CATALOGO;
  readonly versionAviso = VERSION_AVISO;

  readonly secciones = signal<SeccionDto[]>([]);
  readonly seccionSeleccionadaId = signal<string | null>(null);
  readonly campos = signal<CampoDto[]>([]);
  readonly cargando = signal(false);
  readonly guardando = signal(false);
  readonly editando = signal<CampoDto | null>(null);
  readonly versionando = signal<CampoDto | null>(null);
  readonly modalAbierto = signal(false);
  readonly modalVersionAbierto = signal(false);
  readonly verHistoricos = signal(false);

  readonly tipoCampoActual = signal<TipoCampo>('Texto');
  readonly configJson = signal<string | null>(null);
  readonly configValido = signal(true);

  readonly seccionSeleccionada = computed(
    () => this.secciones().find((s) => s.id === this.seccionSeleccionadaId()) ?? null,
  );

  readonly camposVisibles = computed(() => {
    const todos = this.campos();
    return this.verHistoricos() ? todos : todos.filter((c) => c.vigenteHasta == null);
  });

  readonly stats = computed(() => {
    const vigentes = this.campos().filter((c) => c.vigenteHasta == null);
    const tipos = new Set(vigentes.map((c) => c.tipoCampo));
    return {
      total: vigentes.length,
      requeridos: vigentes.filter((c) => c.requerido).length,
      tipos: tipos.size,
    };
  });

  readonly form = this.fb.group({
    clave: this.fb.nonNullable.control('', [
      Validators.required,
      Validators.pattern(/^[a-z][a-z0-9_]{0,49}$/),
    ]),
    etiqueta: this.fb.nonNullable.control('', Validators.required),
    tipoCampo: this.fb.nonNullable.control<TipoCampo>('Texto', Validators.required),
    tipoCatalogoRef: this.fb.control<TipoCatalogoRef | null>(null),
    requerido: this.fb.nonNullable.control(false),
    orden: this.fb.nonNullable.control(0, Validators.required),
  });

  readonly formEdit = this.fb.nonNullable.group({
    etiqueta: ['', Validators.required],
    requerido: [false],
    orden: [0, Validators.required],
  });

  readonly formVersion = this.fb.nonNullable.group({
    etiqueta: ['', Validators.required],
    requerido: [false],
    orden: [0, Validators.required],
  });

  constructor() {
    this.form.controls.tipoCampo.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((tipo) => {
        this.tipoCampoActual.set(tipo);
        if (tipo !== 'ReferenciaMaestro') {
          this.form.controls.tipoCatalogoRef.setValue(null);
        }
      });

    this.cargarSecciones();
  }

  private cargarSecciones(): void {
    this.seccionesService.listar().subscribe({
      next: (secciones) => this.secciones.set(secciones),
      error: () =>
        this.message.error('No se pudieron cargar las secciones — ¿el backend central está arriba?'),
    });
  }

  seleccionarSeccion(id: string | null): void {
    this.seccionSeleccionadaId.set(id);
    this.cargarCampos();
  }

  toggleHistoricos(): void {
    this.verHistoricos.update((v) => !v);
    this.cargarCampos();
  }

  private cargarCampos(): void {
    const seccionId = this.seccionSeleccionadaId();
    if (!seccionId) {
      this.campos.set([]);
      return;
    }
    this.cargando.set(true);
    this.camposService.listar(seccionId, this.verHistoricos()).subscribe({
      next: (campos) => {
        this.campos.set(campos);
        this.cargando.set(false);
      },
      error: () => {
        this.message.error('No se pudieron cargar los campos.');
        this.cargando.set(false);
      },
    });
  }

  esReservado(clave: string): boolean {
    const seccion = this.seccionSeleccionada();
    if (!seccion || !seccion.estandar) return false;
    return (RESERVED_CLAVES[seccion.clave] ?? []).includes(clave);
  }

  // --- Crear ---

  abrirModalCrear(): void {
    this.editando.set(null);
    this.form.reset({
      clave: '',
      etiqueta: '',
      tipoCampo: 'Texto',
      tipoCatalogoRef: null,
      requerido: false,
      orden: 0,
    });
    this.tipoCampoActual.set('Texto');
    this.configJson.set(null);
    this.configValido.set(true);
    this.modalAbierto.set(true);
  }

  cerrarModal(): void {
    this.modalAbierto.set(false);
    this.editando.set(null);
  }

  guardar(): void {
    const editando = this.editando();
    if (editando) {
      this.guardarEdicion(editando);
      return;
    }

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const valores = this.form.getRawValue();
    if (valores.tipoCampo === 'ReferenciaMaestro' && !valores.tipoCatalogoRef) {
      this.message.error('Elegí el catálogo de referencia.');
      return;
    }
    if (!this.configValido()) {
      this.message.error('Revisá la configuración del campo.');
      return;
    }
    const seccionId = this.seccionSeleccionadaId();
    if (!seccionId) return;

    const input: CrearCampoInput = {
      seccionId,
      clave: valores.clave,
      etiqueta: valores.etiqueta,
      tipoCampo: valores.tipoCampo,
      tipoCatalogoRef: valores.tipoCampo === 'ReferenciaMaestro' ? valores.tipoCatalogoRef : null,
      requerido: valores.requerido,
      configuracion: this.configJson(),
      orden: valores.orden,
    };

    this.guardando.set(true);
    this.camposService.crear(input).subscribe({
      next: () => {
        this.message.success('Campo creado.');
        this.guardando.set(false);
        this.cerrarModal();
        this.cargarCampos();
      },
      error: (err) => {
        this.message.error(err?.error ?? 'No se pudo guardar.');
        this.guardando.set(false);
      },
    });
  }

  // --- Editar ---

  abrirModalEditar(campo: CampoDto): void {
    this.editando.set(campo);
    this.formEdit.reset({
      etiqueta: campo.etiqueta,
      requerido: campo.requerido,
      orden: campo.orden,
    });
    if (this.esReservado(campo.clave)) {
      this.formEdit.controls.requerido.setValue(true);
      this.formEdit.controls.requerido.disable();
    } else {
      this.formEdit.controls.requerido.enable();
    }
    this.configJson.set(campo.configuracion);
    this.configValido.set(true);
    this.modalAbierto.set(true);
  }

  private guardarEdicion(campo: CampoDto): void {
    if (this.formEdit.invalid) {
      this.formEdit.markAllAsTouched();
      return;
    }
    if (!this.configValido()) {
      this.message.error('Revisá la configuración del campo.');
      return;
    }
    const valores = this.formEdit.getRawValue();
    const input: ActualizarCampoInput = {
      etiqueta: valores.etiqueta,
      requerido: valores.requerido,
      configuracion: this.configJson(),
      orden: valores.orden,
    };

    this.guardando.set(true);
    this.camposService.actualizar(campo.id, input).subscribe({
      next: () => {
        this.message.success('Campo actualizado.');
        this.guardando.set(false);
        this.cerrarModal();
        this.cargarCampos();
      },
      error: (err) => {
        this.message.error(err?.error ?? 'No se pudo guardar.');
        this.guardando.set(false);
      },
    });
  }

  // --- Nueva versión ---

  abrirModalVersion(campo: CampoDto): void {
    this.versionando.set(campo);
    this.formVersion.reset({
      etiqueta: campo.etiqueta,
      requerido: campo.requerido,
      orden: campo.orden,
    });
    if (this.esReservado(campo.clave)) {
      this.formVersion.controls.requerido.setValue(true);
      this.formVersion.controls.requerido.disable();
    } else {
      this.formVersion.controls.requerido.enable();
    }
    this.configJson.set(campo.configuracion);
    this.configValido.set(true);
    this.modalVersionAbierto.set(true);
  }

  cerrarModalVersion(): void {
    this.modalVersionAbierto.set(false);
    this.versionando.set(null);
  }

  confirmarVersion(): void {
    const campo = this.versionando();
    if (!campo) return;
    if (this.formVersion.invalid) {
      this.formVersion.markAllAsTouched();
      return;
    }
    if (!this.configValido()) {
      this.message.error('Revisá la configuración del campo.');
      return;
    }
    const valores = this.formVersion.getRawValue();
    const input: NuevaVersionCampoInput = {
      etiqueta: valores.etiqueta,
      tipoCampo: campo.tipoCampo,
      tipoCatalogoRef: campo.tipoCatalogoRef,
      requerido: valores.requerido,
      configuracion: this.configJson(),
      orden: valores.orden,
    };

    this.guardando.set(true);
    this.camposService.nuevaVersion(campo.id, input).subscribe({
      next: () => {
        this.message.success('Nueva versión creada.');
        this.guardando.set(false);
        this.cerrarModalVersion();
        this.cargarCampos();
      },
      error: (err) => {
        this.message.error(err?.error ?? 'No se pudo versionar.');
        this.guardando.set(false);
      },
    });
  }

  eliminar(campo: CampoDto): void {
    this.camposService.eliminar(campo.id).subscribe({
      next: () => {
        this.message.success('Campo eliminado.');
        this.cargarCampos();
      },
      error: (err) => this.message.error(err?.error ?? 'No se pudo eliminar.'),
    });
  }
}
