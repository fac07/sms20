import { EnvironmentProviders, Injectable, inject, makeEnvironmentProviders, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { QR_CLAVE_PROVIDER } from '../pages/boletas/qr-transferencia/qr-transferencia';
import { LocalServerService } from './local-server.service';

/**
 * Clave HMAC (Base64) que firma el QR de transferencia. La entrega Central en
 * el aprovisionamiento y la guarda el servidor local de Electron; acá se lee
 * una sola vez al arrancar la app y se expone como signal.
 *
 * Sin clave (modo web/admin, servidor local caído o terminal aprovisionada
 * ANTES de que existiera la distribución — no hay re-fetch ni rotación todavía)
 * queda en null y el QR se imprime sin firma, sin avisar al operador.
 */
@Injectable({ providedIn: 'root' })
export class QrClaveService {
  private readonly local = inject(LocalServerService);
  private readonly _clave = signal<string | null>(null);
  private carga: Promise<void> | null = null;

  readonly clave = this._clave.asReadonly();

  /** Idempotente y nunca rechaza: cualquier fallo deja la clave en null. */
  cargar(): Promise<void> {
    this.carga ??= this.leer();
    return this.carga;
  }

  private async leer(): Promise<void> {
    // Modo web: no hay servidor local detrás (environment.web.ts lo deja en null).
    if (!environment.localServerUrl) return;
    try {
      const { clave } = await firstValueFrom(this.local.obtenerQrClave());
      this._clave.set(clave || null);
    } catch {
      this._clave.set(null);
    }
  }
}

/** Cablea `QR_CLAVE_PROVIDER` (contrato `() => string | null`) al servicio. */
export function provideQrClave(): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: QR_CLAVE_PROVIDER,
      useFactory: () => {
        const servicio = inject(QrClaveService);
        return () => servicio.clave();
      },
    },
  ]);
}
