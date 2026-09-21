import { BoletaDto } from '../../../api/boletas.service';

/**
 * Exportación del listado de boletas a CSV: UTF-8 con BOM (Excel en Windows
 * solo detecta acentos con él), separador `;` (la coma es decimal en el
 * Excel hispano) y saltos CRLF. Todo puro — la única parte con DOM vive en
 * `DescargaService`. Sin dependencias nuevas.
 */

const SEPARADOR = ';';
const SALTO = '\r\n';
const BOM_UTF8 = '\uFEFF';

interface Columna {
  cabecera: string;
  valor: (boleta: BoletaDto) => string | null;
}

/** Campo → CSV: lo entrecomilla si trae separador, comillas o saltos. */
export function escaparCampo(bruto: string | number | null | undefined): string {
  if (bruto === null || bruto === undefined) return '';
  const s = String(bruto);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Número → '17000,00' (coma decimal fija, dos decimales). No medible → ''. */
export function numeroConComaDecimal(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return '';
  return valor.toFixed(2).replace('.', ',');
}

/** ISO → `dd/mm/aaaa hh:mm`. Ilegible → '' (nunca "Invalid Date" en un Excel). */
export function fechaLegible(iso: string | null | undefined): string {
  if (!iso) return '';
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${p(fecha.getDate())}/${p(fecha.getMonth() + 1)}/${fecha.getFullYear()}` +
    ` ${p(fecha.getHours())}:${p(fecha.getMinutes())}`
  );
}

const ETIQUETA_ESTADO: Record<string, string> = {
  EnTransito: 'En tránsito',
  Cerrada: 'Cerrada',
  Anulada: 'Anulada',
  Reemitida: 'Reemitida',
};

/** Origen "Manual" si CUALQUIER pesaje fue manual — mismo criterio que la tabla. */
function origenPeso(b: BoletaDto): string {
  return b.origenPesoIngreso === 'Manual' || b.origenPesoSalida === 'Manual'
    ? 'Manual'
    : 'Báscula';
}

const COLUMNAS: Columna[] = [
  { cabecera: 'N° Boleta', valor: (b) => b.numeroBoleta },
  { cabecera: 'Báscula', valor: (b) => b.basculaCodigo },
  { cabecera: 'Tipo movimiento', valor: (b) => b.tipoMovimientoNombre },
  { cabecera: 'Origen peso', valor: origenPeso },
  { cabecera: 'Peso ingreso', valor: (b) => numeroConComaDecimal(b.pesoIngreso) },
  { cabecera: 'Peso salida', valor: (b) => numeroConComaDecimal(b.pesoSalida) },
  { cabecera: 'Peso neto', valor: (b) => numeroConComaDecimal(b.pesoNeto) },
  { cabecera: 'Estado', valor: (b) => ETIQUETA_ESTADO[b.estado] ?? b.estado },
  { cabecera: 'Fecha ingreso', valor: (b) => fechaLegible(b.fechaHoraIngreso) },
  { cabecera: 'Motivo anulación', valor: (b) => b.motivoAnulacion },
];

/**
 * CSV completo (BOM + cabecera + filas) del listado YA filtrado: el que
 * llama le pasa exactamente lo que la tabla está mostrando.
 */
export function generarCsvBoletas(boletas: readonly BoletaDto[]): string {
  const lineas = [
    COLUMNAS.map((c) => escaparCampo(c.cabecera)).join(SEPARADOR),
    ...boletas.map((b) => COLUMNAS.map((c) => escaparCampo(c.valor(b))).join(SEPARADOR)),
  ];
  return BOM_UTF8 + lineas.join(SALTO) + SALTO;
}

/** `boletas-aaaa-mm-dd.csv` con la fecha local del momento del click. */
export function construirNombreArchivoBoletas(ahora: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `boletas-${ahora.getFullYear()}-${p(ahora.getMonth() + 1)}-${p(ahora.getDate())}.csv`;
}
