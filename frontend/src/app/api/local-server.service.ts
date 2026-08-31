import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

// Servidor LOCAL de Electron (127.0.0.1:4127) — no confundir con el backend
// central (http://localhost:5094) que usan los demás servicios de src/app/api.
// Ver src/app/layout/peso-simulado-panel para el mismo patrón de acceso.
const LOCAL_SERVER_URL = 'http://127.0.0.1:4127';

export type OrigenPeso = 'Bascula' | 'Manual';

export type EstadoBoletaLocal = 'EnTransito' | 'Cerrada' | 'Anulada' | 'Reemitida';

export type EstadoSyncBoletaLocal =
  | 'Local'
  | 'SincronizadoCentral'
  | 'ErrorCentral'
  | 'SincronizadoD365'
  | 'ErrorD365';

// Mismos campos que BoletaLocal en frontend/electron/db.ts (camelCase) — esta
// es la respuesta cruda del servidor local, sin nombres denormalizados como
// tipoMovimientoNombre (a diferencia de la Boleta del backend central).
export interface BoletaLocal {
  id: string;
  numeroBoleta: string;
  tipoMovimientoId: string;
  estado: EstadoBoletaLocal;
  estadoSync: EstadoSyncBoletaLocal;
  equipoId: string;
  transportistaId: string;
  pilotoId: string;
  terceroId: string;
  productoId: string;
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

export interface LecturaPeso {
  peso: number | null;
  origen: OrigenPeso | null;
}

export interface EstadoLocal {
  aprovisionada: boolean;
  basculaId: string | null;
  basculaCodigo: string | null;
  dev: boolean;
}

export interface CrearBoletaInput {
  numeroBoletaPrefijo: string;
  codigoBascula: string;
  tipoMovimientoId: string;
  equipoId: string;
  transportistaId: string;
  pilotoId: string;
  terceroId: string;
  productoId: string;
  almacenOrigenId: string | null;
  almacenDestinoId: string | null;
  pesoIngreso: number;
  origenPesoIngreso: OrigenPeso;
  usuarioIngreso: string;
  creadaOffline: boolean;
}

export interface CerrarBoletaInput {
  pesoSalida: number;
  origenPesoSalida: OrigenPeso;
  usuarioSalida: string;
  basculaSalidaId?: string | null;
}

/**
 * Cliente del servidor local de Electron (127.0.0.1:4127) — contrapartida de
 * los servicios de esta carpeta que hablan con el backend central. Es el
 * único lugar de este screen que lee/escribe la Boleta real: la creación y
 * el cierre son 100% offline-capable contra SQLite, a diferencia de los
 * catálogos (ver pesaje-page, que sí depende de central hoy).
 */
@Injectable({ providedIn: 'root' })
export class LocalServerService {
  private readonly http = inject(HttpClient);

  obtenerEstado(): Observable<EstadoLocal> {
    return this.http.get<EstadoLocal>(`${LOCAL_SERVER_URL}/estado`);
  }

  obtenerPeso(): Observable<LecturaPeso> {
    return this.http.get<LecturaPeso>(`${LOCAL_SERVER_URL}/peso`);
  }

  listarBoletasEnTransito(): Observable<BoletaLocal[]> {
    return this.http.get<BoletaLocal[]>(`${LOCAL_SERVER_URL}/boletas?estado=EnTransito`);
  }

  crearBoleta(input: CrearBoletaInput): Observable<BoletaLocal> {
    return this.http.post<BoletaLocal>(`${LOCAL_SERVER_URL}/boletas`, input);
  }

  cerrarBoleta(id: string, input: CerrarBoletaInput): Observable<BoletaLocal> {
    return this.http.post<BoletaLocal>(`${LOCAL_SERVER_URL}/boletas/${id}/cerrar`, input);
  }
}
