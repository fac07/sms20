import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

const CENTRAL_API_URL = environment.apiUrl;

/** Una fila del consolidado báscula×día de `GET /api/reportes/resumen-basculas`. */
export interface ResumenBasculaDia {
  basculaId: string;
  basculaNombre: string;
  // Día calendario UTC de cierre, 'YYYY-MM-DD' (DateOnly del backend).
  fecha: string;
  cantidadBoletas: number;
  pesoNetoTotal: number;
}

@Injectable({ providedIn: 'root' })
export class ReportesService {
  private readonly http = inject(HttpClient);

  // Desde/hasta son días calendario inclusivos en la misma forma que los
  // inputs de fecha del filtro ('YYYY-MM-DD') — el servicio no toca `Date`
  // para que ninguna conversión de zona mueva el día pedido.
  resumenBasculas(desde: string, hasta: string): Observable<ResumenBasculaDia[]> {
    return this.http.get<ResumenBasculaDia[]>(
      `${CENTRAL_API_URL}/api/reportes/resumen-basculas?desde=${desde}&hasta=${hasta}`,
    );
  }
}
