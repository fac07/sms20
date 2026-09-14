import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// URL del backend central, centralizada en `src/environments`.
const CENTRAL_API_URL = environment.apiUrl;

export type EstadoPreIngreso = 'Pendiente' | 'Vinculado' | 'Cancelado';

export interface PreIngreso {
  id: string;
  centroId: string;
  pilotoId: string | null;
  transportistaId: string | null;
  equipoId: string | null;
  regionId: string | null;
  fincaId: string | null;
  numeroEnvio: string;
  pesoEnviado: number;
  racimos: number | null;
  sacos: number | null;
  estado: EstadoPreIngreso;
  boletaId: string | null;
  usuarioCreacion: string;
  usuarioCancela: string | null;
  motivoCancelacion: string | null;
  fechaCreacion: string;
  fechaModificacion: string;
}

export interface GuardarPreIngresoInput {
  centroId: string;
  numeroEnvio: string;
  pesoEnviado: number;
  pilotoId: string | null;
  transportistaId: string | null;
  equipoId: string | null;
  regionId: string | null;
  fincaId: string | null;
  racimos: number | null;
  sacos: number | null;
}

export interface CancelarPreIngresoInput {
  usuarioCancela: string;
  motivoCancelacion: string | null;
}

@Injectable({ providedIn: 'root' })
export class PreingresosService {
  private readonly http = inject(HttpClient);

  listar(opts?: { centroId?: string; estado?: EstadoPreIngreso; numeroEnvio?: string }): Observable<PreIngreso[]> {
    const params = new URLSearchParams();
    if (opts?.centroId) params.set('centroId', opts.centroId);
    if (opts?.estado) params.set('estado', opts.estado);
    if (opts?.numeroEnvio) params.set('numeroEnvio', opts.numeroEnvio);
    const query = params.toString();
    return this.http.get<PreIngreso[]>(
      `${CENTRAL_API_URL}/api/preingresos${query ? `?${query}` : ''}`,
    );
  }

  obtener(id: string): Observable<PreIngreso> {
    return this.http.get<PreIngreso>(`${CENTRAL_API_URL}/api/preingresos/${id}`);
  }

  crear(input: GuardarPreIngresoInput & { usuarioCreacion: string }): Observable<PreIngreso> {
    return this.http.post<PreIngreso>(`${CENTRAL_API_URL}/api/preingresos`, input);
  }

  actualizar(id: string, input: GuardarPreIngresoInput): Observable<PreIngreso> {
    return this.http.put<PreIngreso>(`${CENTRAL_API_URL}/api/preingresos/${id}`, input);
  }

  cancelar(id: string, input: CancelarPreIngresoInput): Observable<PreIngreso> {
    return this.http.post<PreIngreso>(`${CENTRAL_API_URL}/api/preingresos/${id}/cancelar`, input);
  }
}
