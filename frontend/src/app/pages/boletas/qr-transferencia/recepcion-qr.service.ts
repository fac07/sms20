import { Injectable } from '@angular/core';
import { CampoAplicable } from '../../../api/configuracion.models';
import {
  EfectosRecepcionQr,
  ResultadoRecepcionQr,
  procesarRecepcionQr,
} from './procesar-recepcion-qr';

/**
 * Envoltorio inyectable de `procesarRecepcionQr` (función pura). Sin esto,
 * `PesajePage` no podría reemplazarlo en sus tests: Angular's unit-test
 * builder rechaza `vi.mock` sobre imports relativos ("use Angular TestBed
 * para mocking de dependencias") — este seam de DI es el camino soportado,
 * mismo patrón que `LocalServerService` sobre HttpClient.
 */
@Injectable({ providedIn: 'root' })
export class RecepcionQrService {
  procesar(
    textoEscaneado: string,
    campos: readonly CampoAplicable[],
    efectos: EfectosRecepcionQr,
  ): Promise<ResultadoRecepcionQr> {
    return procesarRecepcionQr(textoEscaneado, campos, efectos);
  }
}
