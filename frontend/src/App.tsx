import { Navigate, Route, Routes } from 'react-router-dom'
import { TiposMovimientoPage } from './pages/TiposMovimiento/TiposMovimientoPage'

function App() {
  return (
    <Routes>
      <Route path="/tipos-movimiento" element={<TiposMovimientoPage />} />
      <Route path="*" element={<Navigate to="/tipos-movimiento" replace />} />
    </Routes>
  )
}

export default App
