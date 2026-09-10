import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  _inyectarDbParaPruebas,
  MOTIVOS_PESO_MANUAL,
  guardarConfigIngresoManual,
  inicializarEsquemaLocal,
  leerConfigIngresoManual,
  listarBoletasDtoLocal,
  listarPreIngresosPendientesLocal,
  marcarBoletasPreIngresoCancelado,
  obtenerBoletaDtoLocal,
  obtenerPreIngresoLocal,
  obtenerUltimaSincronizacionPreIngresos,
  upsertPreIngresosLocal,
  type PreIngresoLocal,
} from './db'

// Config de ingreso manual de peso espejada en `ConfiguracionLocal` (S2a). El
// esquema es aditivo: se siembra con `ON CONFLICT DO NOTHING` sin bump de
// `EsquemaLocalVersion`, mismo precedente que la allow-list de provisionales.

let db: Database.Database

const leerCrudo = (clave: string): string | null | undefined =>
  (db.prepare('SELECT Valor FROM ConfiguracionLocal WHERE Clave = ?').get(clave) as
    | { Valor: string | null }
    | undefined)?.Valor

beforeEach(() => {
  db = new Database(':memory:')
  inicializarEsquemaLocal(db)
  _inyectarDbParaPruebas(db)
})

afterEach(() => {
  _inyectarDbParaPruebas(null)
  db.close()
})

function sembrarBoletaConsulta(): void {
  db.exec(`
    INSERT INTO ConfiguracionLocal (Clave, Valor) VALUES
      ('BasculaId', 'ba-1'), ('BasculaCodigo', 'B01')
    ON CONFLICT(Clave) DO UPDATE SET Valor = excluded.Valor;
    INSERT INTO TipoMovimiento (Id, Codigo, Nombre, Prefijo, Direccion, OperacionD365, GeneraQR, FormatoBoletaId, Activo)
      VALUES ('tm-1', 'REC', 'Recepcion', 'REC', 'Entrada', NULL, 0, NULL, 1);
    INSERT INTO Seccion (Id, Clave, Nombre, Cardinalidad, Reportable, Estandar, Orden, Activa, FechaModificacion)
      VALUES ('s-1', 'transporte', 'Transporte', 'Unica', 0, 1, 1, 1, '2026-01-01T00:00:00Z');
    INSERT INTO Campo (Id, SeccionId, Clave, Etiqueta, TipoCampo, TipoCatalogoRef, Requerido, Configuracion, Orden, VigenteDesde, VigenteHasta, FechaModificacion)
      VALUES ('c-1', 's-1', 'piloto', 'Piloto', 'ReferenciaMaestro', 'Piloto', 1, NULL, 1, '2026-01-01T00:00:00Z', NULL, '2026-01-01T00:00:00Z');
    INSERT INTO Maestro (Id, TipoCatalogo, Codigo, Nombre, DatosAdicionales, Estado, FusionadoConId, FechaModificacion, Activo) VALUES
      ('m-provisional', 'Piloto', 'PROV-1', 'Nombre provisional', NULL, 'Provisional', 'm-oficial', '2026-01-01T00:00:00Z', 1),
      ('m-oficial', 'Piloto', 'P-100', 'Piloto Oficial', NULL, 'Activo', NULL, '2026-01-01T00:00:00Z', 1);
    INSERT INTO Boleta (
      Id, NumeroBoleta, TipoMovimientoId, Estado, EstadoSync, PesoIngreso, PesoSalida, PesoNeto,
      OrigenPesoIngreso, OrigenPesoSalida, FechaHoraIngreso, FechaHoraSalida, UsuarioIngreso,
      UsuarioSalida, UsuarioAnula, UsuarioAutoriza, MotivoAnulacion, FechaHoraAnulacion,
      PreIngresoId, BoletaReemplazoId, BoletaOrigenId, BasculaSalidaId, RespuestaD365Id,
      CreadaOffline, MotivoPesoManual, MotivoPesoManualDetalle
    ) VALUES
      ('b-1', 'REC-B01-000001', 'tm-1', 'Cerrada', 'Local', 1000, 400, 600,
       'Bascula', 'Manual', '2026-09-08T12:00:00Z', '2026-09-08T13:00:00Z', 'operador',
       'operador', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1,
       'IndicadorSinSenal', 'Indicador apagado'),
      ('b-2', 'REC-B01-000002', 'tm-1', 'EnTransito', 'Local', 900, NULL, NULL,
       'Bascula', NULL, '2026-09-08T14:00:00Z', NULL, 'operador', NULL, NULL, NULL,
       NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, NULL, NULL);
    INSERT INTO BoletaValorCampo (
      BoletaId, CampoId, Ocurrencia, SeccionId, ValorTexto, ValorNumero,
      ValorFecha, ValorBooleano, ValorMaestroId
    ) VALUES ('b-1', 'c-1', 0, 's-1', NULL, NULL, NULL, NULL, 'm-provisional');
  `)
}

describe('proyección local de consulta de boletas', () => {
  beforeEach(sembrarBoletaConsulta)

  it('devuelve BoletaDto completo y resuelve el maestro fusionado para mostrarlo', () => {
    const boleta = obtenerBoletaDtoLocal('b-1')

    expect(boleta).toMatchObject({
      id: 'b-1',
      basculaId: 'ba-1',
      basculaCodigo: 'B01',
      tipoMovimientoNombre: 'Recepcion',
      motivoPesoManual: 'IndicadorSinSenal',
      motivoPesoManualDetalle: 'Indicador apagado',
    })
    expect(boleta?.valores).toEqual([
      expect.objectContaining({
        campoId: 'c-1',
        seccionClave: 'transporte',
        seccionNombre: 'Transporte',
        campoClave: 'piloto',
        etiqueta: 'Piloto',
        tipoCampo: 'ReferenciaMaestro',
        valorMaestroId: 'm-provisional',
        valorMaestroCodigo: 'P-100',
        valorMaestroNombre: 'Piloto Oficial',
      }),
    ])
  })

  it('filtra por estado y por origen de ingreso o salida', () => {
    expect(listarBoletasDtoLocal('Cerrada').map((b) => b.id)).toEqual(['b-1'])
    expect(listarBoletasDtoLocal(undefined, 'Manual').map((b) => b.id)).toEqual(['b-1'])
    expect(listarBoletasDtoLocal('EnTransito', 'Manual')).toEqual([])
  })
})

describe('MOTIVOS_PESO_MANUAL', () => {
  it('es el catálogo cerrado que matchea el enum central MotivoPesoManual verbatim', () => {
    expect(MOTIVOS_PESO_MANUAL).toEqual([
      'IndicadorSinSenal',
      'IndicadorEnReparacion',
      'CorteEnergia',
      'Otro',
    ])
  })
})

describe('sembrarConfiguracionInicial — trío de ingreso manual', () => {
  it('siembra PermiteIngresoManual=false y cotas vacías en una DB nueva', () => {
    expect(leerCrudo('PermiteIngresoManual')).toBe('false')
    expect(leerCrudo('PesoMinimoManual')).toBe('')
    expect(leerCrudo('PesoMaximoManual')).toBe('')

    const cfg = leerConfigIngresoManual(db)
    expect(cfg.permiteIngresoManual).toBe(false)
    expect(cfg.pesoMinimoManual).toBeNull()
    expect(cfg.pesoMaximoManual).toBeNull()
    expect(cfg.motivosPesoManual).toEqual(MOTIVOS_PESO_MANUAL)
  })

  it('re-inicializar el esquema NO pisa un valor ya sincronizado (ON CONFLICT DO NOTHING)', () => {
    guardarConfigIngresoManual(db, {
      permiteIngresoManual: true,
      pesoMinimoManual: 100,
      pesoMaximoManual: 42000,
    })

    // Simula un reinicio de la app: el esquema se levanta de nuevo sobre la
    // misma base.
    inicializarEsquemaLocal(db)

    const cfg = leerConfigIngresoManual(db)
    expect(cfg.permiteIngresoManual).toBe(true)
    expect(cfg.pesoMinimoManual).toBe(100)
    expect(cfg.pesoMaximoManual).toBe(42000)
  })
})

describe('ESQUEMA_LOCAL_VERSION v3 — columnas de motivo de peso manual', () => {
  const columnasBoleta = (base: Database.Database): string[] =>
    (base.prepare('PRAGMA table_info(Boleta)').all() as { name: string }[]).map((c) => c.name)

  const versionSellada = (base: Database.Database): string | undefined =>
    (
      base
        .prepare("SELECT Valor FROM ConfiguracionLocal WHERE Clave = 'EsquemaLocalVersion'")
        .get() as { Valor: string } | undefined
    )?.Valor

  it('una DB nueva trae Boleta.MotivoPesoManual + Detalle y la versión de esquema vigente', () => {
    expect(versionSellada(db)).toBe('4')
    expect(columnasBoleta(db)).toEqual(
      expect.arrayContaining(['MotivoPesoManual', 'MotivoPesoManualDetalle']),
    )
  })

  it('una instalación en v2 agrega las columnas (ADD COLUMN aditivo) sin perder filas', () => {
    const dbV2 = new Database(':memory:')
    dbV2.exec(`
      CREATE TABLE ConfiguracionLocal (Clave TEXT PRIMARY KEY, Valor TEXT);
      CREATE TABLE Boleta (
        Id TEXT PRIMARY KEY,
        NumeroBoleta TEXT NOT NULL UNIQUE,
        TipoMovimientoId TEXT NOT NULL,
        Estado TEXT NOT NULL,
        EstadoSync TEXT NOT NULL,
        PesoIngreso REAL NOT NULL,
        OrigenPesoIngreso TEXT NOT NULL,
        FechaHoraIngreso TEXT NOT NULL,
        UsuarioIngreso TEXT NOT NULL,
        CreadaOffline INTEGER NOT NULL
      );
    `)
    dbV2.prepare("INSERT INTO ConfiguracionLocal (Clave, Valor) VALUES ('EsquemaLocalVersion', '2')").run()
    dbV2
      .prepare(
        `INSERT INTO Boleta (Id, NumeroBoleta, TipoMovimientoId, Estado, EstadoSync,
          PesoIngreso, OrigenPesoIngreso, FechaHoraIngreso, UsuarioIngreso, CreadaOffline)
         VALUES ('b1', 'REC-B1-000001', 'tm1', 'EnTransito', 'Local', 1000, 'Bascula',
          '2026-01-01T00:00:00.000Z', 'operador', 1)`,
      )
      .run()

    inicializarEsquemaLocal(dbV2)

    expect(versionSellada(dbV2)).toBe('4')
    expect(columnasBoleta(dbV2)).toEqual(
      expect.arrayContaining(['MotivoPesoManual', 'MotivoPesoManualDetalle', 'MarcaPreIngreso']),
    )
    const fila = dbV2.prepare("SELECT * FROM Boleta WHERE Id = 'b1'").get() as Record<string, unknown>
    expect(fila.PesoIngreso).toBe(1000)
    expect(fila.MotivoPesoManual).toBeNull()
    expect(fila.MotivoPesoManualDetalle).toBeNull()

    // Idempotente: re-inicializar (reinicio de la app) no re-ejecuta el ALTER.
    expect(() => inicializarEsquemaLocal(dbV2)).not.toThrow()
    dbV2.close()
  })
})

describe('ESQUEMA_LOCAL_VERSION v4 — espejo PreIngreso (cola-transporte slice 3)', () => {
  const columnasBoleta = (base: Database.Database): string[] =>
    (base.prepare('PRAGMA table_info(Boleta)').all() as { name: string }[]).map((c) => c.name)

  const tablaExiste = (base: Database.Database, tabla: string): boolean =>
    (base
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(tabla) as { name: string } | undefined) !== undefined

  const versionSellada = (base: Database.Database): string | undefined =>
    (
      base
        .prepare("SELECT Valor FROM ConfiguracionLocal WHERE Clave = 'EsquemaLocalVersion'")
        .get() as { Valor: string } | undefined
    )?.Valor

  it('una DB nueva nace en v4 con la tabla PreIngreso y Boleta.MarcaPreIngreso', () => {
    expect(versionSellada(db)).toBe('4')
    expect(tablaExiste(db, 'PreIngreso')).toBe(true)
    expect(columnasBoleta(db)).toEqual(expect.arrayContaining(['MarcaPreIngreso']))
  })

  it('una instalación en v3 agrega PreIngreso + MarcaPreIngreso (aditivo) sin perder filas', () => {
    const dbV3 = new Database(':memory:')
    dbV3.exec(`
      CREATE TABLE ConfiguracionLocal (Clave TEXT PRIMARY KEY, Valor TEXT);
      CREATE TABLE Boleta (
        Id TEXT PRIMARY KEY,
        NumeroBoleta TEXT NOT NULL UNIQUE,
        TipoMovimientoId TEXT NOT NULL,
        Estado TEXT NOT NULL,
        EstadoSync TEXT NOT NULL,
        PesoIngreso REAL NOT NULL,
        OrigenPesoIngreso TEXT NOT NULL,
        FechaHoraIngreso TEXT NOT NULL,
        UsuarioIngreso TEXT NOT NULL,
        CreadaOffline INTEGER NOT NULL,
        MotivoPesoManual TEXT,
        MotivoPesoManualDetalle TEXT
      );
    `)
    dbV3.prepare("INSERT INTO ConfiguracionLocal (Clave, Valor) VALUES ('EsquemaLocalVersion', '3')").run()
    dbV3
      .prepare(
        `INSERT INTO Boleta (Id, NumeroBoleta, TipoMovimientoId, Estado, EstadoSync,
          PesoIngreso, OrigenPesoIngreso, FechaHoraIngreso, UsuarioIngreso, CreadaOffline)
         VALUES ('b1', 'REC-B1-000001', 'tm1', 'EnTransito', 'Local', 1234, 'Bascula',
          '2026-01-01T00:00:00.000Z', 'operador', 1)`,
      )
      .run()

    inicializarEsquemaLocal(dbV3)

    expect(versionSellada(dbV3)).toBe('4')
    expect(tablaExiste(dbV3, 'PreIngreso')).toBe(true)
    expect(columnasBoleta(dbV3)).toEqual(expect.arrayContaining(['MarcaPreIngreso']))
    const fila = dbV3.prepare("SELECT * FROM Boleta WHERE Id = 'b1'").get() as Record<string, unknown>
    expect(fila.PesoIngreso).toBe(1234)
    expect(fila.MarcaPreIngreso).toBeNull()

    // Idempotente: re-inicializar (reinicio de la app) no re-ejecuta el ALTER.
    expect(() => inicializarEsquemaLocal(dbV3)).not.toThrow()
    dbV3.close()
  })
})

describe('espejo PreIngreso — helpers de sync', () => {
  const preLocal = (
    id: string,
    estado: string,
    fechaModificacion: string,
    extra: Partial<PreIngresoLocal> = {},
  ): PreIngresoLocal => ({
    id,
    centroId: 'centro-1',
    pilotoId: null,
    transportistaId: null,
    equipoId: null,
    regionId: null,
    fincaId: null,
    numeroEnvio: `ENV-${id}`,
    pesoEnviado: 20000,
    racimos: 100,
    sacos: null,
    estado,
    boletaId: null,
    usuarioCreacion: 'admin',
    usuarioCancela: null,
    motivoCancelacion: null,
    fechaCreacion: fechaModificacion,
    fechaModificacion,
    ...extra,
  })

  it('upsertPreIngresosLocal inserta la tanda entera y re-upsertea por Id', () => {
    upsertPreIngresosLocal([
      preLocal('p1', 'Pendiente', '2026-09-01T00:00:00Z'),
      preLocal('p2', 'Pendiente', '2026-09-02T00:00:00Z'),
    ])
    expect(listarPreIngresosPendientesLocal().map((p) => p.id).sort()).toEqual(['p1', 'p2'])
    expect(obtenerPreIngresoLocal('p1')).toMatchObject({
      id: 'p1',
      centroId: 'centro-1',
      numeroEnvio: 'ENV-p1',
      pesoEnviado: 20000,
      racimos: 100,
      estado: 'Pendiente',
    })

    upsertPreIngresosLocal([preLocal('p1', 'Vinculado', '2026-09-03T00:00:00Z')])
    expect(obtenerPreIngresoLocal('p1')?.estado).toBe('Vinculado')
    expect(listarPreIngresosPendientesLocal().map((p) => p.id)).toEqual(['p2'])
  })

  it('listarPreIngresosPendientesLocal filtra por coincidencia parcial de número de envío', () => {
    upsertPreIngresosLocal([
      preLocal('p1', 'Pendiente', '2026-09-01T00:00:00Z', { numeroEnvio: 'ENV-2024-001' }),
      preLocal('p2', 'Pendiente', '2026-09-02T00:00:00Z', { numeroEnvio: 'ENV-2024-777' }),
      preLocal('p3', 'Pendiente', '2026-09-03T00:00:00Z', { numeroEnvio: 'OTRO-9' }),
    ])
    expect(listarPreIngresosPendientesLocal('001').map((p) => p.id)).toEqual(['p1'])
    expect(listarPreIngresosPendientesLocal('ENV-2024').map((p) => p.id).sort()).toEqual(['p1', 'p2'])
  })

  it('obtenerUltimaSincronizacionPreIngresos es MAX(FechaModificacion) y null sin filas', () => {
    expect(obtenerUltimaSincronizacionPreIngresos()).toBeNull()
    upsertPreIngresosLocal([
      preLocal('p1', 'Pendiente', '2026-09-01T00:00:00Z'),
      preLocal('p2', 'Cancelado', '2026-09-05T00:00:00Z'),
      preLocal('p3', 'Vinculado', '2026-09-03T00:00:00Z'),
    ])
    expect(obtenerUltimaSincronizacionPreIngresos()).toBe('2026-09-05T00:00:00Z')
  })

  it('aplica la cancelación (marca la boleta) en la MISMA transacción que el upsert', () => {
    db.prepare(
      `INSERT INTO Boleta (
        Id, NumeroBoleta, TipoMovimientoId, Estado, EstadoSync, PesoIngreso, OrigenPesoIngreso,
        FechaHoraIngreso, UsuarioIngreso, CreadaOffline, PreIngresoId
      ) VALUES ('b1', 'REC-B1-000001', 'tm1', 'Cerrada', 'Local', 1000, 'Bascula',
        '2026-09-02T00:00:00Z', 'op', 1, 'p1')`,
    ).run()

    upsertPreIngresosLocal([preLocal('p1', 'Cancelado', '2026-09-04T00:00:00Z')])

    expect(
      (db.prepare(`SELECT MarcaPreIngreso FROM Boleta WHERE Id = 'b1'`).get() as { MarcaPreIngreso: string | null })
        .MarcaPreIngreso,
    ).toBe('PreIngresoCancelado')
  })

  it('si la cancelación falla, la tanda entera se revierte y la marca de agua no avanza', () => {
    upsertPreIngresosLocal([preLocal('p0', 'Pendiente', '2026-08-01T00:00:00Z')])
    const watermarkPrevio = obtenerUltimaSincronizacionPreIngresos()

    // Rompe marcarBoletasPreIngresoCancelado -> la transacción del upsert tira.
    db.exec('DROP TABLE Boleta')

    expect(() =>
      upsertPreIngresosLocal([preLocal('p1', 'Cancelado', '2026-09-09T00:00:00Z')]),
    ).toThrow()

    expect(obtenerUltimaSincronizacionPreIngresos()).toBe(watermarkPrevio)
    expect(obtenerPreIngresoLocal('p1')).toBeNull()
  })

  it('marcarBoletasPreIngresoCancelado no pisa un marcador ya presente', () => {
    db.exec(`
      INSERT INTO Boleta (
        Id, NumeroBoleta, TipoMovimientoId, Estado, EstadoSync, PesoIngreso, OrigenPesoIngreso,
        FechaHoraIngreso, UsuarioIngreso, CreadaOffline, PreIngresoId, MarcaPreIngreso
      ) VALUES
        ('b1', 'REC-B1-000001', 'tm1', 'Cerrada', 'Local', 1000, 'Bascula', '2026-09-02T00:00:00Z', 'op', 1, 'p1', NULL),
        ('b2', 'REC-B1-000002', 'tm1', 'Cerrada', 'Local', 1000, 'Bascula', '2026-09-02T00:00:00Z', 'op', 1, 'p2', 'VinculoRechazado');
    `)

    marcarBoletasPreIngresoCancelado(['p1', 'p2'])

    const filas = db
      .prepare(`SELECT Id, MarcaPreIngreso FROM Boleta ORDER BY Id`)
      .all() as Array<{ Id: string; MarcaPreIngreso: string | null }>
    expect(filas).toEqual([
      { Id: 'b1', MarcaPreIngreso: 'PreIngresoCancelado' },
      { Id: 'b2', MarcaPreIngreso: 'VinculoRechazado' },
    ])
  })
})

describe('leerConfigIngresoManual', () => {
  it('clave ausente => default-deny y sin cotas', () => {
    db.prepare(
      `DELETE FROM ConfiguracionLocal WHERE Clave IN
       ('PermiteIngresoManual', 'PesoMinimoManual', 'PesoMaximoManual')`,
    ).run()

    const cfg = leerConfigIngresoManual(db)
    expect(cfg.permiteIngresoManual).toBe(false)
    expect(cfg.pesoMinimoManual).toBeNull()
    expect(cfg.pesoMaximoManual).toBeNull()
    expect(cfg.motivosPesoManual).toEqual(MOTIVOS_PESO_MANUAL)
  })

  it('guardarConfigIngresoManual upsertea el trío y null en una cota se guarda vacío', () => {
    guardarConfigIngresoManual(db, {
      permiteIngresoManual: true,
      pesoMinimoManual: 75.25,
      pesoMaximoManual: null,
    })

    expect(leerCrudo('PesoMaximoManual')).toBe('')
    const cfg = leerConfigIngresoManual(db)
    expect(cfg.permiteIngresoManual).toBe(true)
    expect(cfg.pesoMinimoManual).toBe(75.25)
    expect(cfg.pesoMaximoManual).toBeNull()
  })
})
