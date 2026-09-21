import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import * as QRCode from 'qrcode';
import { BoletaDto } from '../../../api/boletas.service';
import { construirPayloadQr } from '../qr-transferencia/payload-qr';
import { QR_CLAVE_PROVIDER, codificarQrTransferencia } from '../qr-transferencia/qr-transferencia';
import { agruparValores, valorLegible } from '../boletas-page/valores-agrupados';

/**
 * Layout imprimible de una Boleta — el "papel" que el legacy pasaba por el
 * preview de Informes/frmBoletas. Presentacional puro: recibe el dto (central
 * o del espejo local — mismo shape) y pliega los valores EAV con el MISMO
 * helper del detalle de BoletasPage (`agruparValores`/`valorLegible`).
 *
 * El CSS de impresión (`@media print`) vive acá con encapsulación None a
 * propósito: necesita tocar `body` (clase `boleta-print-open`, agregada
 * mientras este componente está montado) para aislar la boleta del resto de
 * la app al imprimir. Sin `nz-icon` en todo el árbol, para que el layout
 * sobreviva al print limpio y los specs puedan hacer detectChanges.
 *
 */
@Component({
  selector: 'app-boleta-print',
  imports: [CommonModule],
  templateUrl: './boleta-print.html',
  styleUrl: './boleta-print.css',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoletaPrint implements OnDestroy {
  readonly boleta = input.required<BoletaDto>();
  readonly cerrar = output<void>();

  readonly secciones = computed(() => agruparValores(this.boleta().valores));
  readonly qrDataUrl = signal<string | null>(null);

  protected readonly valorLegible = valorLegible;
  private readonly claveQr = inject(QR_CLAVE_PROVIDER);
  private solicitudQr = 0;

  constructor() {
    document.body.classList.add('boleta-print-open');
    effect(() => {
      const boleta = this.boleta();
      const solicitud = ++this.solicitudQr;
      this.qrDataUrl.set(null);
      if (!boleta.generaQR) return;

      void this.generarQr(boleta, solicitud);
    });
  }

  imprimir(): void {
    // window.print() nativo — verificado: Electron lo expone en el renderer
    // (BrowserWindow estándar, sin handler will-print que lo intercepte), así
    // que abre el diálogo de impresión del SO sin ningún IPC extra.
    globalThis.print?.();
  }

  /**
   * Codifica (async) y renderiza el QR de transferencia. El guard `solicitud`
   * se re-chequea tras cada await: una boleta que cambió mientras tanto no
   * debe pintar el QR de la anterior. Nivel de corrección L: el payload es denso.
   */
  private async generarQr(boleta: BoletaDto, solicitud: number): Promise<void> {
    try {
      const codificado = await codificarQrTransferencia(construirPayloadQr(boleta), this.claveQr());
      if (!codificado.ok || solicitud !== this.solicitudQr) return;
      const dataUrl = await QRCode.toDataURL(codificado.texto, {
        errorCorrectionLevel: 'L',
        margin: 2,
        scale: 4,
      });
      if (solicitud === this.solicitudQr) this.qrDataUrl.set(dataUrl);
    } catch {
      // La boleta sigue siendo imprimible si el codec o el renderer de QR fallan.
    }
  }

  ngOnDestroy(): void {
    this.solicitudQr += 1;
    document.body.classList.remove('boleta-print-open');
  }
}
