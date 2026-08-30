import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron/simple'
import renderer from 'vite-plugin-electron-renderer'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // La app corre empaquetada con Electron (instalador único, updates con
    // electron-updater) — el offline-first lo dan el proceso principal
    // (servidor HTTP local + SQLite embebida), no un service worker, así
    // que no hace falta vite-plugin-pwa acá: sumaría una segunda capa de
    // caché de assets que puede quedar desincronizada de lo que
    // electron-updater ya reemplazó en disco.
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            // Vite 8 usa Rolldown por default — el campo es rolldownOptions,
            // no rollupOptions (eso queda para Vite < 8).
            rolldownOptions: {
              // better-sqlite3 es un módulo nativo (usa __dirname/require de
              // CJS para cargar su binario .node) — bundlearlo rompe en
              // runtime ESM. express no tiene motivo para ir bundleado
              // tampoco. Quedan como dependencias reales del proceso
              // principal, resueltas por Node al arrancar.
              external: ['better-sqlite3', 'express'],
            },
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
      },
    }),
    renderer(),
  ],
})
