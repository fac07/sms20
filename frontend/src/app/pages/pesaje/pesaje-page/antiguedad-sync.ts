/** Umbral a partir del cual el último sync de configuración se marca "viejo". */
export const HORAS_SYNC_VIEJO = 24;

const MS_MINUTO = 60_000;
const MS_HORA = 60 * MS_MINUTO;
const MS_DIA = 24 * MS_HORA;

/** Estado del indicador de antigüedad del sync de configuración. */
export interface AntiguedadSync {
  /** Texto listo para mostrar: "config actualizada hace X" / "config sin sincronizar". */
  texto: string;
  /** `true` cuando nunca sincronizó o el último sync supera las 24h. */
  esViejo: boolean;
}

function frase(ms: number): string {
  if (ms < MS_MINUTO) return 'hace un momento';
  if (ms < MS_HORA) {
    const m = Math.floor(ms / MS_MINUTO);
    return `hace ${m} ${m === 1 ? 'minuto' : 'minutos'}`;
  }
  if (ms < MS_DIA) {
    const h = Math.floor(ms / MS_HORA);
    return `hace ${h} ${h === 1 ? 'hora' : 'horas'}`;
  }
  const d = Math.floor(ms / MS_DIA);
  return `hace ${d} ${d === 1 ? 'día' : 'días'}`;
}

/**
 * Deriva el indicador de staleness a partir de `lastConfigSyncAt` (ISO string o
 * `null`) y el instante actual. No bloquea nada: solo describe. Función pura.
 */
export function calcularAntiguedadSync(
  lastConfigSyncAt: string | null,
  ahora: Date = new Date(),
): AntiguedadSync {
  if (lastConfigSyncAt === null || lastConfigSyncAt.trim() === '') {
    return { texto: 'config sin sincronizar', esViejo: true };
  }

  const sync = new Date(lastConfigSyncAt);
  if (Number.isNaN(sync.getTime())) {
    return { texto: 'config sin sincronizar', esViejo: true };
  }

  const transcurridoMs = Math.max(0, ahora.getTime() - sync.getTime());
  return {
    texto: `config actualizada ${frase(transcurridoMs)}`,
    esViejo: transcurridoMs > HORAS_SYNC_VIEJO * MS_HORA,
  };
}
