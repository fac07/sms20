import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { CampoAplicable, ValorCampoDto } from './configuracion.models';

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
// es la respuesta cruda del servidor local. El reshape de slice D (D1/D4) quitó
// las 7 columnas FK de Maestro (equipoId, transportistaId, …) y los flags
// habilita*: ese contexto ahora son valores configurables (BoletaValorCampo)
// capturados por el renderer del motor.
export interface BoletaLocal {
  id: string;
  numeroBoleta: string;
  tipoMovimientoId: string;
  estado: EstadoBoletaLocal;
  estadoSync: EstadoSyncBoletaLocal;
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
  preIngresoId: string | null;
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

// Estado del último sync de configuración (Seccion/Campo/TipoMovimientoSeccion).
// `lastConfigSyncAt` es null hasta el primer sync exitoso; el indicador de
// staleness de la pantalla lo lee sin bloquear la creación de boletas.
export interface ConfigEstado {
  lastConfigSyncAt: string | null;
}

// Espejo del body que espera `POST /boletas` del servidor local tras el
// reshape D4: el encabezado estructural + `valores` capturados por el motor
// configurable. El servidor deriva `SeccionId` de cada valor server-side.
export interface CrearBoletaInput {
  numeroBoletaPrefijo: string;
  codigoBascula: string;
  tipoMovimientoId: string;
  pesoIngreso: number;
  origenPesoIngreso: OrigenPeso;
  usuarioIngreso: string;
  creadaOffline: boolean;
  valores: ValorCampoDto[];
}

export interface CerrarBoletaInput {
  pesoSalida: number;
  origenPesoSalida: OrigenPeso;
  usuarioSalida: string;
  basculaSalidaId?: string | null;
}

// Mismos campos que MaestroLocal en frontend/electron/db.ts — snapshot local
// del catálogo central que alimenta los combos de Pesaje sin depender de
// conectividad con Central.
export interface MaestroLocal {
  id: string;
  tipoCatalogo: string;
  codigo: string;
  nombre: string;
  datosAdicionales: string | null;
  estado: string;
  fusionadoConId: string | null;
  fechaModificacion: string;
  activo: boolean;
}

/**
 * Cliente del servidor local de Electron (127.0.0.1:4127) — contrapartida de
 * los servicios de esta carpeta que hablan con el backend central. Es el
 * único lugar de este screen que lee/escribe la Boleta real: el formulario,
 * la creación y el cierre son 100% offline-capable contra SQLite, a diferencia
 * de la consulta de solo lectura (ver boletas-page, que sí usa central).
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

  // Campos configurables que aplican al tipo de movimiento, resueltos as-of
  // ahora — 100% del espejo local de configuración, sin llamada a central
  // (ver GET /tipos-movimiento/:id/formulario en local-server.ts).
  formulario(tipoMovimientoId: string): Observable<CampoAplicable[]> {
    return this.http.get<CampoAplicable[]>(
      `${LOCAL_SERVER_URL}/tipos-movimiento/${tipoMovimientoId}/formulario`,
    );
  }

  // Nunca falla: si nunca sincronizó, lastConfigSyncAt es null.
  configEstado(): Observable<ConfigEstado> {
    return this.http.get<ConfigEstado>(`${LOCAL_SERVER_URL}/config/estado`);
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

  // Maestros — read path local de los combos de Pesaje (ver GET /maestros en
  // local-server.ts: siempre Activo=1). Contrapartida offline-capable de
  // MaestrosService.listar(), que pega directo a Central.
  listarMaestros(tipoCatalogo?: string): Observable<MaestroLocal[]> {
    const params = tipoCatalogo ? `?tipoCatalogo=${encodeURIComponent(tipoCatalogo)}` : '';
    return this.http.get<MaestroLocal[]>(`${LOCAL_SERVER_URL}/maestros${params}`);
  }

  aprovisionar(
    codigo: string,
  ): Observable<{ basculaId: string; basculaCodigo: string; maestrosDescargados: number }> {
    return this.http.post<{
      basculaId: string;
      basculaCodigo: string;
      maestrosDescargados: number;
    }>(`${LOCAL_SERVER_URL}/aprovisionamiento`, { codigo });
  }

  sincronizarMaestros(): Observable<{ descargados: number }> {
    return this.http.post<{ descargados: number }>(`${LOCAL_SERVER_URL}/maestros/sincronizar`, {});
  }
}
