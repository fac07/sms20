import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';
import { Maestro, MaestrosService } from '../../../api/maestros.service';
import { AprobarDialog } from '../dialogs/aprobar-dialog';
import { FusionarDialog } from '../dialogs/fusionar-dialog';
import { PistaSimilar, basculaDeCodigoProvisional, buscarSimilar } from './similares';

interface FilaProvisional {
  maestro: Maestro;
  bascula: string;
  similar: PistaSimilar | null;
}

/**
 * Cola unificada de provisionales para el admin (M5a). Lista TODOS los
 * `Estado=Provisional` de CUALQUIER `TipoCatalogo` en una sola tabla, con
 * acciones Aprobar / Fusionar por fila y una pista de nombre similar
 * (product decision 8). Página online, central — pega directo a `:5094`.
 */
@Component({
  imports: [
    NzButtonModule,
    NzCardModule,
    NzEmptyModule,
    NzIconModule,
    NzTableModule,
    NzTagModule,
    NzTooltipModule,
    AprobarDialog,
    FusionarDialog,
  ],
  selector: 'app-provisionales-page',
  styleUrl: './provisionales-page.css',
  templateUrl: './provisionales-page.html',
})
export class ProvisionalesPage {
  private readonly service = inject(MaestrosService);
  private readonly message = inject(NzMessageService);

  private readonly aprobarDlg = viewChild.required(AprobarDialog);
  private readonly fusionarDlg = viewChild.required(FusionarDialog);

  readonly provisionales = signal<Maestro[]>([]);
  readonly universo = signal<Maestro[]>([]);
  readonly cargando = signal(false);

  readonly filas = computed<FilaProvisional[]>(() =>
    this.provisionales().map((maestro) => ({
      maestro,
      bascula: basculaDeCodigoProvisional(maestro.codigo),
      similar: buscarSimilar(maestro, this.universo()),
    })),
  );

  constructor() {
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.service.listarProvisionales().subscribe({
      next: (rows) => {
        this.provisionales.set(rows);
        this.cargando.set(false);
      },
      error: () => {
        this.message.error('No se pudo cargar la cola — ¿el backend central está arriba?');
        this.cargando.set(false);
      },
    });
    // Universo para la pista de similitud; su fallo no rompe la cola.
    this.service.listarTodos().subscribe({
      next: (rows) => this.universo.set(rows),
      error: () => this.universo.set([]),
    });
  }

  abrirAprobar(maestro: Maestro): void {
    this.aprobarDlg().abrir(maestro);
  }

  abrirFusionar(maestro: Maestro): void {
    this.fusionarDlg().abrir(maestro);
  }

  alAprobar(): void {
    this.message.success('Ítem oficializado — se distribuye a las básculas en el próximo sync.');
    this.cargar();
  }

  alFusionar(): void {
    this.message.success('Ítems fusionados.');
    this.cargar();
  }

  datosAdicionalesResumen(maestro: Maestro): string {
    return maestro.datosAdicionales?.trim() ? maestro.datosAdicionales.trim() : '—';
  }
}
