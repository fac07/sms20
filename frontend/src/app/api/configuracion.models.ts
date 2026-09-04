import type { TipoCatalogo } from './maestros.service';

// Tipos de valor compartidos por boletas.service.ts, campos.service.ts,
// tipos-movimiento.service.ts y el futuro renderer del motor configurable
// (slice C). Una sola fuente: los demás services co-locan sus propias
// interfaces, estas se comparten porque cruzan varios contratos.

// String-literal unions que reflejan los enums del backend
// (HasConversion<string>()). No confundir con los enums numéricos de C#:
// el backend los serializa como el nombre del miembro.

export type TipoCampo =
  | 'Texto'
  | 'Entero'
  | 'Decimal'
  | 'Fecha'
  | 'FechaHora'
  | 'Booleano'
  | 'Lista'
  | 'ReferenciaMaestro';

export type Cardinalidad = 'Unica' | 'Repetible';

export type OperacionD365 =
  | 'IngresoFruta'
  | 'TransferenciaCreacion'
  | 'TransferenciaRecepcion'
  | 'RecepcionOC'
  | 'SalidaOV';

export type DireccionMovimiento = 'Entrada' | 'Salida' | 'Transferencia';

/**
 * Tipo de movimiento — espejo del `TipoMovimientoDto` central
 * (backend/Domain/TiposMovimiento/TipoMovimientoDtos.cs). Vive acá y no en
 * `tipos-movimiento.service.ts` porque ahora lo consumen dos rutas: la página
 * de admin (central, vía `TiposMovimientoService`) y el dropdown de Pesaje
 * (espejo local, vía `LocalServerService`). `tipos-movimiento.service.ts` lo
 * re-exporta para no romper a sus importadores.
 */
export interface TipoMovimiento {
  id: string;
  codigo: string;
  nombre: string;
  prefijo: string;
  direccion: DireccionMovimiento;
  // Reemplaza a los 6 flags habilita* + integracionD365 del contrato legacy:
  // el motor configurable resuelve qué secciones aplican, y operacionD365
  // (nullable) reemplaza al bool integracionD365.
  operacionD365: OperacionD365 | null;
  generaQR: boolean;
  formatoBoletaId: string | null;
  activo: boolean;
}

// El backend acota Campo.TipoCatalogoRef con el mismo enum TipoCatalogo de
// Maestros (backend Campo.TipoCatalogoRef es TipoCatalogo?). Se reusa el union
// ya definido en maestros.service.ts en vez de duplicarlo.
export type TipoCatalogoRef = TipoCatalogo;

/**
 * Valor capturado que se ESCRIBE (POST /api/boletas, rama "Crear" de
 * /api/boletas/sync). Keyed por campoId + ocurrencia, nunca por clave: el
 * versionado reutiliza la clave, así que resolver por clave rompería el
 * candado as-of-creation. Espejo de backend ValorCampoDto.
 */
export interface ValorCampoDto {
  campoId: string;
  ocurrencia: number;
  valorTexto?: string | null;
  valorNumero?: number | null;
  valorFecha?: string | null;
  valorBooleano?: boolean | null;
  valorMaestroId?: string | null;
}

/**
 * Proyección de LECTURA para BoletaDto.valores. Agrega claves, el nombre legible
 * de la sección y la etiqueta del campo además del campoId estable. Espejo de
 * backend ValorCampoLeidoDto.
 */
export interface ValorCampoLeidoDto {
  campoId: string;
  seccionClave: string;
  seccionNombre: string;
  campoClave: string;
  etiqueta: string;
  tipoCampo: TipoCampo;
  ocurrencia: number;
  valorTexto?: string | null;
  valorNumero?: number | null;
  valorFecha?: string | null;
  valorBooleano?: boolean | null;
  valorMaestroId?: string | null;
  valorMaestroCodigo?: string | null;
  valorMaestroNombre?: string | null;
}

/**
 * Un campo que aplica a una boleta, resuelto como función pura de
 * (tipoMovimientoId, asOf). Espejo de backend CampoAplicable
 * (Domain/Boletas/Valores/MotorCamposResultados.cs).
 */
export interface CampoAplicable {
  campoId: string;
  seccionId: string;
  seccionClave: string;
  campoClave: string;
  etiqueta: string;
  tipoCampo: TipoCampo;
  tipoCatalogoRef: TipoCatalogoRef | null;
  requerido: boolean;
  cardinalidad: Cardinalidad;
  seccionRequerida: boolean;
  configuracion: string | null;
  // Proyecciones de Campo.Orden / Seccion.Orden / Seccion.Nombre para que el
  // renderer ordene campos y secciones de forma determinista y muestre un
  // encabezado de sección legible (cae a la clave titulizada si viene vacío).
  orden: number;
  seccionOrden: number;
  seccionEtiqueta: string;
}

/** Error de validación por campo/ocurrencia. Espejo de backend ErrorCampo. */
export interface ErrorCampo {
  seccionClave: string;
  campoClave: string;
  ocurrencia: number;
  mensaje: string;
}

/**
 * Claves de campo reservadas por sección estándar. HARDCODEADO — el backend no
 * expone un endpoint para SeccionEstandar. Debe seguir a
 * `backend/Domain/Configuracion/SeccionEstandar.cs` (seed estable). El guardia
 * real es el 409 GuardiaEstandar del servidor; esto solo pre-deshabilita
 * controles en la UI de Campos.
 */
export const RESERVED_CLAVES: Record<string, string[]> = {
  transporte: ['transportista', 'piloto', 'equipo', 'placa', 'licencia'],
  producto: ['articulo_ax', 'cantidad', 'tercero'],
  ubicacion: [
    'almacen_origen',
    'almacen_destino',
    'sitio_origen',
    'sitio_destino',
    'bodega_externa',
  ],
  calidad: ['acidez', 'luz', 'temperatura', 'dobi', 'humedad', 'revision_qa'],
  detalle_fruta: [
    'finca',
    'lote',
    'numero_envio',
    'caporal',
    'racimos_verdes',
    'racimos_maduros',
    'racimos_sobremaduros',
    'racimos_pasados',
    'racimos_pedunculo_largo',
    'sacos',
    'libras',
    'jornales',
    'hectareas',
    'fecha_corte',
  ],
  marchamos: ['numero', 'placa', 'equipo', 'activo', 'observaciones'],
  caracteristicas: ['clave', 'valor', 'tipo_dato'],
  compostera: ['cui', 'cama', 'seccion', 'ciclo', 'numero_viaje'],
};
