import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { environment } from '../../environments/environment';
import { Modo } from '../../environments/environment.model';

/** Home de cada modo — destino del redirect cuando la ruta no aplica. */
const HOME_POR_MODO: Record<Modo, string> = {
  bascula: '/pesaje',
  admin: '/tipos-movimiento',
};

/**
 * Bloquea una ruta cuyo `data.modo` no coincide con el modo del build activo
 * (`environment.modo`). Modo báscula = bundle de Electron con pesaje offline;
 * modo admin = servido en la web, sólo central. Al no coincidir, redirige al
 * home del modo activo. Una ruta sin `data.modo` queda disponible en ambos.
 *
 * Determinístico (flag de build), a diferencia del `aprovisionamientoGuard`
 * que consulta el servidor local en runtime.
 */
export const modoGuard: CanActivateFn = (route): boolean | UrlTree => {
  const router = inject(Router);
  const requerido = route.data['modo'] as Modo | undefined;

  if (!requerido || requerido === environment.modo) {
    return true;
  }
  return router.parseUrl(HOME_POR_MODO[environment.modo]);
};
