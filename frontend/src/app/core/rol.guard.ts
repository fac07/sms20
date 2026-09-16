import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { environment } from '../../environments/environment';
import { Modo } from '../../environments/environment.model';
import { Rol, SesionService } from './sesion.service';

/** Home de cada modo — mismo destino que ya usa `modoGuard` para su propio mismatch. */
const HOME_POR_MODO: Record<Modo, string> = {
  bascula: '/pesaje',
  admin: '/tipos-movimiento',
};

/** Rango numérico del rol — mismo orden que `Politicas.CumpleRolMinimo` (backend, `Politicas.cs`). */
const RANGO: Record<Rol, number> = {
  Operador: 0,
  Supervisor: 1,
  Administrador: 2,
};

/**
 * Bloquea una ruta cuyo `data.rolMinimo` no está cubierto por el rol de la
 * sesión activa (design D5). Compone en AND con `modoGuard` por posición en
 * el array `canActivate: [modoGuard, rolGuard]` — Angular exige que TODOS
 * los guards del array aprueben para activar la ruta, así que el AND es
 * estructural del framework, no algo que este guard implemente.
 *
 * Una ruta sin `data.rolMinimo` queda disponible para cualquier sesión
 * (incluida ninguna) — el mismo criterio de "sin dato, no aplica" que usa
 * `modoGuard` con `data.modo`.
 *
 * Dos denegaciones distintas, dos destinos distintos:
 * - Sin sesión (o con un rol no reconocido) → falla cerrado, redirige a
 *   `/login`. Igual criterio que `Politicas.CumpleRolMinimo` en el backend:
 *   sin claim de rol válido, deniega.
 * - Con sesión pero rol insuficiente → redirige al home del modo activo
 *   (`HOME_POR_MODO`, el mismo mapa y destino que `modoGuard` usa para su
 *   propio mismatch). Se reutiliza ese patrón en lugar de crear una pantalla
 *   nueva de "sin permiso": el usuario ya está autenticado y en un modo
 *   válido, así que devolverlo a su home evita un callejón sin salida y no
 *   agrega una ruta ni un componente sólo para este caso.
 */
export const rolGuard: CanActivateFn = (route): boolean | UrlTree => {
  const router = inject(Router);
  const sesion = inject(SesionService);
  const minimo = route.data['rolMinimo'] as Rol | undefined;

  if (!minimo) {
    return true;
  }

  const rol = sesion.rol();
  if (!rol) {
    return router.parseUrl('/login');
  }

  if (RANGO[rol] >= RANGO[minimo]) {
    return true;
  }

  return router.parseUrl(HOME_POR_MODO[environment.modo]);
};
