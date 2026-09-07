import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

const CENTRAL_API_URL = 'http://localhost:5094';

export type TipoCatalogo =
  | 'Piloto'
  | 'Transportista'
  | 'Equipo'
  | 'Producto'
  | 'Tercero'
  | 'Finca'
  | 'Almacen'
  | 'Centro'
  | 'Cama'
  | 'CicloCompostera'
  | 'SeccionCompostera'
  | 'CaracteristicaEquipo';

export const TIPOS_CATALOGO: TipoCatalogo[] = [
  'Piloto',
  'Transportista',
  'Equipo',
  'Producto',
  'Tercero',
  'Finca',
  'Almacen',
  'Centro',
  'Cama',
  'CicloCompostera',
  'SeccionCompostera',
  'CaracteristicaEquipo',
];

export type EstadoMaestro = 'Oficial' | 'Provisional';

export interface Maestro {
  id: string;
  tipoCatalogo: TipoCatalogo;
  codigo: string;
  nombre: string;
  datosAdicionales: string | null;
  estado: EstadoMaestro;
  fusionadoConId: string | null;
  fechaModificacion: string;
  activo: boolean;
}

export interface GuardarMaestroInput {
  tipoCatalogo: TipoCatalogo;
  codigo: string;
  nombre: string;
  datosAdicionales: string | null;
}

export interface AprobarMaestroInput {
  codigo: string;
  nombre?: string;
}

export interface SiguienteCodigoResponse {
  codigoSugerido: string;
}

// Incidencia de sync reportada por una báscula: un provisional que lleva >= 5
// intentos fallidos de sincronizar por una causa que no es conectividad
// (M4b). Store in-memory con TTL 1h en central; `ultimoError` es verbatim.
export interface IncidenciaSync {
  basculaCodigo: string;
  entidadId: string;
  tipoCatalogo: string | null;
  nombre: string | null;
  intentos: number;
  ultimoError: string;
  visto: boolean;
}

@Injectable({ providedIn: 'root' })
export class MaestrosService {
  private readonly http = inject(HttpClient);

  listar(opts?: {
    tipoCatalogo?: TipoCatalogo;
    estado?: EstadoMaestro;
    incluirInactivos?: boolean;
  }): Observable<Maestro[]> {
    const params = new URLSearchParams();
    if (opts?.tipoCatalogo) params.set('tipoCatalogo', opts.tipoCatalogo);
    if (opts?.estado) params.set('estado', opts.estado);
    params.set('incluirInactivos', String(opts?.incluirInactivos ?? false));
    return this.http.get<Maestro[]>(`${CENTRAL_API_URL}/api/maestros?${params.toString()}`);
  }

  /** Cola unificada del admin: todos los provisionales, sin importar el TipoCatalogo. */
  listarProvisionales(): Observable<Maestro[]> {
    return this.listar({ estado: 'Provisional' });
  }

  /** Universo activo (provisionales + oficiales) para la pista de nombre similar. */
  listarTodos(): Observable<Maestro[]> {
    return this.listar({});
  }

  /** Candidatos válidos de fusión: solo oficiales activos del mismo tipo. */
  listarOficialesActivos(tipoCatalogo: TipoCatalogo): Observable<Maestro[]> {
    return this.listar({ tipoCatalogo, estado: 'Oficial' });
  }

  crear(input: GuardarMaestroInput): Observable<Maestro> {
    return this.http.post<Maestro>(`${CENTRAL_API_URL}/api/maestros`, input);
  }

  actualizar(id: string, input: GuardarMaestroInput): Observable<Maestro> {
    return this.http.put<Maestro>(`${CENTRAL_API_URL}/api/maestros/${id}`, input);
  }

  desactivar(id: string): Observable<void> {
    return this.http.delete<void>(`${CENTRAL_API_URL}/api/maestros/${id}`);
  }

  siguienteCodigo(tipoCatalogo: TipoCatalogo): Observable<SiguienteCodigoResponse> {
    return this.http.get<SiguienteCodigoResponse>(
      `${CENTRAL_API_URL}/api/maestros/siguiente-codigo?tipoCatalogo=${tipoCatalogo}`,
    );
  }

  aprobar(id: string, input: AprobarMaestroInput): Observable<Maestro> {
    return this.http.post<Maestro>(`${CENTRAL_API_URL}/api/maestros/${id}/aprobar`, input);
  }

  fusionar(provisionalId: string, oficialId: string): Observable<Maestro> {
    return this.http.post<Maestro>(
      `${CENTRAL_API_URL}/api/maestros/${provisionalId}/fusionar/${oficialId}`,
      {},
    );
  }

  /**
   * Incidencias de sync de provisionales trabados (>= 5 intentos) reportadas
   * por las básculas. Alimenta la alerta del panel admin en la cola de
   * provisionales. Lista vacía = no hay nada trabado.
   */
  incidenciasSync(): Observable<IncidenciaSync[]> {
    return this.http.get<IncidenciaSync[]>(`${CENTRAL_API_URL}/api/maestros/incidencias-sync`);
  }
}
