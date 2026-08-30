import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App as AntApp, ConfigProvider } from 'antd'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App.tsx'
import './index.css'

const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider
      theme={{
        token: {
          // Paleta de NatPlus (nat+), la app web interna de Naturaceites —
          // pedido explícito del usuario, para que esto se sienta parte de
          // la misma familia de productos en vez de una isla con su propio
          // estilo. Estimados a partir de capturas, no valores exactos de
          // marca — ajustar si el equipo de NatPlus comparte los hex reales.
          colorPrimary: '#2E8540',
          colorSuccess: '#2E8540',
          colorError: '#D64541',
          colorInfo: '#0D3B36',
          borderRadius: 6,
        },
      }}
    >
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <HashRouter>
            <App />
          </HashRouter>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
)
