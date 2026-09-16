import { Routes } from '@angular/router';
import { environment } from '../environments/environment';
import { modoGuard } from './core/modo.guard';
import { rolGuard } from './core/rol.guard';
import { AppShell } from './layout/app-shell/app-shell';
import { AprovisionamientoPage } from './pages/aprovisionamiento/aprovisionamiento-page';
import { aprovisionamientoGuard } from './pages/aprovisionamiento/aprovisionamiento.guard';
import { BasculasPage } from './pages/basculas/basculas-page/basculas-page';
import { BoletasPage } from './pages/boletas/boletas-page/boletas-page';
import { CamposPage } from './pages/campos/campos-page/campos-page';
import { LoginPage } from './pages/login/login-page';
import { MaestrosPage } from './pages/maestros/maestros-page/maestros-page';
import { OutboxPage } from './pages/outbox/outbox-page';
import { ProvisionalesPage } from './pages/maestros/provisionales-page/provisionales-page';
import { PesajePage } from './pages/pesaje/pesaje-page/pesaje-page';
import { PreingresoPage } from './pages/preingreso/preingreso-page';
import { PreingresoColaPage } from './pages/preingreso/preingreso-cola-page';
import { InformeDiarioPage } from './pages/reportes/informe-diario/informe-diario-page';
import { ResumenBasculasPage } from './pages/reportes/resumen-basculas/resumen-basculas-page';
import { SeccionesPage } from './pages/secciones/secciones-page/secciones-page';
import { TiposMovimientoPage } from './pages/tipos-movimiento/tipos-movimiento-page/tipos-movimiento-page';
import { TransportePage } from './pages/transporte/transporte-page';

// Landing según el modo del build: pesaje en báscula, configuración en admin.
const rutaInicio = (): string => (environment.modo === 'bascula' ? 'pesaje' : 'tipos-movimiento');

export const routes: Routes = [
  // Ruta suelta, fuera del shell — compuerta de primer arranque.
  {
    path: 'aprovisionamiento',
    component: AprovisionamientoPage,
    canActivate: [aprovisionamientoGuard],
  },
  // Ruta suelta, fuera del shell y sin guard de rol/modo: es el punto de
  // entrada para conseguir la sesión que esos guards necesitan.
  {
    path: 'login',
    component: LoginPage,
  },
  {
    path: '',
    component: AppShell,
    canActivate: [aprovisionamientoGuard],
    children: [
      // `data.modo` + `modoGuard`: pesaje sólo existe en el bundle de báscula;
      // las pantallas de configuración/consulta, sólo en admin (web).
      // `data.rolMinimo` + `rolGuard` (design D4/D5): el piso de rol se fija
      // según el mismo criterio que el backend (PR4-7, `Politicas.cs`) —
      // exclusiva de modo 'admin' → Administrador (pantallas de
      // configuración/catálogo); exclusiva de modo 'bascula' → Operador
      // (pesaje); modo mixto → Operador, el piso más bajo que la usa
      // (Supervisor/Admin heredan acceso por jerarquía de rango).
      {
        path: 'pesaje',
        component: PesajePage,
        canActivate: [modoGuard, rolGuard],
        data: { modo: 'bascula', rolMinimo: 'Operador' },
      },
      {
        path: 'basculas',
        component: BasculasPage,
        canActivate: [modoGuard, rolGuard],
        data: { modo: 'admin', rolMinimo: 'Administrador' },
      },
      {
        path: 'tipos-movimiento',
        component: TiposMovimientoPage,
        canActivate: [modoGuard, rolGuard],
        data: { modo: 'admin', rolMinimo: 'Administrador' },
      },
      {
        path: 'secciones',
        component: SeccionesPage,
        canActivate: [modoGuard, rolGuard],
        data: { modo: 'admin', rolMinimo: 'Administrador' },
      },
      {
        path: 'campos',
        component: CamposPage,
        canActivate: [modoGuard, rolGuard],
        data: { modo: 'admin', rolMinimo: 'Administrador' },
      },
      {
        path: 'maestros/provisionales',
        component: ProvisionalesPage,
        canActivate: [modoGuard, rolGuard],
        data: { modo: 'admin', rolMinimo: 'Administrador' },
      },
      {
        path: 'maestros',
        component: MaestrosPage,
        canActivate: [modoGuard, rolGuard],
        data: { modo: 'admin', rolMinimo: 'Administrador' },
      },
      {
        path: 'preingreso',
        component: PreingresoPage,
        canActivate: [modoGuard, rolGuard],
        data: { modo: 'admin', rolMinimo: 'Administrador' },
      },
      {
        path: 'preingreso/cola',
        component: PreingresoColaPage,
        canActivate: [modoGuard, rolGuard],
        data: { modo: 'admin', rolMinimo: 'Administrador' },
      },
      {
        path: 'transporte',
        component: TransportePage,
        canActivate: [modoGuard, rolGuard],
        data: { modo: 'admin', rolMinimo: 'Administrador' },
      },
      {
        path: 'boletas',
        component: BoletasPage,
        canActivate: [modoGuard, rolGuard],
        data: { modo: ['bascula', 'admin'], rolMinimo: 'Operador' },
      },
      {
        path: 'reportes',
        component: InformeDiarioPage,
        canActivate: [modoGuard, rolGuard],
        data: { modo: 'admin', rolMinimo: 'Administrador' },
      },
      {
        path: 'reportes/basculas',
        component: ResumenBasculasPage,
        canActivate: [modoGuard, rolGuard],
        data: { modo: 'admin', rolMinimo: 'Administrador' },
      },
      // `outbox` es modo 'bascula' (cola offline de boletas pendientes de
      // sincronizar en el Electron de báscula), NO 'admin' — piso Operador,
      // igual que `pesaje`. Confirmado leyendo su `data.modo` en este mismo
      // archivo antes de asignar, no asumido de la lista de referencia del
      // design (que la agrupaba tentativamente con las pantallas admin).
      {
        path: 'outbox',
        component: OutboxPage,
        canActivate: [modoGuard, rolGuard],
        data: { modo: 'bascula', rolMinimo: 'Operador' },
      },
      { path: '', pathMatch: 'full', redirectTo: rutaInicio },
      { path: '**', redirectTo: rutaInicio },
    ],
  },
];
