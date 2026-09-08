import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { NzBadgeModule } from 'ng-zorro-antd/badge';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzLayoutModule } from 'ng-zorro-antd/layout';
import { NzMenuModule } from 'ng-zorro-antd/menu';
import { environment } from '../../../environments/environment';
import { Modo } from '../../../environments/environment.model';
import { ProvisionalesStore } from '../../api/provisionales-store';
import { PesoSimuladoPanel } from '../peso-simulado-panel/peso-simulado-panel';

interface NavItem {
  path: string;
  icon: string;
  label: string;
  disabled?: boolean;
  // Modos donde el ítem aparece. Ausente = ambos. Alineado con `data.modo` de las rutas.
  modos?: Modo[];
}

const NAV_ITEMS: NavItem[] = [
  { path: '/pesaje', icon: 'dashboard', label: 'Pesaje', modos: ['bascula'] },
  { path: '/basculas', icon: 'desktop', label: 'Básculas', modos: ['admin'] },
  { path: '/tipos-movimiento', icon: 'appstore', label: 'Tipos de movimiento', modos: ['admin'] },
  { path: '/secciones', icon: 'apartment', label: 'Secciones', modos: ['admin'] },
  { path: '/campos', icon: 'form', label: 'Campos', modos: ['admin'] },
  { path: '/maestros', icon: 'database', label: 'Maestros', modos: ['admin'] },
  { path: '/maestros/provisionales', icon: 'inbox', label: 'Provisionales', modos: ['admin'] },
  { path: '/boletas', icon: 'file-text', label: 'Boletas', modos: ['admin'] },
  { path: '/reportes', icon: 'bar-chart', label: 'Reportes', disabled: true, modos: ['admin'] },
];

/** Ítems de nav visibles para un modo — filtra por `NavItem.modos`. */
export function navItemsParaModo(modo: Modo): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.modos || item.modos.includes(modo));
}

// Ruta de la cola cuyo badge muestra el conteo de provisionales pendientes.
const RUTA_PROVISIONALES = '/maestros/provisionales';

// Cadencia del poll del badge — alineada con el resto de polls de la app
// (~30-60s). El conteo real se refresca antes vía `ProvisionalesStore.fijar`
// cuando la cola aprueba o fusiona.
const POLL_PROVISIONALES_MS = 45_000;

const PAGE_TITLES: Record<string, string> = {
  '/pesaje': 'Pesaje',
  '/basculas': 'Básculas',
  '/tipos-movimiento': 'Tipos de movimiento',
  '/secciones': 'Secciones',
  '/campos': 'Campos',
  '/maestros': 'Maestros',
  '/maestros/provisionales': 'Cola de provisionales',
  '/boletas': 'Boletas',
};

@Component({
  imports: [
    RouterLink,
    RouterOutlet,
    NzBadgeModule,
    NzLayoutModule,
    NzMenuModule,
    NzIconModule,
    PesoSimuladoPanel,
  ],
  selector: 'app-app-shell',
  styleUrl: './app-shell.css',
  templateUrl: './app-shell.html',
})
export class AppShell implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly provisionalesStore = inject(ProvisionalesStore);

  readonly navItems = navItemsParaModo(environment.modo);
  readonly rutaProvisionales = RUTA_PROVISIONALES;

  /** Conteo de provisionales pendientes para el badge de la nav. */
  readonly provisionalesPendientes = this.provisionalesStore.cantidad;

  private pollId: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.provisionalesStore.refrescar();
    this.pollId = setInterval(
      () => this.provisionalesStore.refrescar(),
      POLL_PROVISIONALES_MS,
    );
  }

  ngOnDestroy(): void {
    if (this.pollId !== null) clearInterval(this.pollId);
  }

  readonly currentPath = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  get pageTitle(): string {
    return PAGE_TITLES[this.currentPath()] ?? '';
  }
}
