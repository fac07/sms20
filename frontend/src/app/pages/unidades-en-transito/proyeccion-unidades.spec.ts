import { BoletaDto } from '../../api/boletas.service';
import { ValorCampoLeidoDto } from '../../api/configuracion.models';
import { nombrePiloto, placaUnidad, proyectarUnidades } from './proyeccion-unidades';

function boleta(parcial: Partial<BoletaDto> = {}): BoletaDto {
  return {
    id: 'b-1',
    numeroBoleta: 'IF-B01-000001',
    basculaId: 'ba-1',
    basculaCodigo: 'B01',
    tipoMovimientoId: 'tm-1',
    tipoMovimientoNombre: 'Ingreso de fruta',
    generaQR: false,
    estado: 'EnTransito',
    estadoSync: 'SincronizadoCentral',
    pesoIngreso: 20000,
    pesoSalida: null,
    pesoNeto: null,
    origenPesoIngreso: 'Bascula',
    origenPesoSalida: null,
    motivoPesoManual: null,
    motivoPesoManualDetalle: null,
    fechaHoraIngreso: '2026-09-10T12:00:00Z',
    fechaHoraSalida: null,
    usuarioIngreso: 'operador',
    usuarioSalida: null,
    usuarioAnula: null,
    usuarioAutoriza: null,
    motivoAnulacion: null,
    fechaHoraAnulacion: null,
    usuarioTrasiego: null,
    fechaHoraTrasiego: null,
    motivoTrasiego: null,
    boletaReemplazoId: null,
    boletaOrigenId: null,
    basculaSalidaId: null,
    preIngresoId: null,
    preIngresoNumeroEnvio: null,
    preIngresoEstado: null,
    marcaPreIngreso: null,
    respuestaD365Id: null,
    creadaOffline: false,
    valores: [],
    ...parcial,
  } as BoletaDto;
}

function valor(parcial: Partial<ValorCampoLeidoDto> &
  Pick<ValorCampoLeidoDto, 'campoId' | 'seccionClave' | 'campoClave'>): ValorCampoLeidoDto {
  return {
    seccionNombre: 'Transporte',
    etiqueta: parcial.campoClave,
    tipoCampo: 'ReferenciaMaestro',
    ocurrencia: 0,
    valorMaestroNombre: 'Nombre maestro',
    ...parcial,
  } as ValorCampoLeidoDto;
}

describe('proyectarUnidades — orden por mayor tiempo transcurrido', () => {
  const ahora = new Date(Date.UTC(2026, 8, 10, 18, 0, 0));

  it('ordena descendente por duración (la más vieja primero)', () => {
    const nuevas = boleta({ id: 'n', fechaHoraIngreso: '2026-09-10T17:00:00Z' });
    const viejas = boleta({ id: 'v', fechaHoraIngreso: '2026-09-09T09:00:00Z' });
    const medias = boleta({ id: 'm', fechaHoraIngreso: '2026-09-10T10:00:00Z' });

    const filas = proyectarUnidades([nuevas, viejas, medias], ahora);

    expect(filas.map((f) => f.boleta.id)).toEqual(['v', 'm', 'n']);
    expect(filas[0].duracionMs).toBe(33 * 3_600_000);
  });

  it('las duraciones no medibles (fecha ilegible) van primero: rojo y a mirar', () => {
    const corrupta = boleta({ id: 'x', fechaHoraIngreso: 'no-fecha' as string });
    const enTransito = boleta({ id: 't', fechaHoraIngreso: '2026-09-10T12:00:00Z' });

    const filas = proyectarUnidades([enTransito, corrupta], ahora);

    expect(filas.map((f) => f.boleta.id)).toEqual(['x', 't']);
    expect(Number.isNaN(filas[0].duracionMs)).toBe(true);
  });

  it('una cerrada con salida ya no avanza con `ahora` (aunque acá solo se listen en tránsito)', () => {
    const cerrada = boleta({
      id: 'c',
      estado: 'Cerrada',
      fechaHoraIngreso: '2026-09-10T12:00:00Z',
      fechaHoraSalida: '2026-09-10T13:00:00Z',
    });

    const filas = proyectarUnidades([cerrada], new Date(Date.UTC(2027, 0, 1)));

    expect(filas[0].duracionMs).toBe(3_600_000);
  });
});

describe('placaUnidad / nombrePiloto — columnas de transporte desde `valores`', () => {
  it('resuelve la placa de la sección transporte y cae al equipo si falta la placa', () => {
    const conPlaca = boleta({
      valores: [valor({ campoId: 'f1', seccionClave: 'transporte', campoClave: 'placa', tipoCampo: 'Texto', valorMaestroNombre: null, valorTexto: 'ABC-123' })],
    });
    const soloEquipo = boleta({
      valores: [
        valor({ campoId: 'f1', seccionClave: 'transporte', campoClave: 'equipo', valorMaestroNombre: 'Tractor 7' }),
      ],
    });

    expect(placaUnidad(conPlaca)).toBe('ABC-123');
    expect(placaUnidad(soloEquipo)).toBe('Tractor 7');
    expect(placaUnidad(boleta())).toBe('—');
  });

  it('ignora las placas de otras secciones (marchamos también usa la clave `placa`)', () => {
    const soloMarchamos = boleta({
      valores: [valor({ campoId: 'f1', seccionClave: 'marchamos', campoClave: 'placa', valorTexto: 'NO-APLICAR' })],
    });

    expect(placaUnidad(soloMarchamos)).toBe('—');
  });

  it('el piloto se lee de la sección transporte; sin valor, —', () => {
    const conPiloto = boleta({
      valores: [valor({ campoId: 'f9', seccionClave: 'transporte', campoClave: 'piloto', valorMaestroNombre: 'Juán Pérez' })],
    });

    expect(nombrePiloto(conPiloto)).toBe('Juán Pérez');
    expect(nombrePiloto(boleta())).toBe('—');
  });

  it('toma la primera ocurrencia cuando hay varias unidades', () => {
    const dosCamiones = boleta({
      valores: [
        valor({ campoId: 'f1', seccionClave: 'transporte', campoClave: 'placa', ocurrencia: 0, tipoCampo: 'Texto', valorMaestroNombre: null, valorTexto: 'AAA-000' }),
        valor({ campoId: 'f2', seccionClave: 'transporte', campoClave: 'placa', ocurrencia: 1, tipoCampo: 'Texto', valorMaestroNombre: null, valorTexto: 'BBB-111' }),
      ],
    });

    expect(placaUnidad(dosCamiones)).toBe('AAA-000');
  });
});
