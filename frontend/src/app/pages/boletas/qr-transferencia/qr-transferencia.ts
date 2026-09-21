import { InjectionToken } from '@angular/core';

/**
 * Codec del QR de transferencia. Formato (texto que viaja en el QR):
 *
 *   SMS1.<base64url(deflate-raw(JSON utf-8))>.<base64url(HMAC-SHA256[0..8]) | "-">
 *
 * - base64url (A-Z a-z 0-9 - _): los scanners 2D que emulan teclado corrompen
 *   `+` y `/`.
 * - La firma cubre los bytes comprimidos. Sin clave se emite `-` y el decoder
 *   reporta `firma: 'ausente'`.
 * - Sin compatibilidad con el QR legado (NAT_Basculas: Deflate+Base64 de un
 *   string delimitado, sin cifrado ni firma): no se decodifica.
 *
 * Claves cortas del JSON (`PayloadQr`):
 *
 * | clave | contenido                                                          |
 * |-------|--------------------------------------------------------------------|
 * | v     | versión del payload (1)                                            |
 * | b     | boletaId (en el receptor pasa a ser BoletaOrigenId)                |
 * | n     | numeroBoleta                                                       |
 * | ce    | código del centro de origen (null si no se conoce)                 |
 * | ba    | código de la báscula de origen                                     |
 * | tm    | tipoMovimientoId de origen                                         |
 * | tn    | nombre del tipo de movimiento de origen                            |
 * | fi/fs | fechaHoraIngreso / fechaHoraSalida (ISO UTC; fs null sin salida)   |
 * | pi/ps/pn | pesoIngreso / pesoSalida / pesoNeto (kg; ps y pn null sin salida) |
 * | d     | d365Id — null: D365 es async y puede no existir al imprimir        |
 * | s     | valores por clave de sección -> filas (una por ocurrencia) ->      |
 * |       | clave de campo -> valor. NUNCA por CampoId: la config es versionada|
 * |       | y el tipo receptor tiene otro set de campos (mapea solo lo común). |
 * | parcial  | true si se descartaron secciones opcionales por capacidad       |
 * | omitidas | claves de las secciones descartadas (solo junto con parcial)   |
 */

export const MAX_CARACTERES_QR = 2200;
// Tope de lo que el decoder acepta como texto (holgura sobre el máximo emitido).
const MAX_ENTRADA = 4000;
// Tope del JSON descomprimido: corta bombas de descompresión.
const MAX_JSON_BYTES = 64 * 1024;
const PREFIJO = 'SMS1.';
const FIRMA_BYTES = 8;
const SIN_FIRMA = '-';

/** Snapshot autodescriptivo de un maestro: nunca un GUID pelado (puede ser provisional). */
export interface MaestroQr {
  id: string;
  codigo: string;
  nombre: string;
  tipoCatalogo: string;
  provisional: boolean;
}

export type ValorQr = string | number | boolean | MaestroQr;
export type FilaQr = Record<string, ValorQr>;

export interface PayloadQr {
  v: 1;
  b: string;
  n: string;
  ce: string | null;
  ba: string | null;
  tm: string;
  tn: string | null;
  fi: string;
  fs: string | null;
  pi: number;
  ps: number | null;
  pn: number | null;
  d: string | null;
  s: Record<string, FilaQr[]>;
  parcial?: true;
  omitidas?: string[];
}

export type MotivoErrorQr =
  | 'demasiado-grande'
  | 'prefijo-invalido'
  | 'version-no-soportada'
  | 'formato-invalido'
  | 'deflate-invalido'
  | 'json-invalido'
  | 'payload-invalido';

export type ResultadoCodificacion =
  | { ok: true; texto: string; payload: PayloadQr }
  | { ok: false; motivo: 'demasiado-grande' };

export type FirmaQr = 'valida' | 'invalida' | 'ausente';

export type ResultadoDecodificacion =
  | { ok: true; payload: PayloadQr; firma: FirmaQr; parcial: boolean }
  | { ok: false; motivo: MotivoErrorQr };

/**
 * Provee la clave HMAC. El default es null (QR sin firma); app.config lo cablea
 * a `QrClaveService` (clave entregada en el aprovisionamiento).
 */
export type QrClaveProvider = () => string | null;
export const QR_CLAVE_PROVIDER = new InjectionToken<QrClaveProvider>('QR_CLAVE_PROVIDER', {
  providedIn: 'root',
  factory: () => () => null,
});

// Orden de descarte cuando el texto excede MAX_CARACTERES_QR. Transporte y
// marchamos (y los pesos, que son top-level) nunca se descartan.
const SECCIONES_PROTEGIDAS = ['transporte', 'marchamos'];
const PASOS_DESCARTE: readonly (readonly string[] | null)[] = [['calidad'], ['caracteristicas'], null];

export async function codificarQrTransferencia(
  payload: PayloadQr,
  clave?: string | null,
): Promise<ResultadoCodificacion> {
  let actual = payload;
  const omitidas: string[] = [];
  for (let paso = -1; paso < PASOS_DESCARTE.length; paso++) {
    if (paso >= 0) {
      const objetivo = PASOS_DESCARTE[paso];
      const descartar = Object.keys(actual.s).filter((k) =>
        objetivo ? objetivo.includes(k) : !SECCIONES_PROTEGIDAS.includes(k),
      );
      if (descartar.length === 0) continue;
      omitidas.push(...descartar);
      actual = {
        ...actual,
        s: Object.fromEntries(Object.entries(actual.s).filter(([k]) => !descartar.includes(k))),
        parcial: true,
        omitidas: [...omitidas],
      };
    }
    const texto = await armarTexto(actual, clave ?? null);
    if (texto.length <= MAX_CARACTERES_QR) return { ok: true, texto, payload: actual };
  }
  return { ok: false, motivo: 'demasiado-grande' };
}

export async function decodificarQrTransferencia(
  entrada: string,
  clave?: string | null,
): Promise<ResultadoDecodificacion> {
  const texto = entrada.trim(); // el scanner "teclado" agrega Enter
  if (texto.length > MAX_ENTRADA) return { ok: false, motivo: 'demasiado-grande' };

  const version = /^SMS(\d+)\./.exec(texto);
  if (!version) return { ok: false, motivo: 'prefijo-invalido' };
  if (`SMS${version[1]}.` !== PREFIJO) return { ok: false, motivo: 'version-no-soportada' };

  const partes = texto.slice(PREFIJO.length).split('.');
  if (partes.length !== 2) return { ok: false, motivo: 'formato-invalido' };
  const [cuerpo, firma] = partes;
  if (!BASE64URL.test(cuerpo) || !(firma === SIN_FIRMA || BASE64URL.test(firma))) {
    return { ok: false, motivo: 'formato-invalido' };
  }

  let comprimido: Uint8Array<ArrayBuffer>;
  try {
    comprimido = desdeBase64Url(cuerpo);
  } catch {
    return { ok: false, motivo: 'formato-invalido' };
  }

  let json: Uint8Array<ArrayBuffer>;
  try {
    json = await transformar(comprimido, new DecompressionStream('deflate-raw'), MAX_JSON_BYTES);
  } catch (e) {
    return { ok: false, motivo: e instanceof ExcedeTamano ? 'demasiado-grande' : 'deflate-invalido' };
  }

  let parseado: unknown;
  try {
    parseado = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json));
  } catch {
    return { ok: false, motivo: 'json-invalido' };
  }
  if (!esPayloadQr(parseado)) return { ok: false, motivo: 'payload-invalido' };

  let estadoFirma: FirmaQr = 'ausente';
  if (clave && firma !== SIN_FIRMA) {
    estadoFirma = (await firmar(comprimido, clave)) === firma ? 'valida' : 'invalida';
  }
  return { ok: true, payload: parseado, firma: estadoFirma, parcial: parseado.parcial === true };
}

// --- Internos ---------------------------------------------------------------

const BASE64URL = /^[A-Za-z0-9_-]+$/;

class ExcedeTamano extends Error {}

async function armarTexto(payload: PayloadQr, clave: string | null): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(payload));
  const comprimido = await transformar(json, new CompressionStream('deflate-raw'), Number.MAX_SAFE_INTEGER);
  const firma = clave ? await firmar(comprimido, clave) : SIN_FIRMA;
  return `${PREFIJO}${aBase64Url(comprimido)}.${firma}`;
}

function esPayloadQr(valor: unknown): valor is PayloadQr {
  if (typeof valor !== 'object' || valor === null) return false;
  const p = valor as Record<string, unknown>;
  return (
    p['v'] === 1 &&
    typeof p['b'] === 'string' &&
    typeof p['n'] === 'string' &&
    typeof p['s'] === 'object' &&
    p['s'] !== null &&
    !Array.isArray(p['s'])
  );
}

async function firmar(datos: Uint8Array<ArrayBuffer>, clave: string): Promise<string> {
  const llave = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(clave),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', llave, datos));
  return aBase64Url(mac.slice(0, FIRMA_BYTES));
}

async function transformar(
  datos: Uint8Array<ArrayBuffer>,
  flujo: CompressionStream | DecompressionStream,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const escritor = flujo.writable.getWriter();
  // Un error de escritura (deflate corrupto) llega también por el lado de lectura.
  escritor.write(datos).catch(() => undefined);
  escritor.close().catch(() => undefined);

  const lector = flujo.readable.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      void lector.cancel();
      throw new ExcedeTamano();
    }
    partes.push(value);
  }
  const salida = new Uint8Array(total);
  let posicion = 0;
  for (const parte of partes) {
    salida.set(parte, posicion);
    posicion += parte.length;
  }
  return salida;
}

function aBase64Url(bytes: Uint8Array): string {
  let binario = '';
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function desdeBase64Url(texto: string): Uint8Array<ArrayBuffer> {
  const binario = atob(texto.replaceAll('-', '+').replaceAll('_', '/')); // lanza si la longitud es imposible
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}
