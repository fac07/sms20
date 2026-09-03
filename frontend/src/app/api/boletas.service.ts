import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ValorCampoDto, ValorCampoLeidoDto } from './configuracion.models';

const CENTRAL_API_URL = 'http://localhost:5094';

export type EstadoBoleta = 'EnTransito' | 'Cerrada' | 'Anulada' | 'Reemitida';

export type EstadoSyncBoleta =
  | 'Local'
  | 'SincronizadoCentral'
  | 'ErrorCentral'
  | 'SincronizadoD365'
  | 'ErrorD365';

export type OrigenPeso = 'Bascula' | 'Manual';

/**
 * Espejo de backend BoletaDto (v7). El contexto de negocio
 * (transporte/producto/ubicación/calidad/...) ya no viaja como FKs fijas de
 * Maestro sino en `valores` como campos configurables keyed por
 * (campoId, ocurrencia).
 */
export interface BoletaDto {
  id: string;
  numeroBoleta: string;
  basculaId: string;
  basculaCodigo: string | null;
  tipoMovimientoId: string;
  tipoMovimientoNombre: string | null;
  estado: EstadoBoleta;
  estadoSync: EstadoSyncBoleta;
  pesoIngreso: number;
  pesoSalida: number | null;
  pesoNeto: number | null;
  origenPesoIngreso: OrigenPeso;
  origenPesoSalida: OrigenPeso | null;
  fechaHoraIngreso: string;
  fechaHoraSalida: string | null;
  usuarioIngreso: string;
  usuarioSalida: string | null;
  usuarioAnula: string | null;
  usuarioAutoriza: string | null;
  motivoAnulacion: string | null;
  fechaHoraAnulacion: string | null;
  boletaReemplazoId: string | null;
  boletaOrigenId: string | null;
  basculaSalidaId: string | null;
  preIngresoId: string | null;
  respuestaD365Id: string | null;
  creadaOffline: boolean;
  valores: ValorCampoLeidoDto[];
}

/**
 * Espejo de backend CrearBoletaRequest. `valores` acompaña la creación tipada;
 * en slice A nada del frontend lo envía todavía (el motor configurable llega
 * en slice C), pero el tipo ya lo contempla.
 */
export interface CrearBoletaInput {
  numeroBoleta: string;
  basculaId: string;
  tipoMovimientoId: string;
  pesoIngreso: number;
  origenPesoIngreso: OrigenPeso;
  usuarioIngreso: string;
  creadaOffline: boolean;
  valores: ValorCampoDto[];
}

@Injectable({ providedIn: 'root' })
export class BoletasService {
  private readonly http = inject(HttpClient);

  listar(estado?: EstadoBoleta): Observable<BoletaDto[]> {
    const query = estado ? `?estado=${estado}` : '';
    return this.http.get<BoletaDto[]>(`${CENTRAL_API_URL}/api/boletas${query}`);
  }

  obtener(id: string): Observable<BoletaDto> {
    return this.http.get<BoletaDto>(`${CENTRAL_API_URL}/api/boletas/${id}`);
  }
}
