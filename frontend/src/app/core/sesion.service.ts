import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, map, switchMap, tap } from 'rxjs';
import { environment } from '../../environments/environment';

const CENTRAL_API_URL = environment.apiUrl;
const CLAVE_STORAGE_TOKEN = 'sms20.sesion.token';

export type Rol = 'Operador' | 'Supervisor' | 'Administrador';
export type Alcance = 'global' | 'asignado';

/** Sesión humana completa — forma acordada en el design (D2/D5). */
export interface Sesion {
  usuarioId: string;
  usuario: string;
  rol: Rol;
  centros: string[];
  alcance: Alcance;
}

/** `POST /api/auth/login` (backend `ResultadoLogin`, PR2) — SIN Centros/alcance. */
interface ResultadoLoginDto {
  token: string;
  usuarioId: string;
  nombreUsuario: string;
  rol: Rol;
}

/** `GET /api/auth/yo` (backend `YoResponse`, PR2) — sí trae Centros/alcance. */
interface YoResponseDto {
  usuarioId: string;
  nombreUsuario: string;
  rol: Rol;
  centros: string[];
  alcance: Alcance;
}

/**
 * Estado de sesión humana compartido por toda la app (design D3/D5).
 *
 * El token se persiste en `localStorage`, no en memoria únicamente: es el
 * mecanismo más simple para un mock sin refresh token todavía, sobrevive un
 * reload (F5 en modo admin web, o reabrir la ventana de Electron), y
 * funciona igual en ambos hosts sin depender de que compartan
 * dominio/esquema (a diferencia de una cookie). Nada fuera de este servicio
 * y de `authInterceptor` lee la clave de storage directamente, así que
 * endurecer esto al integrar el proveedor real (p. ej. `sessionStorage` +
 * refresh silencioso) es un cambio local a este archivo.
 *
 * `login()` encadena DOS llamadas a propósito, no por preferencia de
 * estilo: `POST /api/auth/login` devuelve `ResultadoLogin` (token +
 * identidad básica) pero el backend NUNCA incluye `Centros`/`alcance` ahí
 * (confirmado en `backend/Domain/Seguridad/IProveedorIdentidad.cs` /
 * `AuthDtos.cs`) — sólo `GET /api/auth/yo` (`YoResponse`) los expone. Sin
 * el segundo round-trip, un Supervisor con Centros asignados quedaría con
 * `centros: []` en el signal, rompiendo cualquier scoping de UI que PR9
 * construya sobre esto.
 */
@Injectable({ providedIn: 'root' })
export class SesionService {
  private readonly http = inject(HttpClient);

  private readonly _sesion = signal<Sesion | null>(null);

  /** Sesión completa actual, o `null` sin usuario logueado. */
  readonly sesion = this._sesion.asReadonly();

  /** Rol del usuario actual, o `null` sin sesión. */
  readonly rol = computed(() => this._sesion()?.rol ?? null);

  /** Centros asignados al usuario actual (vacío para Administrador/global, o sin sesión). */
  readonly centros = computed(() => this._sesion()?.centros ?? []);

  /** Token actual persistido, o `null` sin sesión. Lo lee `authInterceptor`. */
  token(): string | null {
    return localStorage.getItem(CLAVE_STORAGE_TOKEN);
  }

  login(nombreUsuario: string, clave: string): Observable<Sesion> {
    return this.http
      .post<ResultadoLoginDto>(`${CENTRAL_API_URL}/api/auth/login`, { nombreUsuario, clave })
      .pipe(
        // Persistir el token ANTES del segundo request es obligatorio: el
        // authInterceptor lee `token()` (este mismo storage) para adjuntar
        // el Bearer a la llamada a /yo que sigue.
        tap((resultado) => localStorage.setItem(CLAVE_STORAGE_TOKEN, resultado.token)),
        switchMap(() => this.http.get<YoResponseDto>(`${CENTRAL_API_URL}/api/auth/yo`)),
        map((yo) => {
          const sesion: Sesion = {
            usuarioId: yo.usuarioId,
            usuario: yo.nombreUsuario,
            rol: yo.rol,
            centros: yo.centros,
            alcance: yo.alcance,
          };
          this._sesion.set(sesion);
          return sesion;
        }),
      );
  }

  /**
   * Limpia la sesión local (signal + token persistido). NO llama a
   * `POST /api/auth/logout` — eso es responsabilidad de quien invoque un
   * logout explícito; esto es el mismo borrado que dispara el
   * `authInterceptor` en un 401.
   */
  limpiar(): void {
    localStorage.removeItem(CLAVE_STORAGE_TOKEN);
    this._sesion.set(null);
  }
}
