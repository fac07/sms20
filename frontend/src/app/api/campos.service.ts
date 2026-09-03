import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { TipoCampo, TipoCatalogoRef } from './configuracion.models';

const CENTRAL_API_URL = 'http://localhost:5094';

export interface CampoDto {
  id: string;
  seccionId: string;
  clave: string;
  etiqueta: string;
  tipoCampo: TipoCampo;
  tipoCatalogoRef: TipoCatalogoRef | null;
  requerido: boolean;
  configuracion: string | null;
  orden: number;
  vigenteDesde: string;
  vigenteHasta: string | null;
}

// Espejo de backend CrearCampoRequest — incluye clave/tipoCampo/tipoCatalogoRef.
export interface CrearCampoInput {
  seccionId: string;
  clave: string;
  etiqueta: string;
  tipoCampo: TipoCampo;
  tipoCatalogoRef: TipoCatalogoRef | null;
  requerido: boolean;
  configuracion: string | null;
  orden: number;
}

// Espejo de backend ActualizarCampoRequest — NO incluye clave/tipoCampo/
// tipoCatalogoRef: cambiar identidad o reglas de tipado exige versionar.
export interface ActualizarCampoInput {
  etiqueta: string;
  requerido: boolean;
  configuracion: string | null;
  orden: number;
}

// Espejo de backend NuevaVersionCampoRequest. La tarea original preveía un
// body vacío, pero el endpoint POST /api/campos/{id}/nueva-version en `main`
// exige este payload — es la única vía para cambiar tipoCampo/tipoCatalogoRef.
export interface NuevaVersionCampoInput {
  etiqueta: string;
  tipoCampo: TipoCampo;
  tipoCatalogoRef: TipoCatalogoRef | null;
  requerido: boolean;
  configuracion: string | null;
  orden: number;
}

@Injectable({ providedIn: 'root' })
export class CamposService {
  private readonly http = inject(HttpClient);

  listar(seccionId?: string, incluirHistoricos = false): Observable<CampoDto[]> {
    const params = new URLSearchParams();
    if (seccionId) params.set('seccionId', seccionId);
    params.set('incluirHistoricos', String(incluirHistoricos));
    return this.http.get<CampoDto[]>(`${CENTRAL_API_URL}/api/campos?${params.toString()}`);
  }

  crear(input: CrearCampoInput): Observable<CampoDto> {
    return this.http.post<CampoDto>(`${CENTRAL_API_URL}/api/campos`, input);
  }

  actualizar(id: string, input: ActualizarCampoInput): Observable<CampoDto> {
    return this.http.put<CampoDto>(`${CENTRAL_API_URL}/api/campos/${id}`, input);
  }

  nuevaVersion(id: string, input: NuevaVersionCampoInput): Observable<CampoDto> {
    return this.http.post<CampoDto>(`${CENTRAL_API_URL}/api/campos/${id}/nueva-version`, input);
  }

  eliminar(id: string): Observable<void> {
    return this.http.delete<void>(`${CENTRAL_API_URL}/api/campos/${id}`);
  }
}
