import { Injectable, inject, signal } from '@angular/core';
import { MaestrosService } from './maestros.service';

/**
 * Estado compartido del contador de provisionales pendientes (M5b).
 *
 * El badge de la nav (`app-shell`) lo pollea en intervalo; la cola de
 * provisionales (`provisionales-page`) empuja el conteo cada vez que carga
 * o resuelve una fila, así el badge decrementa sin esperar al próximo tick.
 * Un poll fallido nunca rompe la nav — se conserva el último valor conocido.
 */
@Injectable({ providedIn: 'root' })
export class ProvisionalesStore {
  private readonly service = inject(MaestrosService);

  readonly cantidad = signal(0);

  /** Re-lee el conteo desde central. Defensivo: un error deja el valor actual. */
  refrescar(): void {
    this.service.listarProvisionales().subscribe({
      next: (rows) => this.cantidad.set(rows.length),
      error: () => {
        /* poll best-effort — no romper la nav */
      },
    });
  }

  /** La cola ya tiene la lista fresca: evitá un GET extra y fijá el conteo. */
  fijar(cantidad: number): void {
    this.cantidad.set(cantidad);
  }
}
