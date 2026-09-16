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
import {
  BoletaDto,
  BoletasService,
  EstadoBoleta,
  OrigenPeso,
  USUARIO_MOSTRADOR,
} from '../../../api/boletas.service';
import { ValorCampoLeidoDto } from '../../../api/configuracion.models';
import { etiquetaMotivoPesoManual } from '../../../api/motivo-peso-manual';
import { BoletaPrint } from '../boleta-print/boleta-print';
import { agruparValores, valorLegible } from './valores-agrupados';

/**
 * `MarcaPreIngreso` central (backend/Domain/Boletas/MarcaPreIngreso.cs) — marca
 * de revisión no bloqueante, nunca cambia estado/pesos/validez de la boleta.
 */
const ETIQUETAS_MARCA_PREINGRESO: Record<string, string> = {
  VinculoRechazado: 'Vínculo rechazado',
  PreIngresoCancelado: 'Pre-ingreso cancelado',
};

/** Etiqueta legible de una `marcaPreIngreso`; cae al valor crudo si no se reconoce. */
export function etiquetaMarcaPreIngreso(marca: string): string {
  return ETIQUETAS_MARCA_PREINGRESO[marca] ?? marca;
}

@Component({
  imports: [
    CommonModule,
    BoletaPrint,
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
  readonly filtroOrigenPeso = signal<OrigenPeso | null>(null);
  readonly detalle = signal<BoletaDto | null>(null);

  // Overlay de impresión: el dto ya actualizado que devuelve /reimprimir
  // (contador + último usuario/fecha incluidos) — sin fetch extra.
  readonly boletaParaImprimir = signal<BoletaDto | null>(null);

  readonly etiquetaMotivo = etiquetaMotivoPesoManual;
  readonly etiquetaMarca = etiquetaMarcaPreIngreso;

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
    this.service
      .listar(this.filtroEstado() ?? undefined, this.filtroOrigenPeso() ?? undefined)
      .subscribe({
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

  cambiarFiltroOrigenPeso(origen: OrigenPeso | null): void {
    this.filtroOrigenPeso.set(origen);
    this.cargar();
  }

  verDetalle(boleta: BoletaDto): void {
    this.detalle.set(boleta);
  }

  /** Gate de la sección "Cola de transporte" del detalle — hay enlace a un pre-ingreso. */
  tieneEnlacePreIngreso(boleta: BoletaDto): boolean {
    return boleta.preIngresoId !== null;
  }

  cerrarDetalle(): void {
    this.detalle.set(null);
  }

  /** El botón "Reimprimir" solo aplica a boletas que ya existieron en papel. */
  canReimprimir(boleta: BoletaDto): boolean {
    return boleta.estado === 'Cerrada' || boleta.estado === 'Reemitida';
  }

  // Registra la reimpresión en central (contador + auditoría) y usa el MISMO
  // dto devuelto para abrir el layout — nada de segundo GET: el POST responde
  // la boleta completa ya actualizada.
  reimprimir(boleta: BoletaDto): void {
    this.service.reimprimir(boleta.id, USUARIO_MOSTRADOR).subscribe({
      next: (actualizada) => {
        this.boletaParaImprimir.set(actualizada);
        setTimeout(() => globalThis.print?.(), 0);
      },
      error: () => this.message.error('No se pudo registrar la reimpresión.'),
    });
  }

  descartarImpresion(): void {
    this.boletaParaImprimir.set(null);
  }

  // Vista de solo lectura de un valor de campo configurable — la lógica vive
  // en `valorLegible` puro (valores-agrupados.ts), compartida con boleta-print.
  valorLegible(v: ValorCampoLeidoDto): string {
    return valorLegible(v);
  }
}
