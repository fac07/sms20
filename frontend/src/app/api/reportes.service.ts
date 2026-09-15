import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface ReporteDiarioFila {
  fecha: string;
  cantidadBoletas: number;
  pesoNetoTotal: number;
}

@Injectable({ providedIn: 'root' })
export class ReportesService {
  private readonly http = inject(HttpClient);

  diario(tipoMovimientoId: string, desde: string, hasta: string): Observable<ReporteDiarioFila[]> {
    const params = new HttpParams()
      .set('tipoMovimientoId', tipoMovimientoId)
      .set('desde', desde)
      .set('hasta', hasta);
    return this.http.get<ReporteDiarioFila[]>(`${environment.apiUrl}/api/reportes/diario`, {
      params,
    });
  }
}
