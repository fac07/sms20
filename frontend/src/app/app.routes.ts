import { Routes } from '@angular/router';
import { environment } from '../environments/environment';
import { modoGuard } from './core/modo.guard';
import { AppShell } from './layout/app-shell/app-shell';
import { AprovisionamientoPage } from './pages/aprovisionamiento/aprovisionamiento-page';
import { aprovisionamientoGuard } from './pages/aprovisionamiento/aprovisionamiento.guard';
import { BasculasPage } from './pages/basculas/basculas-page/basculas-page';
import { BoletasPage } from './pages/boletas/boletas-page/boletas-page';
import { CamposPage } from './pages/campos/campos-page/campos-page';
import { MaestrosPage } from './pages/maestros/maestros-page/maestros-page';
import { ProvisionalesPage } from './pages/maestros/provisionales-page/provisionales-page';
import { PesajePage } from './pages/pesaje/pesaje-page/pesaje-page';
import { SeccionesPage } from './pages/secciones/secciones-page/secciones-page';
import { TiposMovimientoPage } from './pages/tipos-movimiento/tipos-movimiento-page/tipos-movimiento-page';

// Landing según el modo del build: pesaje en báscula, configuración en admin.
const rutaInicio = (): string => (environment.modo === 'bascula' ? 'pesaje' : 'tipos-movimiento');

export const routes: Routes = [
  // Ruta suelta, fuera del shell — compuerta de primer arranque.
  {
    path: 'aprovisionamiento',
    component: AprovisionamientoPage,
    canActivate: [aprovisionamientoGuard],
  },
  {
    path: '',
    component: AppShell,
    canActivate: [aprovisionamientoGuard],
    children: [
      // `data.modo` + `modoGuard`: pesaje sólo existe en el bundle de báscula;
      // las pantallas de configuración/consulta, sólo en admin (web).
      {
        path: 'pesaje',
        component: PesajePage,
        canActivate: [modoGuard],
        data: { modo: 'bascula' },
      },
      {
        path: 'basculas',
        component: BasculasPage,
        canActivate: [modoGuard],
        data: { modo: 'admin' },
      },
      {
        path: 'tipos-movimiento',
        component: TiposMovimientoPage,
        canActivate: [modoGuard],
        data: { modo: 'admin' },
      },
      {
        path: 'secciones',
        component: SeccionesPage,
        canActivate: [modoGuard],
        data: { modo: 'admin' },
      },
      {
        path: 'campos',
        component: CamposPage,
        canActivate: [modoGuard],
        data: { modo: 'admin' },
      },
      {
        path: 'maestros/provisionales',
        component: ProvisionalesPage,
        canActivate: [modoGuard],
        data: { modo: 'admin' },
      },
      {
        path: 'maestros',
        component: MaestrosPage,
        canActivate: [modoGuard],
        data: { modo: 'admin' },
      },
      {
        path: 'boletas',
        component: BoletasPage,
        canActivate: [modoGuard],
        data: { modo: ['bascula', 'admin'] },
      },
      { path: '', pathMatch: 'full', redirectTo: rutaInicio },
      { path: '**', redirectTo: rutaInicio },
    ],
  },
];
