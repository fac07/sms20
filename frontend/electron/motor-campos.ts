// Puerto TypeScript del motor de campos configurable
// (backend/Domain/Boletas/Valores/MotorCampos.cs), regla por regla.
//
// Funciones PURAS y SÍNCRONAS: operan sobre arreglos de datos planos, no importan
// better-sqlite3 ni hacen HTTP. `db.ts` hace los SELECT contra el espejo local
// (Seccion / Campo / TipoMovimientoSeccion / BoletaValorCampo) y delega acá. La
// paridad con el motor C# se verifica con vectores compartidos
// (tests/parity/motor-campos/*.json) que corren tanto este puerto
// (motor-campos.spec.ts) como el MotorCampos real
// (tests/SmsBackend.Tests/MotorCamposParityTests.cs): si un puerto se desvía del
// otro, alguno de los dos suites falla.
//
// Comparación temporal: `vigenteDesde` / `vigenteHasta` / `asOf` se comparan como
// strings ISO-8601 en UTC con el mismo formato para todos — bajo ese invariante
// el orden lexical coincide con el cronológico (misma nota que config-sync.ts).

export type TipoCampo =
  | 'Texto'
  | 'Entero'
  | 'Decimal'
  | 'Fecha'
  | 'FechaHora'
  | 'Booleano'
  | 'Lista'
  | 'ReferenciaMaestro'

export type Cardinalidad = 'Unica' | 'Repetible'

export interface SeccionData {
  id: string
  clave: string
  cardinalidad: Cardinalidad
}

/** Una versión de `Campo` con sus mismas fechas de vigencia que el central. */
export interface CampoData {
  id: string
  seccionId: string
  clave: string
  etiqueta: string
  tipoCampo: TipoCampo
  tipoCatalogoRef: string | null
  requerido: boolean
  configuracion: string | null
  vigenteDesde: string
  vigenteHasta: string | null
}

export interface AsignacionData {
  tipoMovimientoId: string
  seccionId: string
  vigenteDesde: string
  vigenteHasta: string | null
  requerida: boolean
}

/** Fila de `Maestro` acotada a lo que valida `ReferenciaMaestro`. */
export interface MaestroData {
  id: string
  tipoCatalogo: string
  activo: boolean
}

/** Un valor capturado, keyed por `campoId` + `ocurrencia`. */
export interface ValorCampo {
  campoId: string
  ocurrencia: number
  valorTexto?: string | null
  valorNumero?: number | null
  valorFecha?: string | null
  valorBooleano?: boolean | null
  valorMaestroId?: string | null
}

/** Fila persistida de `BoletaValorCampo` (agrega el `seccionId` denormalizado). */
export interface FilaValor extends ValorCampo {
  seccionId: string
}

/** Espejo de `CampoAplicable` (C#). */
export interface CampoAplicable {
  campoId: string
  seccionId: string
  seccionClave: string
  campoClave: string
  etiqueta: string
  tipoCampo: TipoCampo
  tipoCatalogoRef: string | null
  requerido: boolean
  cardinalidad: Cardinalidad
  seccionRequerida: boolean
  configuracion: string | null
}

/** Espejo de `ErrorCampo` (C#). */
export interface ErrorCampo {
  seccionClave: string
  campoClave: string
  ocurrencia: number
  mensaje: string
}

/** `campoClave` reservada para los errores a nivel de sección (reglas 1 y 3 del cierre). */
const CLAVE_SECCION = '(seccion)'

/** `!= null` en C#: descarta `null` y `undefined` a la vez. */
function definido<T>(valor: T | null | undefined): valor is T {
  return valor !== null && valor !== undefined
}

// --- resolverCampos ---------------------------------------------------------

function vigenteEn(vigenteDesde: string, vigenteHasta: string | null, asOf: string): boolean {
  return vigenteDesde <= asOf && (vigenteHasta === null || vigenteHasta > asOf)
}

/**
 * Campos vigentes para `(tipoMovimientoId, asOf)`: asignaciones abiertas en `asOf`
 * ⋈ `Campo` con `vigenteDesde <= asOf AND (vigenteHasta IS NULL OR vigenteHasta >
 * asOf)`. Transliteración de `MotorCampos.ResolverCamposAsync`.
 */
export function resolverCampos(
  tipoMovimientoId: string,
  asOf: string,
  secciones: readonly SeccionData[],
  campos: readonly CampoData[],
  asignaciones: readonly AsignacionData[],
): CampoAplicable[] {
  const seccionPorId = new Map(secciones.map((s) => [s.id, s]))
  const resultado: CampoAplicable[] = []

  for (const tms of asignaciones) {
    if (tms.tipoMovimientoId !== tipoMovimientoId) continue
    if (!vigenteEn(tms.vigenteDesde, tms.vigenteHasta, asOf)) continue

    const seccion = seccionPorId.get(tms.seccionId)
    if (seccion === undefined) continue

    for (const campo of campos) {
      if (campo.seccionId !== seccion.id) continue
      if (!vigenteEn(campo.vigenteDesde, campo.vigenteHasta, asOf)) continue

      resultado.push({
        campoId: campo.id,
        seccionId: seccion.id,
        seccionClave: seccion.clave,
        campoClave: campo.clave,
        etiqueta: campo.etiqueta,
        tipoCampo: campo.tipoCampo,
        tipoCatalogoRef: campo.tipoCatalogoRef,
        requerido: campo.requerido,
        cardinalidad: seccion.cardinalidad,
        seccionRequerida: tms.requerida,
        configuracion: campo.configuracion,
      })
    }
  }

  return resultado
}

// --- validarValores --------------------------------------------------------

interface ConfiguracionCampo {
  maxLength?: number
  regex?: string
  min?: number
  max?: number
  decimales?: number
  opciones?: string[]
}

type ParseConfig = { ok: true; cfg: ConfiguracionCampo | null } | { ok: false }

/**
 * Espejo de `ConfiguracionCampo.TryParse`: nulo/vacío → `null`, JSON malformado →
 * `{ ok: false }`. Claves sin distinguir mayúsculas (como
 * `PropertyNameCaseInsensitive` en C#).
 */
function parsearConfiguracion(raw: string | null): ParseConfig {
  if (raw === null || raw.trim() === '') return { ok: true, cfg: null }

  try {
    const crudo = JSON.parse(raw) as Record<string, unknown>
    const norm: Record<string, unknown> = {}
    for (const clave of Object.keys(crudo)) norm[clave.toLowerCase()] = crudo[clave]

    return {
      ok: true,
      cfg: {
        maxLength: norm['maxlength'] as number | undefined,
        regex: norm['regex'] as string | undefined,
        min: norm['min'] as number | undefined,
        max: norm['max'] as number | undefined,
        decimales: norm['decimales'] as number | undefined,
        opciones: norm['opciones'] as string[] | undefined,
      },
    }
  } catch {
    return { ok: false }
  }
}

type ColumnaValor = 'Texto' | 'Numero' | 'Fecha' | 'Booleano' | 'Maestro'

function contarColumnas(v: ValorCampo): { count: number; unica: ColumnaValor | null } {
  const puestas: ColumnaValor[] = []
  if (definido(v.valorTexto)) puestas.push('Texto')
  if (definido(v.valorNumero)) puestas.push('Numero')
  if (definido(v.valorFecha)) puestas.push('Fecha')
  if (definido(v.valorBooleano)) puestas.push('Booleano')
  if (definido(v.valorMaestroId)) puestas.push('Maestro')
  return { count: puestas.length, unica: puestas.length === 1 ? puestas[0] : null }
}

function columnaEsperada(tipo: TipoCampo): ColumnaValor {
  switch (tipo) {
    case 'Texto':
    case 'Lista':
      return 'Texto'
    case 'Entero':
    case 'Decimal':
      return 'Numero'
    case 'Fecha':
    case 'FechaHora':
      return 'Fecha'
    case 'Booleano':
      return 'Booleano'
    case 'ReferenciaMaestro':
      return 'Maestro'
    default:
      return 'Texto'
  }
}

function cumpleRegex(valor: string, patron: string): boolean {
  try {
    return new RegExp(patron).test(valor)
  } catch {
    return false
  }
}

/** Cantidad de decimales de un número — espejo de `MotorCampos.Escala`. */
function escala(valor: number): number {
  const texto = Math.abs(valor).toString()
  if (texto.includes('e') || texto.includes('E')) return 0
  const punto = texto.indexOf('.')
  return punto < 0 ? 0 : texto.length - punto - 1
}

function rangoNumerico(
  c: ConfiguracionCampo,
  valor: number,
  err: (mensaje: string) => ErrorCampo,
): ErrorCampo[] {
  const errores: ErrorCampo[] = []
  if (definido(c.min) && valor < c.min) errores.push(err(`Debe ser mayor o igual a ${c.min}.`))
  if (definido(c.max) && valor > c.max) errores.push(err(`Debe ser menor o igual a ${c.max}.`))
  return errores
}

function validarValor(
  campo: CampoAplicable,
  v: ValorCampo,
  maestros: ReadonlyMap<string, MaestroData>,
): ErrorCampo[] {
  const err = (mensaje: string): ErrorCampo => ({
    seccionClave: campo.seccionClave,
    campoClave: campo.campoClave,
    ocurrencia: v.ocurrencia,
    mensaje,
  })

  const { count, unica } = contarColumnas(v)
  if (count !== 1) return [err('Se esperaba exactamente un valor tipado en la entrada.')]

  const esperada = columnaEsperada(campo.tipoCampo)
  if (unica !== esperada) {
    return [err(`El tipo de campo ${campo.tipoCampo} espera un valor en la columna ${esperada}.`)]
  }

  const parsed = parsearConfiguracion(campo.configuracion)
  if (!parsed.ok) return [err('La configuración del campo tiene JSON malformado.')]

  const c: ConfiguracionCampo = parsed.cfg ?? {}
  const errores: ErrorCampo[] = []

  switch (campo.tipoCampo) {
    case 'Texto': {
      const texto = v.valorTexto as string
      if (definido(c.maxLength) && texto.length > c.maxLength) {
        errores.push(err(`Excede el largo máximo de ${c.maxLength} caracteres.`))
      }
      if (definido(c.regex) && c.regex.length > 0 && !cumpleRegex(texto, c.regex)) {
        errores.push(err('No cumple el patrón (regex) configurado.'))
      }
      break
    }

    case 'Lista': {
      if (!definido(c.opciones) || c.opciones.length === 0) {
        errores.push(err('El campo Lista no tiene opciones configuradas.'))
      } else if (!c.opciones.includes(v.valorTexto as string)) {
        errores.push(err(`'${v.valorTexto}' no es una de las opciones configuradas.`))
      }
      break
    }

    case 'Entero': {
      const numero = v.valorNumero as number
      if (numero !== Math.trunc(numero)) errores.push(err('Se esperaba un entero, sin parte decimal.'))
      errores.push(...rangoNumerico(c, numero, err))
      break
    }

    case 'Decimal': {
      const numero = v.valorNumero as number
      if (definido(c.decimales) && escala(numero) > c.decimales) {
        errores.push(err(`Excede los ${c.decimales} decimales configurados.`))
      }
      errores.push(...rangoNumerico(c, numero, err))
      break
    }

    case 'Fecha':
    case 'FechaHora':
    case 'Booleano':
      break

    case 'ReferenciaMaestro': {
      const maestroId = v.valorMaestroId as string
      const maestro = maestros.get(maestroId)
      if (maestro === undefined) {
        errores.push(err(`El maestro ${maestroId} no existe.`))
      } else if (!maestro.activo) {
        errores.push(err('El maestro referenciado está inactivo.'))
      } else if (campo.tipoCatalogoRef !== null && maestro.tipoCatalogo !== campo.tipoCatalogoRef) {
        errores.push(err(`El maestro es de tipo ${maestro.tipoCatalogo}; se esperaba ${campo.tipoCatalogoRef}.`))
      }
      break
    }

    default:
      break
  }

  return errores
}

function indexarMaestros(maestros: readonly MaestroData[]): Map<string, MaestroData> {
  return new Map(maestros.map((m) => [m.id, m]))
}

function validarValoresContra(
  aplicables: readonly CampoAplicable[],
  valores: readonly ValorCampo[],
  maestros: ReadonlyMap<string, MaestroData>,
): ErrorCampo[] {
  const porId = new Map(aplicables.map((c) => [c.campoId, c]))
  const errores: ErrorCampo[] = []

  for (const v of valores) {
    const campo = porId.get(v.campoId)
    if (campo === undefined) {
      errores.push({
        seccionClave: '(desconocida)',
        campoClave: '(desconocido)',
        ocurrencia: v.ocurrencia,
        mensaje: `El campo ${v.campoId} no pertenece al conjunto de campos vigente al crear la boleta.`,
      })
      continue
    }
    errores.push(...validarValor(campo, v, maestros))
  }

  return errores
}

/**
 * Valida valores capturados contra el conjunto de campos ya resuelto para el
 * instante de creación — parte de `MotorCampos.ValidarValoresAsync` que corre
 * después de resolver.
 */
export function validarValores(
  aplicables: readonly CampoAplicable[],
  valores: readonly ValorCampo[],
  maestros: readonly MaestroData[] = [],
): ErrorCampo[] {
  return validarValoresContra(aplicables, valores, indexarMaestros(maestros))
}

// --- validarCierre ---------------------------------------------------------

function agruparPorSeccion(aplicables: readonly CampoAplicable[]): Map<string, CampoAplicable[]> {
  const grupos = new Map<string, CampoAplicable[]>()
  for (const campo of aplicables) {
    const lista = grupos.get(campo.seccionId)
    if (lista === undefined) grupos.set(campo.seccionId, [campo])
    else lista.push(campo)
  }
  return grupos
}

function tieneValor(v: ValorCampo): boolean {
  return (
    definido(v.valorTexto) ||
    definido(v.valorNumero) ||
    definido(v.valorFecha) ||
    definido(v.valorBooleano) ||
    definido(v.valorMaestroId)
  )
}

/**
 * Validación de cierre (bloqueo duro, sin `forzar`) contra el conjunto resuelto a
 * `asOf = boleta.fechaHoraIngreso`. Transliteración de
 * `MotorCampos.ValidarCierreAsync`:
 *   1. toda sección requerida tiene >= 1 ocurrencia;
 *   2. dentro de cada ocurrencia existente, todo campo requerido tiene valor;
 *   3. cardinalidad Única -> solo la ocurrencia 0;
 *   4. toda columna capturada respeta su tipo y su configuración.
 */
export function validarCierre(
  aplicables: readonly CampoAplicable[],
  filas: readonly FilaValor[],
  maestros: readonly MaestroData[] = [],
): ErrorCampo[] {
  const errores: ErrorCampo[] = []

  // Regla 4: toda columna capturada respeta su TipoCampo + Configuracion.
  errores.push(...validarValoresContra(aplicables, filas, indexarMaestros(maestros)))

  const valorPorCampoOcc = new Map<string, FilaValor>()
  for (const fila of filas) valorPorCampoOcc.set(`${fila.campoId}|${fila.ocurrencia}`, fila)

  const ocurrenciasPorSeccion = new Map<string, number[]>()
  for (const fila of filas) {
    const lista = ocurrenciasPorSeccion.get(fila.seccionId) ?? []
    if (!lista.includes(fila.ocurrencia)) lista.push(fila.ocurrencia)
    ocurrenciasPorSeccion.set(fila.seccionId, lista)
  }
  for (const lista of ocurrenciasPorSeccion.values()) lista.sort((a, b) => a - b)

  for (const [seccionId, campos] of agruparPorSeccion(aplicables)) {
    const muestra = campos[0]
    const ocurrencias = ocurrenciasPorSeccion.get(seccionId) ?? []

    // Regla 1: sección requerida necesita al menos una ocurrencia.
    if (muestra.seccionRequerida && ocurrencias.length === 0) {
      errores.push({
        seccionClave: muestra.seccionClave,
        campoClave: CLAVE_SECCION,
        ocurrencia: 0,
        mensaje: 'La sección es requerida y no tiene ninguna ocurrencia capturada.',
      })
      continue
    }

    // Regla 3: Cardinalidad.Unica -> solo la ocurrencia 0.
    if (muestra.cardinalidad === 'Unica') {
      for (const o of ocurrencias) {
        if (o === 0) continue
        errores.push({
          seccionClave: muestra.seccionClave,
          campoClave: CLAVE_SECCION,
          ocurrencia: o,
          mensaje: 'La sección es de cardinalidad Única; solo admite la ocurrencia 0.',
        })
      }
    }

    // Regla 2: dentro de cada ocurrencia existente, todo campo requerido tiene valor.
    for (const o of ocurrencias) {
      for (const campo of campos) {
        if (!campo.requerido) continue
        const fila = valorPorCampoOcc.get(`${campo.campoId}|${o}`)
        if (fila === undefined || !tieneValor(fila)) {
          errores.push({
            seccionClave: campo.seccionClave,
            campoClave: campo.campoClave,
            ocurrencia: o,
            mensaje: 'Campo requerido sin valor.',
          })
        }
      }
    }
  }

  return errores
}
