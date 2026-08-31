import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

// Sin .env: no hay secretos acá, y el puerto de dev del backend central es
// estable (launchSettings.json, perfil "http"). En producción esto va a
// venir de la config de la báscula post-aprovisionamiento, no de un build-time env.
const CENTRAL_API_URL = 'http://localhost:5094';

export type DireccionMovimiento = 'Entrada' | 'Salida' | 'Transferencia';

export interface TipoMovimiento {
  id: string;
  codigo: string;
  nombre: string;
  prefijo: string;
  direccion: DireccionMovimiento;
  habilitaCalidad: boolean;
  habilitaMarchamos: boolean;
  habilitaQR: boolean;
  habilitaDatosFinca: boolean;
  habilitaDetalleFruta: boolean;
  habilitaCompostera: boolean;
  integracionD365: boolean;
  formatoBoletaId: string | null;
  activo: boolean;
}

export type GuardarTipoMovimientoInput = Omit<TipoMovimiento, 'id' | 'activo'>;

@Injectable({ providedIn: 'root' })
export class TiposMovimientoService {
  private readonly http = inject(HttpClient);

  listar(incluirInactivos = false): Observable<TipoMovimiento[]> {
    return this.http.get<TipoMovimiento[]>(
      `${CENTRAL_API_URL}/api/tipos-movimiento?incluirInactivos=${incluirInactivos}`,
    );
  }

  crear(input: GuardarTipoMovimientoInput): Observable<TipoMovimiento> {
    return this.http.post<TipoMovimiento>(`${CENTRAL_API_URL}/api/tipos-movimiento`, input);
  }

  actualizar(id: string, input: GuardarTipoMovimientoInput): Observable<TipoMovimiento> {
    return this.http.put<TipoMovimiento>(`${CENTRAL_API_URL}/api/tipos-movimiento/${id}`, input);
  }

  desactivar(id: string): Observable<void> {
    return this.http.delete<void>(`${CENTRAL_API_URL}/api/tipos-movimiento/${id}`);
  }
}
