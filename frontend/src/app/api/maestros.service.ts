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

  crear(input: GuardarMaestroInput): Observable<Maestro> {
    return this.http.post<Maestro>(`${CENTRAL_API_URL}/api/maestros`, input);
  }

  actualizar(id: string, input: GuardarMaestroInput): Observable<Maestro> {
    return this.http.put<Maestro>(`${CENTRAL_API_URL}/api/maestros/${id}`, input);
  }

  desactivar(id: string): Observable<void> {
    return this.http.delete<void>(`${CENTRAL_API_URL}/api/maestros/${id}`);
  }

  aprobar(id: string): Observable<Maestro> {
    return this.http.post<Maestro>(`${CENTRAL_API_URL}/api/maestros/${id}/aprobar`, {});
  }

  fusionar(provisionalId: string, oficialId: string): Observable<Maestro> {
    return this.http.post<Maestro>(
      `${CENTRAL_API_URL}/api/maestros/${provisionalId}/fusionar/${oficialId}`,
      {},
    );
  }
}
