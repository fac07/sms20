import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Offline-first: la báscula debe seguir pesando sin conexión al central.
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
      },
      manifest: {
        name: 'SMS 2.0 — Báscula',
        short_name: 'SMS 2.0',
        start_url: '/',
        display: 'standalone',
        background_color: '#0F151E',
        theme_color: '#B8711F',
      },
    }),
  ],
})
