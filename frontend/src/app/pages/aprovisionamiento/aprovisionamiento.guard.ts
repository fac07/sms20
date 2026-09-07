import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { Observable, catchError, map, of } from 'rxjs';
import { LocalServerService } from '../../api/local-server.service';

/**
 * Compuerta de primer arranque. Consulta `GET /estado` del servidor local y:
 *  - báscula NO aprovisionada y el destino no es `/aprovisionamiento` → redirige
 *    a `/aprovisionamiento`;
 *  - báscula YA aprovisionada y el destino ES `/aprovisionamiento` → redirige a
 *    `/pesaje` (la pantalla de aprovisionamiento no tiene sentido después).
 *
 * Defensiva: si `GET /estado` falla (servidor local aún levantando, error
 * transitorio) deja pasar la navegación en vez de dejar la app trabada; solo
 * loguea. Se aplica a la ruta del `AppShell` (cubre todos sus hijos) y a la
 * ruta suelta de aprovisionamiento.
 */
export const aprovisionamientoGuard: CanActivateFn = (
  route,
): Observable<boolean | UrlTree> => {
  const localServer = inject(LocalServerService);
  const router = inject(Router);
  const esRutaAprovisionamiento = route.routeConfig?.path === 'aprovisionamiento';

  return localServer.obtenerEstado().pipe(
    map((estado) => {
      if (!estado.aprovisionada && !esRutaAprovisionamiento) {
        return router.parseUrl('/aprovisionamiento');
      }
      if (estado.aprovisionada && esRutaAprovisionamiento) {
        return router.parseUrl('/pesaje');
      }
      return true;
    }),
    catchError((err: unknown) => {
      console.warn(
        'No se pudo verificar el estado de aprovisionamiento; se permite la navegación.',
        err,
      );
      return of(true);
    }),
  );
};
