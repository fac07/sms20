export {};

declare global {
  interface Window {
    /**
     * Inyectado por `electron/preload.ts` vía `contextBridge`, sólo cuando el
     * renderer corre dentro de Electron (modo báscula). Ausente en la web.
     */
    sms?: {
      localServerUrl: string;
    };
  }
}
