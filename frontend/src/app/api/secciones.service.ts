import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Cardinalidad } from './configuracion.models';

const CENTRAL_API_URL = 'http://localhost:5094';

export interface SeccionDto {
  id: string;
  clave: string;
  nombre: string;
  cardinalidad: Cardinalidad;
  reportable: boolean;
  estandar: boolean;
  orden: number;
  activa: boolean;
}

// El backend separa CrearSeccionRequest (sin `activa` — siempre nace activa y
// no estándar) de ActualizarSeccionRequest (con `activa`). Un solo input con
// `activa` opcional cubre ambos; `crear()` lo omite del envío.
export interface GuardarSeccionInput {
  clave: string;
  nombre: string;
  cardinalidad: Cardinalidad;
  reportable: boolean;
  orden: number;
  activa: boolean;
}

@Injectable({ providedIn: 'root' })
export class SeccionesService {
  private readonly http = inject(HttpClient);

  listar(incluirInactivas = false): Observable<SeccionDto[]> {
    return this.http.get<SeccionDto[]>(
      `${CENTRAL_API_URL}/api/secciones?incluirInactivas=${incluirInactivas}`,
    );
  }

  crear(input: Omit<GuardarSeccionInput, 'activa'>): Observable<SeccionDto> {
    return this.http.post<SeccionDto>(`${CENTRAL_API_URL}/api/secciones`, input);
  }

  actualizar(id: string, input: GuardarSeccionInput): Observable<SeccionDto> {
    return this.http.put<SeccionDto>(`${CENTRAL_API_URL}/api/secciones/${id}`, input);
  }

  eliminar(id: string): Observable<void> {
    return this.http.delete<void>(`${CENTRAL_API_URL}/api/secciones/${id}`);
  }
}
