import { BoletaDto } from '../../../api/boletas.service';
import {
  construirNombreArchivoBoletas,
  escaparCampo,
  fechaLegible,
  generarCsvBoletas,
  numeroConComaDecimal,
} from './exportar-csv';

function boleta(parcial: Partial<BoletaDto> = {}): BoletaDto {
  return {
    id: 'b-1',
    numeroBoleta: 'IF-B01-000001',
    basculaCodigo: 'B01',
    tipoMovimientoNombre: 'Ingreso de fruta',
    estado: 'Cerrada',
    pesoIngreso: 20000,
    pesoSalida: 3000,
    pesoNeto: 17000,
    origenPesoIngreso: 'Bascula',
    origenPesoSalida: 'Bascula',
    fechaHoraIngreso: '2026-09-10T12:00:00',
    fechaHoraSalida: '2026-09-10T13:00:00',
    motivoAnulacion: null,
    ...parcial,
  } as BoletaDto;
}

describe('escaparCampo — RFC4182-ish con separador ; para Excel en español', () => {
  it('texto simple queda igual', () => {
    expect(escaparCampo('ABC-123')).toBe('ABC-123');
  });

  it('comillas embebidas se doblan y el campo se entrecomilla', () => {
    expect(escaparCampo('decir "hola"')).toBe('"decir ""hola"""');
  });

  it('separador ; dentro del texto fuerza el entrecomillado', () => {
    expect(escaparCampo('a;b')).toBe('"a;b"');
  });

  it('saltos de línea (\n y \r) fuerzan entrecomillado', () => {
    expect(escaparCampo('línea1\nlínea2')).toBe('"línea1\nlínea2"');
    expect(escaparCampo('con\rretorno')).toBe('"con\rretorno"');
  });

  it('null y undefined se vierten vacíos (celda en blanco, no el string "null")', () => {
    expect(escaparCampo(null)).toBe('');
    expect(escaparCampo(undefined)).toBe('');
  });
});

describe('numeroConComaDecimal — decimales con coma, fijo a 2', () => {
  it('entero con dos decimales y coma', () => {
    expect(numeroConComaDecimal(17000)).toBe('17000,00');
  });

  it('decimal se redondea a 2 y cambia el punto por coma', () => {
    expect(numeroConComaDecimal(17000.5)).toBe('17000,50');
    expect(numeroConComaDecimal(1234.567)).toBe('1234,57');
    expect(numeroConComaDecimal(1234.564)).toBe('1234,56');
  });

  it('negativos conservan el signo', () => {
    expect(numeroConComaDecimal(-3.1415)).toBe('-3,14');
  });

  it('null, undefined y NaN → celda vacía', () => {
    expect(numeroConComaDecimal(null)).toBe('');
    expect(numeroConComaDecimal(undefined)).toBe('');
    expect(numeroConComaDecimal(Number.NaN)).toBe('');
  });
});

describe('fechaLegible — ISO → dd/mm/aaaa hh:mm en 24 h', () => {
  it('formatea sin dependencias de zona usando un ISO local', () => {
    expect(fechaLegible('2026-09-10T12:00:00')).toBe('10/09/2026 12:00');
  });

  it('rellena con ceros día, mes, hora y minuto', () => {
    expect(fechaLegible('2026-01-05T09:07:00')).toBe('05/01/2026 09:07');
  });

  it('fecha ilegible → cadena vacía (no "Invalid Date")', () => {
    expect(fechaLegible(null)).toBe('');
    expect(fechaLegible('no-es-fecha')).toBe('');
  });
});

describe('generarCsvBoletas — UTF-8 con BOM, separador ;, CRLF', () => {
  it('arranca con BOM y la primera línea es la cabecera separada por ;', () => {
    const csv = generarCsvBoletas([]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const [cabecera] = csv.slice(1).split('\r\n');
    expect(cabecera).toContain('N° Boleta');
    expect(cabecera).toContain('Peso neto');
    expect(cabecera.split(';')).toHaveLength(10);
  });

  it('una boleta: número sin escapar, pesos con coma decimal y fecha legible', () => {
    const csv = generarCsvBoletas([boleta()]);
    const [, fila] = csv.slice(1).split('\r\n');
    const celdas = fila.split(';');

    expect(celdas[0]).toBe('IF-B01-000001');
    expect(celdas[6]).toBe('17000,00'); // Peso neto
    expect(celdas[8]).toBe('10/09/2026 12:00'); // Fecha ingreso
  });

  it('escapa un motivo de anulación con ; , comillas y salto de línea', () => {
    const sucia = boleta({ estado: 'Anulada', motivoAnulacion: 'peso; alto "revisar"\nx2' });
    const csv = generarCsvBoletas([sucia]);
    const fila = csv.slice(1).split('\r\n')[1];

    // El campo con ; " y \n tiene que venir entrecomillado con las comillas dobladas.
    expect(fila).toContain('"peso; alto ""revisar""');
  });

  it('termina cada registro con CRLF', () => {
    const csv = generarCsvBoletas([boleta()]);
    expect(csv.endsWith('\r\n')).toBe(true);
  });
});

describe('construirNombreArchivoBoletas — nombre con fecha fija', () => {
  it('usa la fecha local en formato aaaa-mm-dd', () => {
    expect(construirNombreArchivoBoletas(new Date(2026, 8, 10))).toBe('boletas-2026-09-10.csv');
    expect(construirNombreArchivoBoletas(new Date(2026, 0, 5))).toBe('boletas-2026-01-05.csv');
  });
});
