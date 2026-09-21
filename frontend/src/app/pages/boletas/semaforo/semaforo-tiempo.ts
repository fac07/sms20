import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzTooltipModule } from 'ng-zorro-antd/tooltip';
import {
  UMBRALES_BOLETA,
  clasificarTiempo,
  formatearDuracion,
  type ColorSemaforo,
  type UmbralesSemaforo,
} from './clasificar-tiempo';

const HORA_MS = 3_600_000;

/** Ícono por estado — la forma distingue el estado sin depender del color. */
const ICONOS: Record<ColorSemaforo, { tipo: string; tema: 'fill' | 'outline' }> = {
  verde: { tipo: 'check-circle', tema: 'fill' },
  amarillo: { tipo: 'exclamation-circle', tema: 'fill' },
  rojo: { tipo: 'close-circle', tema: 'fill' },
};

/**
 * Chip reutilizable del semáforo de tiempo transcurrido (manual: verde ≤ 16 h,
 * amarillo ≤ 24 h, rojo > 24 h). Accesibilidad: nunca color-solo — ícono con
 * forma distinta por estado, texto visible con la duración en `d.hh:mm:ss` y
 * tooltip/`aria-label` que explican el rango. Los colores salen de las
 * variables de tema de ng-zorro (`--ant-*`), así que siguen al modo
 * claro/oscuro del proyecto sin hardcodear hexadecimales.
 */
@Component({
  selector: 'app-semaforo-tiempo',
  imports: [NzIconModule, NzTooltipModule],
  templateUrl: './semaforo-tiempo.html',
  styleUrl: './semaforo-tiempo.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SemaforoTiempo {
  /** Duración en milisegundos — el llamador la computa con `calcularTiempoTranscurridoMs`. */
  readonly duracionMs = input.required<number>();

  /** Umbrales del manual por defecto; parametrizables para reusar el chip. */
  readonly umbrales = input<UmbralesSemaforo>(UMBRALES_BOLETA);

  /** Duración no medible (NaN/negativo): rojo (falla-visible) con 0.00:00:00. */
  readonly estado = computed<ColorSemaforo>(() =>
    clasificarTiempo(this.duracionMs() / HORA_MS, this.umbrales()),
  );

  readonly texto = computed(() => formatearDuracion(this.duracionMs()));

  readonly icono = computed(() => ICONOS[this.estado()]);

  readonly descripcion = computed(() => {
    const u = this.umbrales();
    switch (this.estado()) {
      case 'verde':
        return `verde ≤ ${u.verde} h`;
      case 'amarillo':
        return `amarillo > ${u.verde} h y ≤ ${u.amarillo} h`;
      default:
        return `rojo > ${u.amarillo} h`;
    }
  });

  readonly tooltip = computed(
    () => `Tiempo transcurrido: ${this.texto()} (${this.descripcion()})`,
  );
}
