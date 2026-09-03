import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  resolverCampos,
  validarCierre,
  validarValores,
  type AsignacionData,
  type CampoAplicable,
  type CampoData,
  type ErrorCampo,
  type FilaValor,
  type MaestroData,
  type SeccionData,
  type ValorCampo,
} from './motor-campos'

// Los vectores viven en la raíz del repo (tests/parity/motor-campos), no bajo
// frontend/: los consumen TANTO este spec como MotorCamposParityTests.cs contra
// el MotorCampos real de C#. Cualquier divergencia entre los dos puertos rompe
// alguno de los dos suites.
const aqui = dirname(fileURLToPath(import.meta.url))
const DIR_VECTORES = resolve(aqui, '../../tests/parity/motor-campos')

interface EntradaVector {
  tipoMovimientoId?: string
  asOf?: string
  secciones?: SeccionData[]
  campos?: CampoData[]
  asignaciones?: AsignacionData[]
  maestros?: MaestroData[]
  valores?: ValorCampo[]
  filas?: FilaValor[]
  boleta?: { id: string; tipoMovimientoId: string; fechaHoraIngreso: string }
}

interface AplicableEsperado {
  campoId: string
  seccionClave: string
  campoClave: string
  seccionRequerida: boolean
  cardinalidad: string
}

interface ErrorEsperado {
  seccionClave: string
  campoClave: string
  ocurrencia: number
}

interface Vector {
  nombre: string
  fn: 'resolverCampos' | 'validarValores' | 'validarCierre'
  entrada: EntradaVector
  esperado: { aplicables?: AplicableEsperado[]; errores?: ErrorEsperado[] }
}

const vectores: Vector[] = readdirSync(DIR_VECTORES)
  .filter((archivo) => archivo.endsWith('.json'))
  .sort()
  .map((archivo) => JSON.parse(readFileSync(join(DIR_VECTORES, archivo), 'utf-8')) as Vector)

function resolverDeEntrada(entrada: EntradaVector): CampoAplicable[] {
  return resolverCampos(
    entrada.tipoMovimientoId ?? '',
    entrada.asOf ?? '',
    entrada.secciones ?? [],
    entrada.campos ?? [],
    entrada.asignaciones ?? [],
  )
}

const claveError = (e: ErrorCampo | ErrorEsperado): string =>
  `${e.seccionClave}|${e.campoClave}|${e.ocurrencia}`

describe('paridad motor-campos (vectores compartidos con MotorCampos.cs)', () => {
  it('cubre las tres funciones con al menos 17 vectores', () => {
    expect(vectores.length).toBeGreaterThanOrEqual(17)
    expect(new Set(vectores.map((v) => v.fn))).toEqual(
      new Set(['resolverCampos', 'validarValores', 'validarCierre']),
    )
  })

  for (const vector of vectores) {
    it(`${vector.fn}: ${vector.nombre}`, () => {
      if (vector.fn === 'resolverCampos') {
        const actual = resolverDeEntrada(vector.entrada)
          .map((c) => ({
            campoId: c.campoId,
            seccionClave: c.seccionClave,
            campoClave: c.campoClave,
            seccionRequerida: c.seccionRequerida,
            cardinalidad: c.cardinalidad as string,
          }))
          .sort((a, b) => a.campoId.localeCompare(b.campoId))

        const esperado = [...(vector.esperado.aplicables ?? [])].sort((a, b) =>
          a.campoId.localeCompare(b.campoId),
        )

        expect(actual).toEqual(esperado)
        return
      }

      let errores: ErrorCampo[]
      if (vector.fn === 'validarValores') {
        errores = validarValores(
          resolverDeEntrada(vector.entrada),
          vector.entrada.valores ?? [],
          vector.entrada.maestros ?? [],
        )
      } else {
        errores = validarCierre(
          resolverDeEntrada(vector.entrada),
          vector.entrada.filas ?? [],
          vector.entrada.maestros ?? [],
        )
      }

      expect(errores.map(claveError).sort()).toEqual(
        (vector.esperado.errores ?? []).map(claveError).sort(),
      )
    })
  }
})
