import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { CampoAplicable, TipoMovimiento } from './configuracion.models';

// Sin .env: no hay secretos acá, y el puerto de dev del backend central es
// estable (launchSettings.json, perfil "http"). En producción esto va a
// venir de la config de la báscula post-aprovisionamiento, no de un build-time env.
const CENTRAL_API_URL = 'http://localhost:5094';

// `TipoMovimiento` y `DireccionMovimiento` se movieron a `configuracion.models.ts`
// (los consume también el dropdown de Pesaje vía el espejo local). Se
// re-exportan acá para no tocar a los importadores (`tipos-movimiento-page.ts`,
// `tipos-movimiento.service.spec.ts`). `isolatedModules` exige `export type`.
export type { DireccionMovimiento, TipoMovimiento } from './configuracion.models';

export type GuardarTipoMovimientoInput = Omit<TipoMovimiento, 'id' | 'activo'>;

/** Una asignación sección→tipo de movimiento, vigente o histórica. */
export interface TipoMovimientoSeccionDto {
  seccionId: string;
  seccionClave: string;
  seccionNombre: string;
  requerida: boolean;
  orden: number;
  vigenteDesde: string;
  vigenteHasta: string | null;
}

// Entrada del set deseado de secciones. El PUT es declarativo: las secciones
// que no aparecen se desasignan (VigenteHasta), nunca borrado físico.
export interface AsignacionSeccionInput {
  seccionId: string;
  requerida: boolean;
  orden: number;
}

@Injectable({ providedIn: 'root' })
export class TiposMovimientoService {
  private readonly http = inject(HttpClient);

  listar(incluirInactivos = false): Observable<TipoMovimiento[]> {
    return this.http.get<TipoMovimiento[]>(
      `${CENTRAL_API_URL}/api/tipos-movimiento?incluirInactivos=${incluirInactivos}`,
    );
  }

  crear(input: GuardarTipoMovimientoInput): Observable<TipoMovimiento> {
    return this.http.post<TipoMovimiento>(`${CENTRAL_API_URL}/api/tipos-movimiento`, input);
  }

  actualizar(id: string, input: GuardarTipoMovimientoInput): Observable<TipoMovimiento> {
    return this.http.put<TipoMovimiento>(`${CENTRAL_API_URL}/api/tipos-movimiento/${id}`, input);
  }

  desactivar(id: string): Observable<void> {
    return this.http.delete<void>(`${CENTRAL_API_URL}/api/tipos-movimiento/${id}`);
  }

  listarSecciones(id: string, incluirHistoricas = false): Observable<TipoMovimientoSeccionDto[]> {
    return this.http.get<TipoMovimientoSeccionDto[]>(
      `${CENTRAL_API_URL}/api/tipos-movimiento/${id}/secciones?incluirHistoricas=${incluirHistoricas}`,
    );
  }

  asignarSecciones(
    id: string,
    secciones: AsignacionSeccionInput[],
  ): Observable<TipoMovimientoSeccionDto[]> {
    return this.http.put<TipoMovimientoSeccionDto[]>(
      `${CENTRAL_API_URL}/api/tipos-movimiento/${id}/secciones`,
      secciones,
    );
  }

  formulario(id: string): Observable<CampoAplicable[]> {
    return this.http.get<CampoAplicable[]>(
      `${CENTRAL_API_URL}/api/tipos-movimiento/${id}/formulario`,
    );
  }
}
