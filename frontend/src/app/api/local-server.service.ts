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
  habilitaCalidad: boolean;
  habilitaDetalleFruta: boolean;
  habilitaCompostera: boolean;
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
  habilitaCalidad: boolean;
  habilitaDetalleFruta: boolean;
  habilitaCompostera: boolean;
}

export interface CerrarBoletaInput {
  pesoSalida: number;
  origenPesoSalida: OrigenPeso;
  usuarioSalida: string;
  basculaSalidaId?: string | null;
}

// Extensiones de Boleta (Calidad, DetalleFruta, Compostera, Caracteristica) —
// mismos campos que BoletaCalidadLocal/BoletaDetalleFrutaLocal/
// BoletaComposteraLocal/BoletaCaracteristicaLocal en frontend/electron/db.ts.
export interface BoletaCalidadLocal {
  id: string;
  boletaId: string;
  acidez: number | null;
  luz: number | null;
  dobi: number | null;
  humedad: number | null;
  temperatura: number | null;
  numeroRevisionQA: string | null;
}

export interface GuardarBoletaCalidadInput {
  acidez: number | null;
  luz: number | null;
  dobi: number | null;
  humedad: number | null;
  temperatura: number | null;
  numeroRevisionQA: string | null;
}

export interface BoletaComposteraLocal {
  id: string;
  boletaId: string;
  cui: string;
  camaId: string;
  seccionId: string;
  cicloId: string;
}

export interface GuardarBoletaComposteraInput {
  cui: string;
  camaId: string;
  seccionId: string;
  cicloId: string;
}

export interface BoletaDetalleFrutaLocal {
  id: string;
  boletaId: string;
  racimosVerdes: number;
  racimosMaduros: number;
  racimosSobreMaduros: number;
  racimosPasados: number;
  pedunculoLargo: number;
}

export type GuardarBoletaDetalleFrutaInput = Omit<BoletaDetalleFrutaLocal, 'id' | 'boletaId'>;

export interface BoletaCaracteristicaLocal {
  id: string;
  boletaId: string;
  caracteristicaId: string;
  cantidad: number;
}

export type AgregarBoletaCaracteristicaInput = Omit<BoletaCaracteristicaLocal, 'id' | 'boletaId'>;

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

  // Extensiones — Calidad, DetalleFruta y Compostera son upsert 1:1 por
  // boleta (PUT); Caracteristica es la única colección 1:N (POST/DELETE por
  // fila).
  obtenerCalidad(boletaId: string): Observable<BoletaCalidadLocal> {
    return this.http.get<BoletaCalidadLocal>(`${LOCAL_SERVER_URL}/boletas/${boletaId}/calidad`);
  }

  guardarCalidad(boletaId: string, input: GuardarBoletaCalidadInput): Observable<BoletaCalidadLocal> {
    return this.http.put<BoletaCalidadLocal>(`${LOCAL_SERVER_URL}/boletas/${boletaId}/calidad`, input);
  }

  obtenerCompostera(boletaId: string): Observable<BoletaComposteraLocal> {
    return this.http.get<BoletaComposteraLocal>(`${LOCAL_SERVER_URL}/boletas/${boletaId}/compostera`);
  }

  guardarCompostera(
    boletaId: string,
    input: GuardarBoletaComposteraInput,
  ): Observable<BoletaComposteraLocal> {
    return this.http.put<BoletaComposteraLocal>(
      `${LOCAL_SERVER_URL}/boletas/${boletaId}/compostera`,
      input,
    );
  }

  // Un 404 acá es el caso normal de "nada guardado todavía" — el caller lo
  // maneja (ver abrirDetalle() en pesaje-page), no es responsabilidad de
  // este service.
  obtenerDetalleFruta(boletaId: string): Observable<BoletaDetalleFrutaLocal> {
    return this.http.get<BoletaDetalleFrutaLocal>(
      `${LOCAL_SERVER_URL}/boletas/${boletaId}/detalle-fruta`,
    );
  }

  guardarDetalleFruta(
    boletaId: string,
    input: GuardarBoletaDetalleFrutaInput,
  ): Observable<BoletaDetalleFrutaLocal> {
    return this.http.put<BoletaDetalleFrutaLocal>(
      `${LOCAL_SERVER_URL}/boletas/${boletaId}/detalle-fruta`,
      input,
    );
  }

  listarCaracteristicas(boletaId: string): Observable<BoletaCaracteristicaLocal[]> {
    return this.http.get<BoletaCaracteristicaLocal[]>(
      `${LOCAL_SERVER_URL}/boletas/${boletaId}/caracteristicas`,
    );
  }

  agregarCaracteristica(
    boletaId: string,
    input: AgregarBoletaCaracteristicaInput,
  ): Observable<BoletaCaracteristicaLocal> {
    return this.http.post<BoletaCaracteristicaLocal>(
      `${LOCAL_SERVER_URL}/boletas/${boletaId}/caracteristicas`,
      input,
    );
  }

  eliminarCaracteristica(boletaId: string, id: string): Observable<void> {
    return this.http.delete<void>(`${LOCAL_SERVER_URL}/boletas/${boletaId}/caracteristicas/${id}`);
  }
}
