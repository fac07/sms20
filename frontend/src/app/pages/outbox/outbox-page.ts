import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTableModule } from 'ng-zorro-antd/table';
import { BehaviorSubject, catchError, defer, finalize, of, switchMap } from 'rxjs';
import {
  EstadoOutboxLocal,
  LocalServerService,
  OutboxLocalEvento,
} from '../../api/local-server.service';

@Component({
  imports: [CommonModule, FormsModule, NzCardModule, NzSelectModule, NzTableModule],
  selector: 'app-outbox-page',
  styleUrl: './outbox-page.css',
  templateUrl: './outbox-page.html',
})
export class OutboxPage {
  private readonly localServer = inject(LocalServerService);
  private readonly message = inject(NzMessageService);

  readonly estados: EstadoOutboxLocal[] = ['Pendiente', 'Enviado', 'Error'];
  readonly eventos = signal<OutboxLocalEvento[]>([]);
  readonly estado = signal<EstadoOutboxLocal | null>(null);
  readonly expandidoId = signal<string | null>(null);
  readonly cargando = signal(false);
  readonly errorCarga = signal(false);
  private readonly estadoSolicitud = new BehaviorSubject<EstadoOutboxLocal | undefined>(undefined);

  constructor() {
    this.estadoSolicitud
      .pipe(
        switchMap((estado) =>
          defer(() => {
            this.eventos.set([]);
            this.errorCarga.set(false);
            this.cargando.set(true);

            return this.localServer.listarOutbox(estado).pipe(
              catchError(() => {
                this.errorCarga.set(true);
                this.message.error('No se pudo cargar el visor de tramas.');
                return of([] as OutboxLocalEvento[]);
              }),
              finalize(() => this.cargando.set(false)),
            );
          }),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((eventos) => this.eventos.set(eventos));
  }

  filtrarPorEstado(estado: EstadoOutboxLocal | null): void {
    this.estado.set(estado);
    this.expandidoId.set(null);
    this.estadoSolicitud.next(estado ?? undefined);
  }

  alternarDetalle(id: string): void {
    this.expandidoId.update((actual) => (actual === id ? null : id));
  }

  formatearPayload(payload: string): string {
    try {
      return JSON.stringify(JSON.parse(payload), null, 2);
    } catch {
      return payload;
    }
  }
}
