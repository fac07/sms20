import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzModalModule } from 'ng-zorro-antd/modal';
import { Maestro, MaestrosService } from '../../../api/maestros.service';

/**
 * Diálogo de aprobación compartido por la cola unificada y la página por-pestaña
 * de Maestros. Prefiere el siguiente correlativo sugerido (editable) y el nombre
 * del provisional (editable). Al confirmar hace `POST /aprobar {codigo, nombre}`;
 * un 409 de colisión se muestra inline y el diálogo queda abierto para reintentar.
 *
 * El padre lo abre imperativamente con `abrir(maestro)` (via `viewChild`).
 */
@Component({
  selector: 'app-aprobar-dialog',
  imports: [FormsModule, NzAlertModule, NzFormModule, NzInputModule, NzModalModule],
  template: `
    <nz-modal
      [nzVisible]="!!maestro()"
      nzTitle="Aprobar ítem provisional"
      nzOkText="Aprobar"
      nzCancelText="Cancelar"
      [nzOkLoading]="guardando()"
      [nzOkDisabled]="!codigo().trim() || cargandoSugerencia()"
      (nzOnCancel)="cancelar()"
      (nzOnOk)="confirmar()"
    >
      <ng-container *nzModalContent>
        @if (maestro(); as m) {
          <p>
            "<strong>{{ m.nombre }}</strong>" ({{ m.codigo }}) pasa a Oficial y se distribuye a las
            básculas en el próximo sync.
          </p>
          <form nz-form nzLayout="vertical">
            <nz-form-item>
              <nz-form-label nzRequired>Código oficial</nz-form-label>
              <nz-form-control>
                <input
                  nz-input
                  [ngModel]="codigo()"
                  (ngModelChange)="codigo.set($event)"
                  name="codigo"
                  [placeholder]="cargandoSugerencia() ? 'Sugiriendo…' : 'P-001'"
                />
              </nz-form-control>
            </nz-form-item>
            <nz-form-item>
              <nz-form-label>Nombre</nz-form-label>
              <nz-form-control>
                <input
                  nz-input
                  [ngModel]="nombre()"
                  (ngModelChange)="nombre.set($event)"
                  name="nombre"
                />
              </nz-form-control>
            </nz-form-item>
          </form>
          @if (errorColision(); as err) {
            <nz-alert nzType="error" [nzMessage]="err"></nz-alert>
          }
        }
      </ng-container>
    </nz-modal>
  `,
})
export class AprobarDialog {
  private readonly service = inject(MaestrosService);

  readonly resuelto = output<void>();

  readonly maestro = signal<Maestro | null>(null);
  readonly codigo = signal('');
  readonly nombre = signal('');
  readonly cargandoSugerencia = signal(false);
  readonly guardando = signal(false);
  readonly errorColision = signal<string | null>(null);

  abrir(maestro: Maestro): void {
    this.maestro.set(maestro);
    this.codigo.set('');
    this.nombre.set(maestro.nombre);
    this.errorColision.set(null);
    this.guardando.set(false);
    this.cargandoSugerencia.set(true);
    this.service.siguienteCodigo(maestro.tipoCatalogo).subscribe({
      next: (r) => {
        // Solo prefiere si el admin todavía no tocó el campo.
        if (!this.codigo().trim()) this.codigo.set(r.codigoSugerido);
        this.cargandoSugerencia.set(false);
      },
      error: () => this.cargandoSugerencia.set(false),
    });
  }

  confirmar(): void {
    const maestro = this.maestro();
    const codigo = this.codigo().trim();
    if (!maestro || !codigo) return;

    this.guardando.set(true);
    this.errorColision.set(null);
    const nombre = this.nombre().trim();
    this.service.aprobar(maestro.id, { codigo, nombre: nombre || undefined }).subscribe({
      next: () => {
        this.guardando.set(false);
        this.maestro.set(null);
        this.resuelto.emit();
      },
      error: (err: HttpErrorResponse) => {
        this.guardando.set(false);
        if (err.status === 409) {
          this.errorColision.set(
            typeof err.error === 'string' && err.error
              ? err.error
              : 'Ese código ya lo usa un oficial activo de este tipo. Probá con otro.',
          );
        } else {
          this.errorColision.set('No se pudo aprobar. Reintentá.');
        }
      },
    });
  }

  cancelar(): void {
    this.maestro.set(null);
  }
}
