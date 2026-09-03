import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzDescriptionsModule } from 'ng-zorro-antd/descriptions';
import { NzGridModule } from 'ng-zorro-antd/grid';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalModule } from 'ng-zorro-antd/modal';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzStatisticModule } from 'ng-zorro-antd/statistic';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';
import { BoletaDto, BoletasService, EstadoBoleta } from '../../../api/boletas.service';
import { ValorCampoLeidoDto } from '../../../api/configuracion.models';
import { agruparValores } from './valores-agrupados';

@Component({
  imports: [
    CommonModule,
    FormsModule,
    NzButtonModule,
    NzCardModule,
    NzDescriptionsModule,
    NzGridModule,
    NzIconModule,
    NzModalModule,
    NzSelectModule,
    NzStatisticModule,
    NzTableModule,
    NzTagModule,
    NzTooltipModule,
  ],
  selector: 'app-boletas-page',
  styleUrl: './boletas-page.css',
  templateUrl: './boletas-page.html',
})
export class BoletasPage {
  private readonly service = inject(BoletasService);
  private readonly message = inject(NzMessageService);

  readonly boletas = signal<BoletaDto[]>([]);
  readonly cargando = signal(false);
  readonly filtroEstado = signal<EstadoBoleta | null>(null);
  readonly detalle = signal<BoletaDto | null>(null);

  // Valores del detalle plegados en secciones -> ocurrencias. El backend ya
  // entrega `valores` ordenado por Seccion.Orden, Campo.Orden, Ocurrencia; el
  // helper solo agrupa y marca las secciones repetibles para las sub-filas.
  readonly seccionesValores = computed(() => agruparValores(this.detalle()?.valores ?? []));

  readonly stats = computed(() => {
    const lista = this.boletas();
    return {
      total: lista.length,
      enTransito: lista.filter((b) => b.estado === 'EnTransito').length,
      cerradas: lista.filter((b) => b.estado === 'Cerrada').length,
      anuladas: lista.filter((b) => b.estado === 'Anulada').length,
    };
  });

  constructor() {
    this.cargar();
  }

  private cargar(): void {
    this.cargando.set(true);
    this.service.listar(this.filtroEstado() ?? undefined).subscribe({
      next: (boletas) => {
        this.boletas.set(boletas);
        this.cargando.set(false);
      },
      error: () => {
        this.message.error('No se pudo cargar el listado — ¿el backend central está arriba?');
        this.cargando.set(false);
      },
    });
  }

  cambiarFiltro(estado: EstadoBoleta | null): void {
    this.filtroEstado.set(estado);
    this.cargar();
  }

  verDetalle(boleta: BoletaDto): void {
    this.detalle.set(boleta);
  }

  cerrarDetalle(): void {
    this.detalle.set(null);
  }

  // Vista de solo lectura de un valor de campo configurable. El orden refleja
  // la prioridad del backend: nombre de maestro resuelto primero, después los
  // slots tipados. Booleano se muestra como Sí/No y la fecha localizada.
  valorLegible(v: ValorCampoLeidoDto): string {
    if (v.valorMaestroNombre != null && v.valorMaestroNombre !== '') return v.valorMaestroNombre;
    if (v.valorTexto != null && v.valorTexto !== '') return v.valorTexto;
    if (v.valorNumero != null) return String(v.valorNumero);
    if (v.valorFecha != null && v.valorFecha !== '') {
      const fecha = new Date(v.valorFecha);
      return Number.isNaN(fecha.getTime()) ? v.valorFecha : fecha.toLocaleDateString();
    }
    if (v.valorBooleano != null) return v.valorBooleano ? 'Sí' : 'No';
    return '—';
  }
}
