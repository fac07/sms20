import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// URL del backend central, centralizada en `src/environments`.
const CENTRAL_API_URL = environment.apiUrl;

// Anterior a cualquier alta posible en el sistema — usarlo como
// `modificadoDesde` trae TODOS los vínculos (activos e inactivos), igual que
// el modo delta del endpoint (VinculoPilotoTransportistaEndpoints.cs, PR3):
// sin `modificadoDesde`, el endpoint sólo devuelve los activos.
const EPOCH = '1970-01-01T00:00:00.000Z';

export interface VinculoPilotoTransportista {
  id: string;
  pilotoId: string;
  transportistaId: string;
  activo: boolean;
  usuarioCreacion: string;
  fechaCreacion: string;
  fechaModificacion: string;
}

export interface CrearVinculoInput {
  pilotoId: string;
  transportistaId: string;
  usuarioCreacion: string;
}

/**
 * CRUD de vínculos piloto-transportista (`piloto-transportista-vinculo`,
 * PR3 backend). Forma calcada de `preingresos.service.ts`.
 */
@Injectable({ providedIn: 'root' })
export class TransporteService {
  private readonly http = inject(HttpClient);

  listar(opts?: {
    transportistaId?: string;
    modificadoDesde?: string;
  }): Observable<VinculoPilotoTransportista[]> {
    const params = new URLSearchParams();
    if (opts?.transportistaId) params.set('transportistaId', opts.transportistaId);
    if (opts?.modificadoDesde) params.set('modificadoDesde', opts.modificadoDesde);
    const query = params.toString();
    return this.http.get<VinculoPilotoTransportista[]>(
      `${CENTRAL_API_URL}/api/vinculos-piloto-transportista${query ? `?${query}` : ''}`,
    );
  }

  /**
   * Admin: activos e inactivos (para poder reactivarlos), vía el modo delta
   * del endpoint desde el origen de los tiempos.
   */
  listarTodos(): Observable<VinculoPilotoTransportista[]> {
    return this.listar({ modificadoDesde: EPOCH });
  }

  crear(input: CrearVinculoInput): Observable<VinculoPilotoTransportista> {
    return this.http.post<VinculoPilotoTransportista>(
      `${CENTRAL_API_URL}/api/vinculos-piloto-transportista`,
      input,
    );
  }

  desactivar(id: string): Observable<VinculoPilotoTransportista> {
    return this.http.post<VinculoPilotoTransportista>(
      `${CENTRAL_API_URL}/api/vinculos-piloto-transportista/${id}/desactivar`,
      {},
    );
  }

  reactivar(id: string): Observable<VinculoPilotoTransportista> {
    return this.http.post<VinculoPilotoTransportista>(
      `${CENTRAL_API_URL}/api/vinculos-piloto-transportista/${id}/reactivar`,
      {},
    );
  }

  /**
   * Historial completo de asignaciones de una unidad, más reciente primero
   * (`unidad-transportista-historial`, PR7 backend). La fila con
   * `vigenteHasta` `null` es la asignación actual (G6); el resto es
   * historial, nunca editable ni borrable.
   */
  historialUnidad(unidadId: string): Observable<AsignacionUnidadTransportista[]> {
    return this.http.get<AsignacionUnidadTransportista[]>(
      `${CENTRAL_API_URL}/api/transporte/unidades/${unidadId}/asignaciones`,
    );
  }

  /**
   * Reasigna el transportista de una unidad: PR7's endpoint cierra la fila
   * abierta (si existe) e inserta la nueva, en un solo `SaveChanges` — no hay
   * PUT/DELETE (design D4: ninguna fila se reescribe ni se borra jamás).
   */
  reasignar(unidadId: string, input: ReasignarUnidadInput): Observable<AsignacionUnidadTransportista> {
    return this.http.post<AsignacionUnidadTransportista>(
      `${CENTRAL_API_URL}/api/transporte/unidades/${unidadId}/asignaciones`,
      input,
    );
  }
}

/**
 * Proyección de lectura de una asignación unidad-transportista
 * (`unidad-transportista-historial`, PR7 backend, design D4). La fila con
 * `vigenteHasta` `null` es la asignación actual de la unidad (G6); el resto
 * es historial, nunca editable ni borrable.
 */
export interface AsignacionUnidadTransportista {
  id: string;
  unidadId: string;
  transportistaId: string;
  vigenteDesde: string;
  vigenteHasta: string | null;
  usuarioAsigna: string;
  motivoCambio: string | null;
}

export interface ReasignarUnidadInput {
  transportistaId: string;
  usuarioAsigna: string;
  motivoCambio?: string;
}
