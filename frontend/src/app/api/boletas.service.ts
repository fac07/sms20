import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ValorCampoDto, ValorCampoLeidoDto } from './configuracion.models';
import { environment } from '../../environments/environment';
import { MotivoPesoManual } from './motivo-peso-manual';

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
  // Solo cuando alguno de los pesajes fue Manual: el motivo del catálogo y el
  // detalle libre. Nullable — las boletas 100% báscula y las previas al cambio
  // los traen en null.
  motivoPesoManual: MotivoPesoManual | null;
  motivoPesoManualDetalle: string | null;
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

  /** Autoridad de lectura determinística por build; nunca mezcla ambos scopes. */
  private get baseUrl(): string {
    if (environment.modo === 'admin') return `${environment.apiUrl}/api/boletas`;
    if (!environment.localServerUrl) {
      throw new Error('localServerUrl is required in bascula mode.');
    }
    return `${environment.localServerUrl}/boletas`;
  }

  listar(estado?: EstadoBoleta, origenPeso?: OrigenPeso): Observable<BoletaDto[]> {
    const params: string[] = [];
    if (estado) params.push(`estado=${estado}`);
    if (origenPeso) params.push(`origenPeso=${origenPeso}`);
    const query = params.length > 0 ? `?${params.join('&')}` : '';
    return this.http.get<BoletaDto[]>(`${this.baseUrl}${query}`);
  }

  obtener(id: string): Observable<BoletaDto> {
    return this.http.get<BoletaDto>(`${this.baseUrl}/${id}`);
  }
}
