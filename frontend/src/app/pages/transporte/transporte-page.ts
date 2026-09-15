import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzPopconfirmModule } from 'ng-zorro-antd/popconfirm';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { Maestro, MaestrosService } from '../../api/maestros.service';
import {
  CrearVinculoInput,
  TransporteService,
  VinculoPilotoTransportista,
} from '../../api/transporte.service';

// No hay autenticación real todavía — mismo placeholder que preingreso-page.
const USUARIO_PLACEHOLDER = 'admin@naturaceites.com';

/**
 * Admin de vínculos piloto-transportista (`piloto-transportista-vinculo`,
 * design D8/D1): alta, listado (activos e inactivos) y
 * desactivación/reactivación — soft, nunca delete (PR3 backend). Forma
 * calcada de `preingreso-page`: selects vía
 * `MaestrosService.listarOficialesActivos` + tabla + acciones.
 *
 * La segunda pestaña "Asignación de unidades" (D8) queda fuera de este
 * componente — depende de `AsignacionUnidadTransportista` (PR7, todavía no
 * construida) y se agrega en PR8. Esta página sólo cubre Vínculos.
 */
@Component({
  imports: [
    CommonModule,
    ReactiveFormsModule,
    NzButtonModule,
    NzCardModule,
    NzFormModule,
    NzIconModule,
    NzPopconfirmModule,
    NzSelectModule,
    NzTableModule,
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

  constructor() {
    this.cargar();
    this.maestrosService
      .listarOficialesActivos('Piloto')
      .subscribe((pilotos) => this.pilotos.set(pilotos));
    this.maestrosService
      .listarOficialesActivos('Transportista')
      .subscribe((transportistas) => this.transportistas.set(transportistas));
  }

  /** Nombre a mostrar de un piloto por id — fallback al id crudo si aún no cargó la lista. */
  nombrePiloto(id: string): string {
    return this.pilotos().find((m) => m.id === id)?.nombre ?? id;
  }

  nombreTransportista(id: string): string {
    return this.transportistas().find((m) => m.id === id)?.nombre ?? id;
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
