import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTableModule } from 'ng-zorro-antd/table';
import { ReporteDiarioFila, ReportesService } from '../../../api/reportes.service';
import { TipoMovimiento, TiposMovimientoService } from '../../../api/tipos-movimiento.service';

@Component({
  imports: [
    CommonModule,
    ReactiveFormsModule,
    NzButtonModule,
    NzCardModule,
    NzSelectModule,
    NzTableModule,
  ],
  selector: 'app-informe-diario-page',
  styleUrl: './informe-diario-page.css',
  templateUrl: './informe-diario-page.html',
})
export class InformeDiarioPage {
  private readonly reportes = inject(ReportesService);
  private readonly tiposService = inject(TiposMovimientoService);
  private readonly message = inject(NzMessageService);

  readonly tiposMovimiento = signal<TipoMovimiento[]>([]);
  readonly filas = signal<ReporteDiarioFila[]>([]);
  readonly cargando = signal(false);
  readonly tipoMovimientoId = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required],
  });
  readonly desde = new FormControl('', { nonNullable: true, validators: [Validators.required] });
  readonly hasta = new FormControl('', { nonNullable: true, validators: [Validators.required] });

  readonly total = computed(() =>
    this.filas().reduce(
      (total, fila) => ({
        cantidadBoletas: total.cantidadBoletas + fila.cantidadBoletas,
        pesoNetoTotal: total.pesoNetoTotal + fila.pesoNetoTotal,
      }),
      { cantidadBoletas: 0, pesoNetoTotal: 0 },
    ),
  );

  constructor() {
    this.tiposService.listar().subscribe({
      next: (tipos) => this.tiposMovimiento.set(tipos),
      error: () => this.message.error('No se pudieron cargar los tipos de movimiento.'),
    });
  }

  consultar(): void {
    const controles = [this.tipoMovimientoId, this.desde, this.hasta];
    controles.forEach((control) => control.markAsTouched());
    if (controles.some((control) => control.invalid)) return;

    if (this.desde.value > this.hasta.value) {
      this.message.error('La fecha desde no puede ser posterior a la fecha hasta.');
      return;
    }

    this.cargando.set(true);
    this.reportes.diario(this.tipoMovimientoId.value, this.desde.value, this.hasta.value).subscribe({
      next: (filas) => {
        this.filas.set(filas);
        this.cargando.set(false);
      },
      error: () => {
        this.message.error('No se pudo cargar el informe diario.');
        this.cargando.set(false);
      },
    });
  }
}
