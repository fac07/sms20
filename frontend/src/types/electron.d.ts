export {}

declare global {
  interface Window {
    /** Expuesto por electron/preload.ts vía contextBridge. */
    sms: {
      localServerUrl: string
    }
  }
}
