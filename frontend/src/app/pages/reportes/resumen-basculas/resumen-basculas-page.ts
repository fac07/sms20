import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzTableModule } from 'ng-zorro-antd/table';
import { ResumenBasculaDia, ReportesService } from '../../../api/reportes.service';

const DIAS_DEFAULT = 7;

/** 'YYYY-MM-DD' del calendario LOCAL de `d` — nunca `toISOString`, que en
 *  husos oeste del meridiano corre el día una unidad. */
export function formatearFechaLocal(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Día calendario local `n` días atrás, en la forma 'YYYY-MM-DD' que pide el backend. */
export function fechaHaceDias(n: number, hoy = new Date()): string {
  // Mediodía local del día de hoy +/- n días enteros: evita los bordes de
  // horario de verano donde restar n*24h cambiaría de día.
  const alMediodia = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - n, 12);
  return formatearFechaLocal(alMediodia);
}

export type FilaResumen =
  | {
      tipo: 'dia';
      clave: string;
      basculaNombre: string;
      fecha: string;
      cantidadBoletas: number;
      pesoNetoTotal: number;
    }
  | { tipo: 'subtotal'; clave: string; basculaNombre: string; cantidadBoletas: number; pesoNetoTotal: number };

/**
 * Aplana las filas del backend (ordenadas por báscula/fecha desde el servidor)
 * en filas de tabla con un subtotal al cerrar cada grupo de báscula. Agrupa
 * por `basculaId` contiguo: con el orden garantizado por el endpoint, cada
 * báscula produce exactamente un subtotal.
 */
export function agruparPorBascula(filas: ResumenBasculaDia[]): FilaResumen[] {
  const salida: FilaResumen[] = [];
  let grupo: { id: string; nombre: string; cantidad: number; peso: number } | null = null;

  const cerrarGrupo = (): void => {
    if (grupo !== null) {
      salida.push({
        tipo: 'subtotal',
        clave: grupo.id,
        basculaNombre: grupo.nombre,
        cantidadBoletas: grupo.cantidad,
        pesoNetoTotal: grupo.peso,
      });
      grupo = null;
    }
  };

  for (const f of filas) {
    if (grupo === null || grupo.id !== f.basculaId) {
      cerrarGrupo();
      grupo = { id: f.basculaId, nombre: f.basculaNombre, cantidad: 0, peso: 0 };
    }
    grupo.cantidad += f.cantidadBoletas;
    grupo.peso += f.pesoNetoTotal;
    salida.push({
      tipo: 'dia',
      clave: f.basculaId,
      basculaNombre: f.basculaNombre,
      fecha: f.fecha,
      cantidadBoletas: f.cantidadBoletas,
      pesoNetoTotal: f.pesoNetoTotal,
    });
  }
  cerrarGrupo();
  return salida;
}

export function totalGeneral(filas: ResumenBasculaDia[]): { cantidadBoletas: number; pesoNetoTotal: number } {
  return filas.reduce(
    (acc, f) => ({
      cantidadBoletas: acc.cantidadBoletas + f.cantidadBoletas,
      pesoNetoTotal: acc.pesoNetoTotal + f.pesoNetoTotal,
    }),
    { cantidadBoletas: 0, pesoNetoTotal: 0 },
  );
}

/** Consolidado báscula×día — espejo del resumen diario de básculas del legacy. */
@Component({
  imports: [CommonModule, FormsModule, NzButtonModule, NzCardModule, NzInputModule, NzSpinModule, NzTableModule],
  selector: 'app-resumen-basculas-page',
  styleUrl: './resumen-basculas-page.css',
  templateUrl: './resumen-basculas-page.html',
})
export class ResumenBasculasPage {
  private readonly service = inject(ReportesService);
  private readonly message = inject(NzMessageService);

  private readonly crudas = signal<ResumenBasculaDia[]>([]);

  readonly desde = signal(fechaHaceDias(DIAS_DEFAULT - 1));
  readonly hasta = signal(formatearFechaLocal(new Date()));
  readonly cargando = signal(false);

  readonly filas = computed(() => agruparPorBascula(this.crudas()));
  readonly total = computed(() => totalGeneral(this.crudas()));

  constructor() {
    this.generar();
  }

  generar(): void {
    const desde = this.desde();
    const hasta = this.hasta();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
      this.message.warning('Completá ambas fechas del rango.');
      return;
    }
    if (hasta < desde) {
      this.message.warning('La fecha "hasta" no puede ser anterior a "desde".');
      return;
    }

    this.cargando.set(true);
    this.service.resumenBasculas(desde, hasta).subscribe({
      next: (filas) => {
        this.crudas.set(filas);
        this.cargando.set(false);
      },
      error: () => {
        this.message.error('No se pudo cargar el resumen — ¿el backend central está arriba?');
        this.crudas.set([]);
        this.cargando.set(false);
      },
    });
  }
}
