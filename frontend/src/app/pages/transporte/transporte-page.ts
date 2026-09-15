import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzPopconfirmModule } from 'ng-zorro-antd/popconfirm';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzTabsModule } from 'ng-zorro-antd/tabs';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { Maestro, MaestrosService } from '../../api/maestros.service';
import {
  AsignacionUnidadTransportista,
  CrearVinculoInput,
  ReasignarUnidadInput,
  TransporteService,
  VinculoPilotoTransportista,
} from '../../api/transporte.service';

// No hay autenticación real todavía — mismo placeholder que preingreso-page.
const USUARIO_PLACEHOLDER = 'admin@naturaceites.com';

/**
 * Admin de transporte (design D8): dos pestañas sobre `TransporteService`.
 *
 * - "Vínculos": alta, listado (activos e inactivos) y
 *   desactivación/reactivación de vínculos piloto-transportista — soft,
 *   nunca delete (`piloto-transportista-vinculo`, PR3 backend). Forma
 *   calcada de `preingreso-page`: selects vía
 *   `MaestrosService.listarOficialesActivos` + tabla + acciones.
 * - "Asignación de unidades": selector de `Unidad` + su historial de
 *   reasignaciones (más reciente primero) + formulario de reasignación
 *   (`unidad-transportista-historial`, PR7 backend, G6). Ninguna fila del
 *   historial se edita ni se borra — sólo se cierra la abierta y se inserta
 *   una nueva (design D4).
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
    NzPopconfirmModule,
    NzSelectModule,
    NzTableModule,
    NzTabsModule,
    NzTagModule,
  ],
  selector: 'app-transporte-page',
  styleUrl: './transporte-page.css',
  templateUrl: './transporte-page.html',
})
export class TransportePage {
  private readonly service = inject(TransporteService);
  private readonly maestrosService = inject(MaestrosService);
  private readonly message = inject(NzMessageService);
  private readonly fb = inject(FormBuilder);

  readonly vinculos = signal<VinculoPilotoTransportista[]>([]);
  readonly pilotos = signal<Maestro[]>([]);
  readonly transportistas = signal<Maestro[]>([]);
  readonly cargando = signal(false);
  readonly guardando = signal(false);

  readonly form = this.fb.nonNullable.group({
    pilotoId: ['', Validators.required],
    transportistaId: ['', Validators.required],
  });

  readonly unidades = signal<Maestro[]>([]);
  readonly unidadSeleccionadaId = signal<string | null>(null);
  readonly historial = signal<AsignacionUnidadTransportista[]>([]);
  readonly cargandoHistorial = signal(false);
  readonly reasignando = signal(false);

  readonly seleccionUnidadForm = this.fb.nonNullable.group({
    unidadId: [''],
  });

  readonly reasignarForm = this.fb.nonNullable.group({
    transportistaId: ['', Validators.required],
    motivoCambio: [''],
  });

  constructor() {
    this.cargar();
    this.maestrosService
      .listarOficialesActivos('Piloto')
      .subscribe((pilotos) => this.pilotos.set(pilotos));
    this.maestrosService
      .listarOficialesActivos('Transportista')
      .subscribe((transportistas) => this.transportistas.set(transportistas));
    this.maestrosService
      .listarOficialesActivos('Unidad')
      .subscribe((unidades) => this.unidades.set(unidades));

    this.seleccionUnidadForm.controls.unidadId.valueChanges.subscribe((unidadId) => {
      if (unidadId) this.seleccionarUnidad(unidadId);
    });
  }

  /** Nombre a mostrar de un piloto por id — fallback al id crudo si aún no cargó la lista. */
  nombrePiloto(id: string): string {
    return this.pilotos().find((m) => m.id === id)?.nombre ?? id;
  }

  nombreTransportista(id: string): string {
    return this.transportistas().find((m) => m.id === id)?.nombre ?? id;
  }

  nombreUnidad(id: string): string {
    return this.unidades().find((m) => m.id === id)?.nombre ?? id;
  }

  seleccionarUnidad(unidadId: string): void {
    this.unidadSeleccionadaId.set(unidadId);
    this.reasignarForm.reset({ transportistaId: '', motivoCambio: '' });
    this.cargarHistorial(unidadId);
  }

  private cargarHistorial(unidadId: string): void {
    this.cargandoHistorial.set(true);
    this.service.historialUnidad(unidadId).subscribe({
      next: (historial) => {
        this.historial.set(historial);
        this.cargandoHistorial.set(false);
      },
      error: () => {
        this.message.error('No se pudo cargar el historial de asignaciones.');
        this.cargandoHistorial.set(false);
      },
    });
  }

  reasignar(): void {
    const unidadId = this.unidadSeleccionadaId();
    if (!unidadId || this.reasignarForm.invalid) {
      this.reasignarForm.markAllAsTouched();
      return;
    }

    const v = this.reasignarForm.getRawValue();
    const input: ReasignarUnidadInput = {
      transportistaId: v.transportistaId,
      usuarioAsigna: USUARIO_PLACEHOLDER,
      motivoCambio: v.motivoCambio || undefined,
    };

    this.reasignando.set(true);
    this.service.reasignar(unidadId, input).subscribe({
      next: () => {
        this.message.success('Unidad reasignada.');
        this.reasignando.set(false);
        this.reasignarForm.reset({ transportistaId: '', motivoCambio: '' });
        this.cargarHistorial(unidadId);
      },
      error: (err) => {
        this.message.error(err?.error ?? 'No se pudo reasignar la unidad.');
        this.reasignando.set(false);
      },
    });
  }

  private cargar(): void {
    this.cargando.set(true);
    this.service.listarTodos().subscribe({
      next: (vinculos) => {
        this.vinculos.set(vinculos);
        this.cargando.set(false);
      },
      error: () => {
        this.message.error('No se pudo cargar los vínculos piloto-transportista.');
        this.cargando.set(false);
      },
    });
  }

  crear(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const v = this.form.getRawValue();
    const input: CrearVinculoInput = {
      pilotoId: v.pilotoId,
      transportistaId: v.transportistaId,
      usuarioCreacion: USUARIO_PLACEHOLDER,
    };

    this.guardando.set(true);
    this.service.crear(input).subscribe({
      next: () => {
        this.message.success('Vínculo creado.');
        this.guardando.set(false);
        this.form.reset({ pilotoId: '', transportistaId: '' });
        this.cargar();
      },
      error: (err) => {
        this.message.error(err?.error ?? 'No se pudo crear el vínculo.');
        this.guardando.set(false);
      },
    });
  }

  desactivar(vinculo: VinculoPilotoTransportista): void {
    this.service.desactivar(vinculo.id).subscribe({
      next: () => {
        this.message.success('Vínculo desactivado.');
        this.cargar();
      },
      error: (err) => this.message.error(err?.error ?? 'No se pudo desactivar el vínculo.'),
    });
  }

  reactivar(vinculo: VinculoPilotoTransportista): void {
    this.service.reactivar(vinculo.id).subscribe({
      next: () => {
        this.message.success('Vínculo reactivado.');
        this.cargar();
      },
      error: (err) => this.message.error(err?.error ?? 'No se pudo reactivar el vínculo.'),
    });
  }
}
