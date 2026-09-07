import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzModalModule } from 'ng-zorro-antd/modal';
import { Maestro, MaestrosService } from '../../../api/maestros.service';

/**
 * Diálogo de fusión compartido. El picker de destino ofrece SOLO oficiales
 * activos del mismo TipoCatalogo (`GET /api/maestros?tipoCatalogo=X&estado=Oficial`).
 * Al confirmar hace `POST /fusionar/{oficialId}`; el rewrite retroactivo lo
 * resuelve el backend (M4b). El padre lo abre con `abrir(maestro)`.
 */
@Component({
  selector: 'app-fusionar-dialog',
  imports: [FormsModule, NzAlertModule, NzModalModule, NzSelectModule],
  template: `
    <nz-modal
      [nzVisible]="!!maestro()"
      nzTitle="Fusionar ítem provisional"
      nzOkText="Fusionar"
      nzCancelText="Cancelar"
      [nzOkLoading]="guardando()"
      [nzOkDisabled]="!seleccionado()"
      (nzOnCancel)="cancelar()"
      (nzOnOk)="confirmar()"
    >
      <ng-container *nzModalContent>
        @if (maestro(); as m) {
          <p>
            "<strong>{{ m.nombre }}</strong>" ({{ m.codigo }}) se descarta y queda apuntando al ítem
            oficial que elijas.
          </p>
          @if (cargando()) {
            <p>Cargando oficiales…</p>
          } @else if (oficiales().length === 0) {
            <p>No hay ítems oficiales activos de este tipo para fusionar todavía.</p>
          } @else {
            <nz-select
              style="width: 100%"
              nzPlaceHolder="Elegí el ítem oficial"
              [ngModel]="seleccionado()"
              (ngModelChange)="seleccionado.set($event)"
            >
              @for (o of oficiales(); track o.id) {
                <nz-option [nzValue]="o.id" [nzLabel]="o.codigo + ' — ' + o.nombre"></nz-option>
              }
            </nz-select>
          }
          @if (error(); as err) {
            <nz-alert nzType="error" [nzMessage]="err"></nz-alert>
          }
        }
      </ng-container>
    </nz-modal>
  `,
})
export class FusionarDialog {
  private readonly service = inject(MaestrosService);

  readonly resuelto = output<void>();

  readonly maestro = signal<Maestro | null>(null);
  readonly oficiales = signal<Maestro[]>([]);
  readonly seleccionado = signal<string | null>(null);
  readonly cargando = signal(false);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);

  abrir(maestro: Maestro): void {
    this.maestro.set(maestro);
    this.oficiales.set([]);
    this.seleccionado.set(null);
    this.error.set(null);
    this.guardando.set(false);
    this.cargando.set(true);
    this.service.listarOficialesActivos(maestro.tipoCatalogo).subscribe({
      next: (rows) => {
        this.oficiales.set(rows);
        this.cargando.set(false);
      },
      error: () => {
        this.oficiales.set([]);
        this.cargando.set(false);
      },
    });
  }

  confirmar(): void {
    const maestro = this.maestro();
    const oficialId = this.seleccionado();
    if (!maestro || !oficialId) return;

    this.guardando.set(true);
    this.error.set(null);
    this.service.fusionar(maestro.id, oficialId).subscribe({
      next: () => {
        this.guardando.set(false);
        this.maestro.set(null);
        this.resuelto.emit();
      },
      error: (err: HttpErrorResponse) => {
        this.guardando.set(false);
        this.error.set(
          typeof err.error === 'string' && err.error ? err.error : 'No se pudo fusionar. Reintentá.',
        );
      },
    });
  }

  cancelar(): void {
    this.maestro.set(null);
  }
}
