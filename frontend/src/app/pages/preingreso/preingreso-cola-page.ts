import { CommonModule } from '@angular/common';
import { Component, OnDestroy, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTableModule } from 'ng-zorro-antd/table';
import { Maestro, MaestrosService } from '../../api/maestros.service';
import { PreIngreso, PreingresosService } from '../../api/preingresos.service';

const MINUTO_MS = 60_000;
const MINUTOS_POR_HORA = 60;
const MINUTOS_POR_DIA = 24 * MINUTOS_POR_HORA;

export function formatearAntiguedad(fechaCreacion: string, ahora = new Date()): string {
  const fechaUtc = /(?:Z|[+-]\d{2}:\d{2})$/i.test(fechaCreacion)
    ? fechaCreacion
    : `${fechaCreacion}Z`;
  const creacionMs = new Date(fechaUtc).getTime();
  if (Number.isNaN(creacionMs)) return '—';

  const minutosTotales = Math.floor(Math.max(0, ahora.getTime() - creacionMs) / MINUTO_MS);
  const dias = Math.floor(minutosTotales / MINUTOS_POR_DIA);
  const horas = Math.floor((minutosTotales % MINUTOS_POR_DIA) / MINUTOS_POR_HORA);
  const minutos = minutosTotales % MINUTOS_POR_HORA;

  if (dias > 0) return `${dias}d ${horas}h`;
  if (horas > 0) return `${horas}h ${minutos}m`;
  return `${minutos}m`;
}

/** Vista de solo lectura de la cola Pendiente para despacho. */
@Component({
  imports: [CommonModule, FormsModule, NzCardModule, NzSelectModule, NzTableModule],
  selector: 'app-preingreso-cola-page',
  styleUrl: './preingreso-page.css',
  templateUrl: './preingreso-cola-page.html',
})
export class PreingresoColaPage implements OnDestroy {
  private readonly service = inject(PreingresosService);
  private readonly maestrosService = inject(MaestrosService);
  private readonly message = inject(NzMessageService);

  readonly preingresos = signal<PreIngreso[]>([]);
  readonly centros = signal<Maestro[]>([]);
  readonly centroId = signal<string | null>(null);
  readonly cargando = signal(false);
  readonly ahora = signal(new Date());
  private readonly relojId: ReturnType<typeof setInterval>;

  constructor() {
    this.relojId = setInterval(() => this.ahora.set(new Date()), MINUTO_MS);
    this.cargar();
    this.maestrosService
      .listar({ tipoCatalogo: 'Centro' })
      .subscribe((centros) => this.centros.set(centros));
  }

  ngOnDestroy(): void {
    clearInterval(this.relojId);
  }

  antiguedad(fechaCreacion: string): string {
    return formatearAntiguedad(fechaCreacion, this.ahora());
  }

  filtrarPorCentro(centroId: string | null): void {
    this.centroId.set(centroId);
    this.cargar();
  }

  nombreCentro(centroId: string): string {
    return this.centros().find((centro) => centro.id === centroId)?.nombre ?? '—';
  }

  private cargar(): void {
    this.cargando.set(true);
    this.service.listar({ centroId: this.centroId() ?? undefined, estado: 'Pendiente' }).subscribe({
      next: (preingresos) => {
        this.preingresos.set(preingresos.filter((p) => p.estado === 'Pendiente'));
        this.cargando.set(false);
      },
      error: () => {
        this.message.error('No se pudo cargar la cola pendiente.');
        this.cargando.set(false);
      },
    });
  }
}
