import { Component, OnDestroy, computed, inject, signal, viewChild } from '@angular/core';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzTableModule } from 'ng-zorro-antd/table';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';
import { IncidenciaSync, Maestro, MaestrosService } from '../../../api/maestros.service';
import { ProvisionalesStore } from '../../../api/provisionales-store';
import { AprobarDialog } from '../dialogs/aprobar-dialog';
import { FusionarDialog } from '../dialogs/fusionar-dialog';
import { PistaSimilar, basculaDeCodigoProvisional, buscarSimilar } from './similares';

// El panel admin re-lee las incidencias de sync en su propio intervalo lento.
const POLL_INCIDENCIAS_MS = 45_000;

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
    NzAlertModule,
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
export class ProvisionalesPage implements OnDestroy {
  private readonly service = inject(MaestrosService);
  private readonly message = inject(NzMessageService);
  private readonly store = inject(ProvisionalesStore);

  private readonly aprobarDlg = viewChild.required(AprobarDialog);
  private readonly fusionarDlg = viewChild.required(FusionarDialog);

  readonly provisionales = signal<Maestro[]>([]);
  readonly universo = signal<Maestro[]>([]);
  readonly cargando = signal(false);

  // Provisionales que llevan >= 5 intentos fallidos de sync por una causa que
  // no es conectividad — la señal para que el admin intervenga.
  readonly incidencias = signal<IncidenciaSync[]>([]);

  private incidenciasIntervalId: ReturnType<typeof setInterval> | null = null;

  readonly filas = computed<FilaProvisional[]>(() =>
    this.provisionales().map((maestro) => ({
      maestro,
      bascula: basculaDeCodigoProvisional(maestro.codigo),
      similar: buscarSimilar(maestro, this.universo()),
    })),
  );

  constructor() {
    this.cargar();
    this.cargarIncidencias();
    this.incidenciasIntervalId = setInterval(
      () => this.cargarIncidencias(),
      POLL_INCIDENCIAS_MS,
    );
  }

  ngOnDestroy(): void {
    if (this.incidenciasIntervalId !== null) clearInterval(this.incidenciasIntervalId);
  }

  cargar(): void {
    this.cargando.set(true);
    this.service.listarProvisionales().subscribe({
      next: (rows) => {
        this.provisionales.set(rows);
        // El badge de la nav decrementa junto con la cola, sin esperar su poll.
        this.store.fijar(rows.length);
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

  /** Poll best-effort: un fallo limpia la alerta en vez de dejar una rancia. */
  cargarIncidencias(): void {
    this.service.incidenciasSync().subscribe({
      next: (rows) => this.incidencias.set(rows),
      error: () => this.incidencias.set([]),
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
