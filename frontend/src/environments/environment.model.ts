/**
 * Forma del `environment` compartida por los dos builds. `environment.ts` es el
 * default (modo báscula, bundle de Electron con pesaje offline); el build
 * `web` lo reemplaza por `environment.web.ts` (modo admin, servido en la web
 * contra central) vía `fileReplacements` en `angular.json`.
 */
export type Modo = 'bascula' | 'admin';

export interface Environment {
  /** Distingue el bundle de báscula (Electron, offline) del de admin (web). */
  readonly modo: Modo;
  /** Backend central. Mismo host en ambos modos por ahora. */
  readonly apiUrl: string;
  /**
   * Servidor local de Electron. `null` en modo admin: ahí no hay Electron
   * detrás y las pantallas que dependen de él quedan fuera del modo.
   */
  readonly localServerUrl: string | null;
}
