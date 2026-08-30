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
          // Mismos tokens semánticos del esquema de datos (documento vivo) —
          // una sola paleta de marca en todo lo que el equipo produce.
          colorPrimary: '#B8711F',
          colorSuccess: '#3F8F6E',
          colorError: '#B14A32',
          borderRadius: 8,
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
