import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzLayoutModule } from 'ng-zorro-antd/layout';
import { NzMenuModule } from 'ng-zorro-antd/menu';

interface NavItem {
  path: string;
  icon: string;
  label: string;
  disabled?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { path: '/basculas', icon: 'desktop', label: 'Básculas' },
  { path: '/tipos-movimiento', icon: 'appstore', label: 'Tipos de movimiento' },
  { path: '/maestros', icon: 'database', label: 'Maestros' },
  { path: '/boletas', icon: 'file-text', label: 'Boletas', disabled: true },
  { path: '/reportes', icon: 'bar-chart', label: 'Reportes', disabled: true },
];

const PAGE_TITLES: Record<string, string> = {
  '/basculas': 'Básculas',
  '/tipos-movimiento': 'Tipos de movimiento',
  '/maestros': 'Maestros',
};

@Component({
  imports: [RouterLink, RouterOutlet, NzLayoutModule, NzMenuModule, NzIconModule],
  selector: 'app-app-shell',
  styleUrl: './app-shell.css',
  templateUrl: './app-shell.html',
})
export class AppShell {
  private readonly router = inject(Router);

  readonly navItems = NAV_ITEMS;

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
