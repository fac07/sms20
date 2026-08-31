import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

const CENTRAL_API_URL = 'http://localhost:5094';

export type EstadoBoleta = 'EnTransito' | 'Cerrada' | 'Anulada' | 'Reemitida';

export type EstadoSyncBoleta =
  | 'Local'
  | 'SincronizadoCentral'
  | 'ErrorCentral'
  | 'SincronizadoD365'
  | 'ErrorD365';

export type OrigenPeso = 'Bascula' | 'Manual';

export interface Boleta {
  id: string;
  numeroBoleta: string;
  basculaId: string;
  basculaCodigo: string;
  tipoMovimientoId: string;
  tipoMovimientoNombre: string;
  estado: EstadoBoleta;
  estadoSync: EstadoSyncBoleta;
  equipoId: string;
  equipoCodigo: string;
  transportistaId: string;
  transportistaCodigo: string;
  pilotoId: string;
  pilotoCodigo: string;
  terceroId: string;
  terceroCodigo: string;
  productoId: string;
  productoCodigo: string;
  almacenOrigenId: string | null;
  almacenDestinoId: string | null;
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
  boletaReemplazoId: string | null;
  boletaOrigenId: string | null;
  basculaSalidaId: string | null;
  respuestaD365Id: string | null;
  creadaOffline: boolean;
}

@Injectable({ providedIn: 'root' })
export class BoletasService {
  private readonly http = inject(HttpClient);

  listar(estado?: EstadoBoleta): Observable<Boleta[]> {
    const query = estado ? `?estado=${estado}` : '';
    return this.http.get<Boleta[]>(`${CENTRAL_API_URL}/api/boletas${query}`);
  }

  obtener(id: string): Observable<Boleta> {
    return this.http.get<Boleta>(`${CENTRAL_API_URL}/api/boletas/${id}`);
  }
}
