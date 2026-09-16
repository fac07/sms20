import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { SesionService } from './sesion.service';

const CENTRAL_API_URL = environment.apiUrl;

/**
 * Adjunta el Bearer del usuario humano SOLO a llamadas al backend CENTRAL
 * (`environment.apiUrl`), y limpia la sesión ante un 401 de ese mismo
 * backend.
 *
 * Confirmado antes de escribir esto: `environment.apiUrl` (`CENTRAL_API_URL`,
 * ej. `http://localhost:5094`) y `environment.localServerUrl` (usado como
 * `LOCAL_SERVER_URL` en `api/local-server.service.ts` y
 * `layout/peso-simulado-panel/peso-simulado-panel.ts`, ej.
 * `http://127.0.0.1:4127`) son hosts/puertos completamente distintos — un
 * `startsWith` sobre la URL saliente alcanza para separarlos sin tocar
 * ninguna de esas dos constantes.
 *
 * El servidor local de Electron (`frontend/electron/`: config-sync.ts,
 * maestros-sync.ts, preingreso-sync.ts, local-server.ts) es un proceso de
 * sync en segundo plano sin usuario humano — NUNCA manda ni espera este
 * header, y su 401 (si lo hubiera) no tiene relación con la sesión humana,
 * así que tampoco dispara la limpieza.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(CENTRAL_API_URL)) {
    return next(req);
  }

  const sesion = inject(SesionService);
  const token = sesion.token();
  const conAuth = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(conAuth).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse && err.status === 401) {
        sesion.limpiar();
      }
      return throwError(() => err);
    }),
  );
};
