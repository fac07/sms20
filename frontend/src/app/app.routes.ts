import { Routes } from '@angular/router';
import { AppShell } from './layout/app-shell/app-shell';
import { BasculasPage } from './pages/basculas/basculas-page/basculas-page';
import { MaestrosPage } from './pages/maestros/maestros-page/maestros-page';
import { TiposMovimientoPage } from './pages/tipos-movimiento/tipos-movimiento-page/tipos-movimiento-page';

export const routes: Routes = [
  {
    path: '',
    component: AppShell,
    children: [
      { path: 'basculas', component: BasculasPage },
      { path: 'tipos-movimiento', component: TiposMovimientoPage },
      { path: 'maestros', component: MaestrosPage },
      { path: '', pathMatch: 'full', redirectTo: 'tipos-movimiento' },
      { path: '**', redirectTo: 'tipos-movimiento' },
    ],
  },
];
