import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './layout/AppShell'
import { TiposMovimientoPage } from './pages/TiposMovimiento/TiposMovimientoPage'

function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/tipos-movimiento" element={<TiposMovimientoPage />} />
        <Route path="*" element={<Navigate to="/tipos-movimiento" replace />} />
      </Route>
    </Routes>
  )
}

export default App
