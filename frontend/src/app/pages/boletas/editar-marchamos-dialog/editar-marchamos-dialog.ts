import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzModalModule } from 'ng-zorro-antd/modal';
import { NzSwitchModule } from 'ng-zorro-antd/switch';
import { NzTableModule } from 'ng-zorro-antd/table';
import {
  BoletaMarchamosService,
  MarchamoDto,
  MarchamosBoletaDto,
} from '../../../api/boleta-marchamos.service';

interface BoletaReferencia {
  id: string;
  numeroBoleta: string;
}

@Component({
  selector: 'app-editar-marchamos-dialog',
  imports: [
    FormsModule,
    NzAlertModule,
    NzButtonModule,
    NzFormModule,
    NzInputModule,
    NzModalModule,
    NzSwitchModule,
    NzTableModule,
  ],
  template: `
    <nz-modal
      [nzVisible]="!!boleta()"
      [nzTitle]="'Editar marchamos · ' + (boleta()?.numeroBoleta ?? '')"
      [nzFooter]="null"
      (nzOnCancel)="cerrar()"
    >
      <ng-container *nzModalContent>
        @if (cargando()) {
          <p>Cargando marchamos…</p>
        } @else {
          <nz-table [nzData]="marchamos()" [nzShowPagination]="false" nzSize="small">
            <thead>
              <tr>
                <th>Placa</th>
                <th>Marchamo</th>
                <th>Activo</th>
                <th>Observaciones</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (marchamo of marchamos(); track marchamo.ocurrencia) {
                <tr>
                  <td>{{ marchamo.placa || '—' }}</td>
                  <td>
                    <input
                      nz-input
                      [(ngModel)]="marchamo.numero"
                      [name]="'numero-' + marchamo.ocurrencia"
                    />
                  </td>
                  <td>
                    <nz-switch
                      [(ngModel)]="marchamo.activo"
                      [name]="'activo-' + marchamo.ocurrencia"
                    />
                  </td>
                  <td>
                    <input
                      nz-input
                      [(ngModel)]="marchamo.observaciones"
                      [name]="'observaciones-' + marchamo.ocurrencia"
                    />
                  </td>
                  <td>
                    <button
                      nz-button
                      nzType="link"
                      [nzLoading]="guardando()"
                      (click)="rectificar(marchamo)"
                    >
                      Guardar
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </nz-table>

          <form nz-form nzLayout="vertical" class="nuevo-marchamo">
            <strong>Agregar marchamo</strong>
            <div class="nuevo-marchamo__campos">
              <input nz-input placeholder="Marchamo" [(ngModel)]="nuevoNumero" name="nuevoNumero" />
              <input nz-input placeholder="Placa" [(ngModel)]="nuevaPlaca" name="nuevaPlaca" />
              <input
                nz-input
                placeholder="Observaciones"
                [(ngModel)]="nuevasObservaciones"
                name="nuevasObservaciones"
              />
              <button nz-button nzType="default" [nzLoading]="guardando()" (click)="agregar()">
                Agregar
              </button>
            </div>

            <nz-form-item>
              <nz-form-label nzRequired>Observación del cambio</nz-form-label>
              <nz-form-control>
                <textarea
                  nz-input
                  rows="2"
                  [(ngModel)]="observacionCambio"
                  name="observacionCambio"
                ></textarea>
              </nz-form-control>
            </nz-form-item>
          </form>

          @if (error(); as mensaje) {
            <nz-alert nzType="error" [nzMessage]="mensaje" />
          }
        }
      </ng-container>
    </nz-modal>
  `,
  styles: `
    .nuevo-marchamo {
      margin-top: 20px;
    }
    .nuevo-marchamo__campos {
      display: grid;
      grid-template-columns: 1fr 1fr 1.5fr auto;
      gap: 8px;
      margin: 8px 0 12px;
    }
  `,
})
export class EditarMarchamosDialog {
  private readonly service = inject(BoletaMarchamosService);

  readonly actualizado = output<void>();
  readonly boleta = signal<BoletaReferencia | null>(null);
  readonly marchamos = signal<MarchamoDto[]>([]);
  readonly rowVersion = signal('');
  readonly cargando = signal(false);
  readonly guardando = signal(false);
  readonly error = signal<string | null>(null);
  readonly observacionCambio = signal('');
  readonly nuevoNumero = signal('');
  readonly nuevaPlaca = signal('');
  readonly nuevasObservaciones = signal('');

  abrir(boleta: BoletaReferencia): void {
    this.boleta.set(boleta);
    this.error.set(null);
    this.observacionCambio.set('');
    this.cargando.set(true);
    this.service.listar(boleta.id).subscribe({
      next: (respuesta) => {
        this.aplicar(respuesta);
        this.cargando.set(false);
      },
      error: () => {
        this.error.set('No se pudieron cargar los marchamos.');
        this.cargando.set(false);
      },
    });
  }

  rectificar(marchamo: MarchamoDto): void {
    const boleta = this.boleta();
    if (!boleta || !this.validarObservacion()) return;
    this.guardando.set(true);
    this.service
      .rectificar(boleta.id, marchamo.ocurrencia, {
        numero: marchamo.numero.trim(),
        activo: marchamo.activo,
        observaciones: marchamo.observaciones?.trim() || null,
        observacionCambio: this.observacionCambio().trim(),
        rowVersion: this.rowVersion(),
      })
      .subscribe({ next: (r) => this.exito(r), error: (e) => this.fallo(e) });
  }

  agregar(): void {
    const boleta = this.boleta();
    if (!boleta || !this.nuevoNumero().trim()) {
      this.error.set('El número de marchamo es obligatorio.');
      return;
    }
    if (!this.validarObservacion()) return;
    this.guardando.set(true);
    this.service
      .agregar(boleta.id, {
        numero: this.nuevoNumero().trim(),
        placa: this.nuevaPlaca().trim() || null,
        activo: true,
        observaciones: this.nuevasObservaciones().trim() || null,
        observacionCambio: this.observacionCambio().trim(),
        rowVersion: this.rowVersion(),
      })
      .subscribe({
        next: (respuesta) => {
          this.nuevoNumero.set('');
          this.nuevaPlaca.set('');
          this.nuevasObservaciones.set('');
          this.exito(respuesta);
        },
        error: (e) => this.fallo(e),
      });
  }

  cerrar(): void {
    this.boleta.set(null);
  }

  private validarObservacion(): boolean {
    if (this.observacionCambio().trim()) return true;
    this.error.set('La observación del cambio es obligatoria.');
    return false;
  }

  private aplicar(respuesta: MarchamosBoletaDto): void {
    this.rowVersion.set(respuesta.rowVersion);
    this.marchamos.set(respuesta.marchamos.map((marchamo) => ({ ...marchamo })));
  }

  private exito(respuesta: MarchamosBoletaDto): void {
    this.aplicar(respuesta);
    this.observacionCambio.set('');
    this.error.set(null);
    this.guardando.set(false);
    this.actualizado.emit();
  }

  private fallo(error: HttpErrorResponse): void {
    const detalle = typeof error.error === 'string' ? error.error : null;
    this.error.set(
      detalle ||
        (error.status === 409
          ? 'La boleta cambió o el marchamo está duplicado. Recargá e intentá de nuevo.'
          : 'No se pudo guardar el cambio.'),
    );
    this.guardando.set(false);
  }
}
