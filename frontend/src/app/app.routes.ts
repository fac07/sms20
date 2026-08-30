import { Routes } from '@angular/router';
import { AppShell } from './layout/app-shell/app-shell';
import { MaestrosPage } from './pages/maestros/maestros-page/maestros-page';
import { TiposMovimientoPage } from './pages/tipos-movimiento/tipos-movimiento-page/tipos-movimiento-page';

export const routes: Routes = [
  {
    path: '',
    component: AppShell,
    children: [
      { path: 'tipos-movimiento', component: TiposMovimientoPage },
      { path: 'maestros', component: MaestrosPage },
      { path: '', pathMatch: 'full', redirectTo: 'tipos-movimiento' },
      { path: '**', redirectTo: 'tipos-movimiento' },
    ],
  },
];
