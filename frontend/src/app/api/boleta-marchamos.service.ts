import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface MarchamoDto {
  ocurrencia: number;
  numero: string;
  placa: string | null;
  equipoId: string | null;
  activo: boolean;
  observaciones: string | null;
}

export interface MarchamosBoletaDto {
  rowVersion: string;
  marchamos: MarchamoDto[];
}

export interface AgregarMarchamoInput {
  numero: string;
  placa?: string | null;
  equipoId?: string | null;
  activo: boolean;
  observaciones?: string | null;
  observacionCambio: string;
  rowVersion: string;
}

export interface RectificarMarchamoInput {
  numero: string;
  activo: boolean;
  observaciones?: string | null;
  observacionCambio: string;
  rowVersion: string;
}

/** Central-only operation, like reprinting; it is intentionally absent from the Electron Outbox. */
@Injectable({ providedIn: 'root' })
export class BoletaMarchamosService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/api/boletas`;

  listar(boletaId: string): Observable<MarchamosBoletaDto> {
    return this.http.get<MarchamosBoletaDto>(`${this.baseUrl}/${boletaId}/marchamos`);
  }

  agregar(boletaId: string, input: AgregarMarchamoInput): Observable<MarchamosBoletaDto> {
    return this.http.post<MarchamosBoletaDto>(`${this.baseUrl}/${boletaId}/marchamos`, input);
  }

  rectificar(
    boletaId: string,
    ocurrencia: number,
    input: RectificarMarchamoInput,
  ): Observable<MarchamosBoletaDto> {
    return this.http.put<MarchamosBoletaDto>(
      `${this.baseUrl}/${boletaId}/marchamos/${ocurrencia}`,
      input,
    );
  }
}
