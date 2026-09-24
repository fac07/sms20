import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzModalModule } from 'ng-zorro-antd/modal';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { BoletaDto, BoletasService } from '../../../api/boletas.service';
import { CampoAplicable, ValorCampoLeidoDto } from '../../../api/configuracion.models';
import { TiposMovimientoService, TipoMovimiento } from '../../../api/tipos-movimiento.service';
import { mapearValoresTrasiego } from './mapear-trasiego';

interface BoletaOrigenTrasiego {
  id: string;
  numeroBoleta: string;
  valores: ValorCampoLeidoDto[];
}

/**
 * Trasiego (manual: "Convertir los datos de una transacción o boleta a una
 * nueva, por ejemplo, de Transferencia a Salida de Materia Prima y Graneles
 * ... los pesos no son modificables, solo los datos permitidos por
 * Auditoria") — solo aplica a una boleta Anulada de tipo Transferencia
 * (backend POST /{id}/trasegar, gate Administrador). El destino NO puede ser
 * otra Transferencia. Sin campos comunes con el origen, el destino puede
 * pedir MÁS datos de los que trae la copia — quedan marcados como
 * "requeridos sin valor" en la vista previa, aviso no bloqueante: la
 * autoridad real es el 422 que el backend devuelve si falta llenar algo.
 */
@Component({
  selector: 'app-trasegar-boleta-dialog',
  imports: [
    FormsModule,
    NzAlertModule,
    NzButtonModule,
    NzFormModule,
    NzInputModule,
    NzModalModule,
    NzSelectModule,
  ],
  template: `
    <nz-modal
      [nzVisible]="!!boleta()"
      [nzTitle]="'Trasegar boleta · ' + (boleta()?.numeroBoleta ?? '')"
      [nzOkText]="'Trasegar'"
      [nzOkLoading]="enviando()"
      (nzOnOk)="confirmar()"
      (nzOnCancel)="cerrar()"
    >
      <ng-container *nzModalContent>
        <form nz-form nzLayout="vertical">
          <nz-form-item>
            <nz-form-label nzRequired>Convertir a</nz-form-label>
            <nz-form-control>
              <nz-select
                [ngModel]="destinoId()"
                (ngModelChange)="seleccionarDestino($event)"
                name="destino"
                nzPlaceHolder="Elegí el tipo de movimiento destino"
                [nzLoading]="cargandoDestinos()"
              >
                @for (t of destinos(); track t.id) {
                  <nz-option [nzValue]="t.id" [nzLabel]="t.nombre"></nz-option>
                }
              </nz-select>
            </nz-form-control>
          </nz-form-item>

          @if (cargandoCampos()) {
            <nz-alert nzType="info" nzMessage="Cargando el formulario del destino…"></nz-alert>
          }

          @if (preview(); as p) {
            <nz-alert
              nzType="success"
              [nzMessage]="p.valores.length + ' campo(s) se copian solos desde la boleta original.'"
            ></nz-alert>
            @if (p.requeridosSinValor.length > 0) {
              <nz-alert
                nzType="warning"
                nzMessage="El destino pide datos que la original no tiene"
                [nzDescription]="tplFaltantes"
              ></nz-alert>
              <ng-template #tplFaltantes>
                <ul>
                  @for (c of p.requeridosSinValor; track c.campoId) {
                    <li>{{ c.etiqueta || c.campoClave }}</li>
                  }
                </ul>
                <p>
                  Se pueden completar más tarde desde Pesaje, o el trasiego se rechaza hasta llenarlos.
                </p>
              </ng-template>
            }
          }

          <nz-form-item>
            <nz-form-label nzRequired>Nuevo número de boleta</nz-form-label>
            <nz-form-control>
              <input
                nz-input
                [ngModel]="numeroBoleta()"
                (ngModelChange)="numeroBoleta.set($event)"
                name="numeroBoleta"
              />
            </nz-form-control>
          </nz-form-item>

          <nz-form-item>
            <nz-form-label nzRequired>Usuario que autoriza</nz-form-label>
            <nz-form-control>
              <input
                nz-input
                [ngModel]="usuarioAutoriza()"
                (ngModelChange)="usuarioAutoriza.set($event)"
                name="usuarioAutoriza"
              />
            </nz-form-control>
          </nz-form-item>

          <nz-form-item>
            <nz-form-label nzRequired>Motivo del trasiego</nz-form-label>
            <nz-form-control>
              <textarea
                nz-input
                rows="2"
                [ngModel]="motivoTrasiego()"
                (ngModelChange)="motivoTrasiego.set($event)"
                name="motivoTrasiego"
              ></textarea>
            </nz-form-control>
          </nz-form-item>
        </form>

        @if (error(); as mensaje) {
          <nz-alert nzType="error" [nzMessage]="mensaje" />
        }
      </ng-container>
    </nz-modal>
  `,
})
export class TrasegarBoletaDialog {
  private readonly service = inject(BoletasService);
  private readonly tipos = inject(TiposMovimientoService);

  readonly trasegado = output<BoletaDto>();

  readonly boleta = signal<BoletaOrigenTrasiego | null>(null);
  readonly destinos = signal<TipoMovimiento[]>([]);
  readonly cargandoDestinos = signal(false);
  readonly destinoId = signal<string | null>(null);
  readonly destinoCampos = signal<CampoAplicable[] | null>(null);
  readonly cargandoCampos = signal(false);
  readonly numeroBoleta = signal('');
  readonly usuarioAutoriza = signal('');
  readonly motivoTrasiego = signal('');
  readonly enviando = signal(false);
  readonly error = signal<string | null>(null);

  readonly preview = computed(() => {
    const campos = this.destinoCampos();
    if (campos === null) return null;
    return mapearValoresTrasiego(this.boleta()?.valores ?? [], campos);
  });

  abrir(boleta: BoletaOrigenTrasiego): void {
    this.boleta.set(boleta);
    this.destinoId.set(null);
    this.destinoCampos.set(null);
    this.numeroBoleta.set('');
    this.usuarioAutoriza.set('');
    this.motivoTrasiego.set('');
    this.error.set(null);
    this.cargandoDestinos.set(true);
    this.tipos.listar(false).subscribe({
      next: (tipos) => {
        this.cargandoDestinos.set(false);
        this.destinos.set(tipos.filter((t) => t.direccion !== 'Transferencia'));
      },
      error: () => {
        this.cargandoDestinos.set(false);
        this.error.set('No se pudieron cargar los tipos de movimiento destino.');
      },
    });
  }

  seleccionarDestino(id: string): void {
    this.destinoId.set(id);
    this.destinoCampos.set(null);
    this.cargandoCampos.set(true);
    this.tipos.formulario(id).subscribe({
      next: (campos) => {
        this.cargandoCampos.set(false);
        this.destinoCampos.set(campos);
      },
      error: () => {
        this.cargandoCampos.set(false);
        this.error.set('No se pudo cargar el formulario del tipo destino.');
      },
    });
  }

  confirmar(): void {
    const boleta = this.boleta();
    const destinoId = this.destinoId();
    const numeroBoleta = this.numeroBoleta().trim();
    const usuarioAutoriza = this.usuarioAutoriza().trim();
    const motivoTrasiego = this.motivoTrasiego().trim();

    if (!boleta || !destinoId) {
      this.error.set('Elegí el tipo de movimiento destino.');
      return;
    }
    if (!numeroBoleta) {
      this.error.set('El número de la nueva boleta es obligatorio.');
      return;
    }
    if (!usuarioAutoriza) {
      this.error.set('El usuario que autoriza es obligatorio.');
      return;
    }
    if (!motivoTrasiego) {
      this.error.set('El motivo del trasiego es obligatorio.');
      return;
    }

    this.error.set(null);
    this.enviando.set(true);
    this.service
      .trasegar(boleta.id, {
        tipoMovimientoDestinoId: destinoId,
        numeroBoleta,
        usuarioAutoriza,
        motivoTrasiego,
        valores: this.preview()?.valores ?? [],
      })
      .subscribe({
        next: (dto) => {
          this.enviando.set(false);
          this.trasegado.emit(dto);
          this.cerrar();
        },
        error: (e: HttpErrorResponse) => this.fallo(e),
      });
  }

  cerrar(): void {
    this.boleta.set(null);
  }

  private fallo(error: HttpErrorResponse): void {
    const detalle = typeof error.error === 'string' ? error.error : null;
    this.error.set(detalle || 'No se pudo trasegar la boleta.');
    this.enviando.set(false);
  }
}
