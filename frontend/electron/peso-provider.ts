export type OrigenPeso = 'Bascula' | 'Manual'

export interface LecturaPeso {
  peso: number | null
  origen: OrigenPeso | null
}

/**
 * Punto único de entrada para "qué está pesando la báscula ahora mismo".
 * No persiste en SQLite ni conoce nada del dominio Boleta — solo expone la
 * lectura actual para que quien la consuma (el flujo de pesaje, el panel de
 * simulación) no necesite saber si detrás hay hardware real o un valor de
 * desarrollo.
 */
export interface PesoProvider {
  obtenerPesoActual(): LecturaPeso
}

/**
 * Lector real de báscula. TODAVÍA NO IMPLEMENTADO — este repo no tiene
 * ningún driver serial/TCP todavía. `obtenerPesoActual()` devuelve siempre
 * una lectura vacía hasta que exista esa implementación.
 *
 * Cuando se implemente el listener serial/TCP real, este es el lugar: hay
 * que revisar el protocolo documentado en el código legado —
 * `clsConexionBasculaSERIAL_COM.cs` (la variante serial con tramas STX que
 * corre en producción hoy) y `clsConexionBasculaMT_Continuo.cs` (la variante
 * de transmisión continua MT) — antes de escribir el parser acá. Esa lectura
 * real es trabajo aparte y más grande; esta clase solo deja el punto de
 * entrada listo para conectarla.
 */
export class PesoProviderBascula implements PesoProvider {
  obtenerPesoActual(): LecturaPeso {
    return { peso: null, origen: null }
  }
}

/**
 * Implementación de desarrollo: guarda la lectura en memoria y la deja
 * modificar desde afuera (el panel flotante de simulación en el renderer).
 * No toca disco, no sobrevive un reinicio de la app — es intencional.
 */
export class PesoProviderSimulado implements PesoProvider {
  private lectura: LecturaPeso = { peso: null, origen: null }

  obtenerPesoActual(): LecturaPeso {
    return this.lectura
  }

  // Le sirve tanto al simulador de dev — siempre 'Bascula' — como para
  // probar el flujo de ingreso manual sin depender del permiso real de
  // Entra ID que todavía no existe.
  establecerPeso(peso: number, origen: OrigenPeso = 'Bascula'): void {
    this.lectura = { peso, origen }
  }
}

export function crearPesoProvider(esDev: boolean): PesoProvider {
  return esDev ? new PesoProviderSimulado() : new PesoProviderBascula()
}
