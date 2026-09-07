import { Routes } from '@angular/router';
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
      { path: 'pesaje', component: PesajePage },
      { path: 'basculas', component: BasculasPage },
      { path: 'tipos-movimiento', component: TiposMovimientoPage },
      { path: 'secciones', component: SeccionesPage },
      { path: 'campos', component: CamposPage },
      { path: 'maestros/provisionales', component: ProvisionalesPage },
      { path: 'maestros', component: MaestrosPage },
      { path: 'boletas', component: BoletasPage },
      { path: '', pathMatch: 'full', redirectTo: 'tipos-movimiento' },
      { path: '**', redirectTo: 'tipos-movimiento' },
    ],
  },
];
