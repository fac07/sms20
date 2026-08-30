import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

const CENTRAL_API_URL = 'http://localhost:5094';

export type TipoConexion = 'Serial' | 'Ethernet';

export interface Bascula {
  id: string;
  codigo: string;
  nombre: string;
  centroId: string;
  centroNombre: string | null;
  tipoConexion: TipoConexion;
  puerto: string | null;
  ip: string | null;
  puertoTcp: number | null;
  velocidad: number | null;
  bitsDatos: number | null;
  modoComunicacion: string | null;
  activa: boolean;
  aprovisionada: boolean;
  tieneCodigoVigente: boolean;
}

export interface GuardarBasculaInput {
  codigo: string;
  nombre: string;
  centroId: string;
  tipoConexion: TipoConexion;
  puerto: string | null;
  ip: string | null;
  puertoTcp: number | null;
  velocidad: number | null;
  bitsDatos: number | null;
  modoComunicacion: string | null;
}

export interface CodigoAprovisionamiento {
  codigo: string;
  expira: string;
}

@Injectable({ providedIn: 'root' })
export class BasculasService {
  private readonly http = inject(HttpClient);

  listar(incluirInactivas = false): Observable<Bascula[]> {
    return this.http.get<Bascula[]>(
      `${CENTRAL_API_URL}/api/basculas?incluirInactivas=${incluirInactivas}`,
    );
  }

  crear(input: GuardarBasculaInput): Observable<Bascula> {
    return this.http.post<Bascula>(`${CENTRAL_API_URL}/api/basculas`, input);
  }

  actualizar(id: string, input: GuardarBasculaInput): Observable<Bascula> {
    return this.http.put<Bascula>(`${CENTRAL_API_URL}/api/basculas/${id}`, input);
  }

  desactivar(id: string): Observable<void> {
    return this.http.delete<void>(`${CENTRAL_API_URL}/api/basculas/${id}`);
  }

  generarCodigo(id: string): Observable<CodigoAprovisionamiento> {
    return this.http.post<CodigoAprovisionamiento>(
      `${CENTRAL_API_URL}/api/basculas/${id}/generar-codigo`,
      {},
    );
  }
}
