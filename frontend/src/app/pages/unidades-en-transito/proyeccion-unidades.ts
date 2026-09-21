import { BoletaDto } from '../../api/boletas.service';
import { valorLegible } from '../boletas/boletas-page/valores-agrupados';
import { calcularTiempoTranscurridoMs } from '../boletas/semaforo/tiempo-transcurrido';

/**
 * Proyecciones de la página "Unidades en Tránsito". Funciones puras y
 * testeables sin TestBed: el componente solo conecta el servicio, el reloj y
 * la plantilla con esto.
 */
export interface UnidadEnTransito {
  boleta: BoletaDto;
  /** Milisegundos transcurridos desde el ingreso (o hasta la salida si ya cerró). */
  duracionMs: number;
}

const TRANSPORTE = 'transporte';

/** Boleta en tránsito proyectada + orden por MAYOR tiempo transcurrido primero. */
export function proyectarUnidades(
  boletas: readonly BoletaDto[],
  ahora: Date,
): UnidadEnTransito[] {
  return boletas
    .map((boleta) => ({
      boleta,
      duracionMs: calcularTiempoTranscurridoMs(
        boleta.fechaHoraIngreso,
        boleta.fechaHoraSalida,
        ahora,
      ),
    }))
    .sort((a, b) => {
      // La duración no medible (fecha ilegible → NaN) manda al tope: semáforo
      // rojo + arriba de la lista, para que el operador la vea primero.
      if (Number.isNaN(a.duracionMs) && !Number.isNaN(b.duracionMs)) return -1;
      if (Number.isNaN(b.duracionMs) && !Number.isNaN(a.duracionMs)) return 1;
      return b.duracionMs - a.duracionMs;
    });
}

/** Valor legible de un campo de la sección `transporte` (primera ocurrencia). */
function valorTransporte(boleta: BoletaDto, campoClave: string): string | null {
  const v = boleta.valores.find(
    (x) => x.seccionClave === TRANSPORTE && x.campoClave === campoClave && x.ocurrencia === 0,
  );
  if (!v) return null;
  const legible = valorLegible(v);
  return legible === '—' ? null : legible;
}

/** Placa; si no hay placa, cae al equipo (clave `placa` solo cuenta de transporte). */
export function placaUnidad(boleta: BoletaDto): string {
  return valorTransporte(boleta, 'placa') ?? valorTransporte(boleta, 'equipo') ?? '—';
}

export function nombrePiloto(boleta: BoletaDto): string {
  return valorTransporte(boleta, 'piloto') ?? '—';
}
