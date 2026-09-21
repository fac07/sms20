import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzTableModule } from 'ng-zorro-antd/table';
import { BoletaDto, BoletasService } from '../../api/boletas.service';
import { SemaforoTiempo } from '../boletas/semaforo/semaforo-tiempo';
import { UnidadEnTransito, nombrePiloto, placaUnidad, proyectarUnidades } from './proyeccion-unidades';

// Refresco automático de los tiempos cada 60 s (manual del sistema). No hace
// falta re-pedirla: la lista solo muestra `EnTransito` y su duración se
// recalcula contra `ahora`.
const TICK_MS = 60_000;

/**
 * "Unidades en Tránsito" — monitor de las boletas EnTransito con el semáforo
 * de tiempo transcurrido del manual (verde ≤ 16 h, amarillo ≤ 24 h,
 * rojo > 24 h), ordenado por mayor tiempo primero.
 */
@Component({
  selector: 'app-unidades-en-transito-page',
  imports: [CommonModule, NzButtonModule, NzCardModule, NzTableModule, SemaforoTiempo],
  templateUrl: './unidades-en-transito-page.html',
  styleUrl: './unidades-en-transito-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UnidadesEnTransitoPage {
  private readonly service = inject(BoletasService);
  private readonly message = inject(NzMessageService);

  readonly boletas = signal<BoletaDto[]>([]);
  readonly cargando = signal(false);
  readonly error = signal(false);
  readonly ahora = signal(new Date());

  /** Proyección ordenada (mayor tiempo transcurrido primero) de la lista cruda. */
  readonly unidades = computed<UnidadEnTransito[]>(() =>
    proyectarUnidades(this.boletas(), this.ahora()),
  );

  readonly vacio = computed(
    () => !this.cargando() && !this.error() && this.unidades().length === 0,
  );

  // Expuestas para la plantilla — helpers puros de `proyeccion-unidades`.
  readonly placaUnidad = placaUnidad;
  readonly nombrePiloto = nombrePiloto;

  constructor() {
    this.cargar();
    // El reloj solo pisa `ahora`: con eso el computed `unidades` (y cada chip
    // del semáforo) se recalcula. `DestroyRef` apaga el timer con el componente.
    const relojId = setInterval(() => this.ahora.set(new Date()), TICK_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(relojId));
  }

  refrescar(): void {
    this.ahora.set(new Date());
    this.cargar();
  }

  private cargar(): void {
    this.cargando.set(true);
    this.error.set(false);
    this.service.listar('EnTransito').subscribe({
      next: (boletas) => {
        this.boletas.set(boletas);
        this.cargando.set(false);
      },
      error: () => {
        this.boletas.set([]);
        this.error.set(true);
        this.cargando.set(false);
        this.message.error('No se pudo cargar las unidades en tránsito.');
      },
    });
  }
}
