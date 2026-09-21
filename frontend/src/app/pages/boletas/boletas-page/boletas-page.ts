import { CommonModule } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal, viewChild } from '@angular/core';
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
import {
  TipoMovimientoSeccionDto,
  TiposMovimientoService,
} from '../../../api/tipos-movimiento.service';
import { SesionService } from '../../../core/sesion.service';
import { BoletaPrint } from '../boleta-print/boleta-print';
import { DescargaService } from '../../../core/descarga.service';
import { EditarMarchamosDialog } from '../editar-marchamos-dialog/editar-marchamos-dialog';
import { SemaforoTiempo } from '../semaforo/semaforo-tiempo';
import { calcularTiempoTranscurridoMs, parsearFechaBoleta } from '../semaforo/tiempo-transcurrido';
import { agruparValores, valorLegible } from './valores-agrupados';
import { construirNombreArchivoBoletas, generarCsvBoletas } from './exportar-csv';

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

const SECCION_MARCHAMOS = 'marchamos';

/**
 * Espejo del gate central de edición de marchamos: el backend solo deja
 * editar si el tipo de movimiento tiene asignada la sección estándar
 * `marchamos` vigente a la fecha de INGRESO de la boleta
 * (`vigenteDesde <= ingreso` y `vigenteHasta` nula o posterior al ingreso).
 * `secciones` sin cargar (`undefined`) o ingreso ilegible → false: el botón se
 * mantiene oculto hasta tener certeza, nunca muestra un error al usuario.
 */
export function tieneMarchamosVigente(
  secciones: readonly TipoMovimientoSeccionDto[] | undefined,
  fechaHoraIngreso: string,
): boolean {
  if (!secciones) return false;
  const ingreso = parsearFechaBoleta(fechaHoraIngreso);
  if (ingreso === null) return false;

  return secciones.some((s) => {
    if (s.seccionClave !== SECCION_MARCHAMOS) return false;
    const desde = parsearFechaBoleta(s.vigenteDesde);
    if (desde === null || ingreso < desde) return false;
    const hasta = parsearFechaBoleta(s.vigenteHasta);
    return hasta === null || ingreso < hasta;
  });
}

@Component({
  imports: [
    CommonModule,
    BoletaPrint,
    EditarMarchamosDialog,
    FormsModule,
    SemaforoTiempo,
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
  private readonly descarga = inject(DescargaService);
  private readonly sesion = inject(SesionService);
  private readonly tipos = inject(TiposMovimientoService);
  private readonly dialogoMarchamos = viewChild(EditarMarchamosDialog);

  // Cache por tipo de movimiento de sus secciones asignadas (con históricas),
  // consultada al abrir el detalle de una Cerrada: un tipo se pide UNA vez.
  // En curso o fallida = el tipo no está acá → el botón queda oculto.
  private readonly seccionesPorTipo = signal<
    Readonly<Record<string, readonly TipoMovimientoSeccionDto[]>>
  >({});
  private readonly consultaEnCurso = new Set<string>();

  // Cadencia del reloj que avanza los semáforos de EnTransito: mismo tick de
  // 60 s que "Unidades en Tránsito" (manual: tiempos en vivo, nunca por segundo).
  private static readonly TICK_SEMAFORO_MS = 60_000;

  readonly boletas = signal<BoletaDto[]>([]);
  readonly cargando = signal(false);
  readonly filtroEstado = signal<EstadoBoleta | null>(null);
  readonly filtroOrigenPeso = signal<OrigenPeso | null>(null);
  readonly detalle = signal<BoletaDto | null>(null);
  readonly ahora = signal(new Date());

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
    // Reloj del semáforo: avanza `ahora` cada minuto para que las boletas en
    // tránsito se re-pinten solas. `DestroyRef` lo apaga con el componente.
    const relojId = setInterval(
      () => this.ahora.set(new Date()),
      BoletasPage.TICK_SEMAFORO_MS,
    );
    inject(DestroyRef).onDestroy(() => clearInterval(relojId));
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
    // Solo las Cerradas pueden mostrar "Editar marchamos"; al abrirlas se
    // asegura (una vez por tipo) tener sus secciones para resolver el gate.
    if (boleta.estado === 'Cerrada') {
      this.cargarSeccionesTipo(boleta.tipoMovimientoId);
    }
  }

  /** Trae las secciones del tipo — con históricas — cacheando por `tipoMovimientoId`. */
  private cargarSeccionesTipo(tipoId: string): void {
    if (tipoId in this.seccionesPorTipo() || this.consultaEnCurso.has(tipoId)) {
      return;
    }
    this.consultaEnCurso.add(tipoId);
    this.tipos.listarSecciones(tipoId, true).subscribe({
      next: (secciones) => {
        this.consultaEnCurso.delete(tipoId);
        this.seccionesPorTipo.update((prev) => ({ ...prev, [tipoId]: secciones }));
      },
      // Error de red: el botón queda oculto y NO rompemos ni toast al usuario
      // (es una consulta de enriquecimiento, no la carga principal del detalle).
      error: () => this.consultaEnCurso.delete(tipoId),
    });
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

  /** El semáforo de tiempo transcurrido solo aplica a EnTransito y Cerrada. */
  muestraSemaforo(boleta: BoletaDto): boolean {
    return boleta.estado === 'EnTransito' || boleta.estado === 'Cerrada';
  }

  /** Milisegundos de la boleta al reloj de la página (salida si existe, si no `ahora`). */
  duracionMs(boleta: BoletaDto): number {
    return calcularTiempoTranscurridoMs(
      boleta.fechaHoraIngreso,
      boleta.fechaHoraSalida,
      this.ahora(),
    );
  }

  /**
   * "Editar marchamos" = boleta Cerrada + rol Supervisor/Administrador + tipo
   * con la sección `marchamos` vigente al ingreso (mismo gate que exige el
   * backend; legacy solo mostraba el botón en ese caso). Con la consulta en
   * curso o fallida el tipo no está en la cache → oculto.
   */
  canEditarMarchamos(boleta: BoletaDto): boolean {
    if (boleta.estado !== 'Cerrada') return false;
    const rol = this.sesion.rol();
    if (rol !== 'Supervisor' && rol !== 'Administrador') return false;
    return tieneMarchamosVigente(this.seccionesPorTipo()[boleta.tipoMovimientoId], boleta.fechaHoraIngreso);
  }

  editarMarchamos(boleta: BoletaDto): void {
    this.dialogoMarchamos()?.abrir({ id: boleta.id, numeroBoleta: boleta.numeroBoleta });
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

  /**
   * Descarga el listado ACTUALMENTE filtrado (los filtros de estado/origen ya
   * están aplicados en la señal `boletas()` porque re-piden al backend). Vacío
   * = avisa y no baja nada.
   */
  exportar(): void {
    const boletas = this.boletas();
    if (boletas.length === 0) {
      this.message.error('No hay boletas para exportar.');
      return;
    }
    this.descarga.csv(construirNombreArchivoBoletas(), generarCsvBoletas(boletas));
  }

  // Vista de solo lectura de un valor de campo configurable — la lógica vive
  // en `valorLegible` puro (valores-agrupados.ts), compartida con boleta-print.
  valorLegible(v: ValorCampoLeidoDto): string {
    return valorLegible(v);
  }
}
