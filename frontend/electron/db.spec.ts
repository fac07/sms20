import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  _inyectarDbParaPruebas,
  MOTIVOS_PESO_MANUAL,
  RecepcionDuplicadaError,
  buscarBoletaRecibidaDeOrigen,
  crearBoletaLocal,
  guardarConfigIngresoManual,
  inicializarEsquemaLocal,
  leerConfigIngresoManual,
  listarBoletasDtoLocal,
  listarOutboxLocal,
  listarPreIngresosPendientesLocal,
  marcarBoletasPreIngresoCancelado,
  obtenerBoletaDtoLocal,
  obtenerBoletaLocal,
  obtenerMaestroLocal,
  obtenerMaestroLocalPorCodigo,
  obtenerPreIngresoLocal,
  obtenerUltimaSincronizacionMaestros,
  obtenerUltimaSincronizacionPreIngresos,
  obtenerUltimaSincronizacionVinculos,
  setConfig,
  upsertMaestrosYVinculosLocal,
  upsertPreIngresosLocal,
  upsertVinculosLocal,
  vinculosPorTransportistaLocal,
  type PreIngresoLocal,
  type VinculoPilotoTransportistaLocal,
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
        // Snapshot del maestro vigente (oficial) para el QR de transferencia.
        valorMaestroTipoCatalogo: 'Piloto',
        valorMaestroProvisional: false,
      }),
    ])
  })

  it('filtra por estado y por origen de ingreso o salida', () => {
    expect(listarBoletasDtoLocal('Cerrada').map((b) => b.id)).toEqual(['b-1'])
    expect(listarBoletasDtoLocal(undefined, 'Manual').map((b) => b.id)).toEqual(['b-1'])
    expect(listarBoletasDtoLocal('EnTransito', 'Manual')).toEqual([])
  })
})

describe('proyección local del enlace de pre-ingreso en consulta (cola-transporte slice 6)', () => {
  beforeEach(() => {
    sembrarBoletaConsulta()
    upsertPreIngresosLocal([
      {
        id: 'pre-1',
        centroId: 'centro-1',
        pilotoId: null,
        transportistaId: null,
        equipoId: null,
        regionId: null,
        fincaId: null,
        numeroEnvio: 'ENV-2024-001',
        pesoEnviado: 20000,
        racimos: 100,
        sacos: null,
        estado: 'Vinculado',
        boletaId: 'b-1',
        usuarioCreacion: 'admin',
        usuarioCancela: null,
        motivoCancelacion: null,
        fechaCreacion: '2026-09-10T00:00:00Z',
        fechaModificacion: '2026-09-10T00:00:00Z',
      },
    ])
    db.prepare(`UPDATE Boleta SET PreIngresoId = 'pre-1' WHERE Id = 'b-1'`).run()
  })

  it('obtenerBoletaDtoLocal proyecta marcaPreIngreso (columna ya existía, slice 3 la dejó sin proyectar)', () => {
    db.prepare(`UPDATE Boleta SET MarcaPreIngreso = 'PreIngresoCancelado' WHERE Id = 'b-1'`).run()

    const boleta = obtenerBoletaDtoLocal('b-1')

    expect(boleta?.marcaPreIngreso).toBe('PreIngresoCancelado')
  })

  it('obtenerBoletaDtoLocal proyecta el número de envío y el estado del pre-ingreso enlazado', () => {
    const boleta = obtenerBoletaDtoLocal('b-1')

    expect(boleta?.preIngresoNumeroEnvio).toBe('ENV-2024-001')
    expect(boleta?.preIngresoEstado).toBe('Vinculado')
  })

  it('sin enlace, marcaPreIngreso/preIngresoNumeroEnvio/preIngresoEstado son null', () => {
    const boleta = obtenerBoletaDtoLocal('b-2')

    expect(boleta?.marcaPreIngreso).toBeNull()
    expect(boleta?.preIngresoNumeroEnvio).toBeNull()
    expect(boleta?.preIngresoEstado).toBeNull()
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
    expect(versionSellada(db)).toBe('5')
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

    expect(versionSellada(dbV2)).toBe('5')
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

  it('una DB nueva nace en v5 con la tabla PreIngreso y Boleta.MarcaPreIngreso', () => {
    expect(versionSellada(db)).toBe('5')
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

    expect(versionSellada(dbV3)).toBe('5')
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

describe('ESQUEMA_LOCAL_VERSION v5 — espejo VinculoPilotoTransportista (PR5 — sync + selector escopado)', () => {
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

  it('una DB nueva nace en v5 con la tabla VinculoPilotoTransportista', () => {
    expect(versionSellada(db)).toBe('5')
    expect(tablaExiste(db, 'VinculoPilotoTransportista')).toBe(true)
  })

  it('una instalación en v4 (sin la tabla) la agrega de forma aditiva sin perder filas de Boleta', () => {
    const dbV4 = new Database(':memory:')
    dbV4.exec(`
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
        MotivoPesoManualDetalle TEXT,
        MarcaPreIngreso TEXT
      );
    `)
    dbV4.prepare("INSERT INTO ConfiguracionLocal (Clave, Valor) VALUES ('EsquemaLocalVersion', '4')").run()
    dbV4
      .prepare(
        `INSERT INTO Boleta (Id, NumeroBoleta, TipoMovimientoId, Estado, EstadoSync,
          PesoIngreso, OrigenPesoIngreso, FechaHoraIngreso, UsuarioIngreso, CreadaOffline)
         VALUES ('b1', 'REC-B1-000001', 'tm1', 'EnTransito', 'Local', 1500, 'Bascula',
          '2026-01-01T00:00:00.000Z', 'operador', 1)`,
      )
      .run()

    inicializarEsquemaLocal(dbV4)

    expect(versionSellada(dbV4)).toBe('5')
    expect(tablaExiste(dbV4, 'VinculoPilotoTransportista')).toBe(true)
    const fila = dbV4.prepare("SELECT * FROM Boleta WHERE Id = 'b1'").get() as Record<string, unknown>
    expect(fila.PesoIngreso).toBe(1500)

    dbV4.close()
  })

  it('re-inicializar sobre una DB ya v5 es un no-op idempotente', () => {
    expect(() => inicializarEsquemaLocal(db)).not.toThrow()
    expect(versionSellada(db)).toBe('5')
    expect(tablaExiste(db, 'VinculoPilotoTransportista')).toBe(true)
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

describe('espejo VinculoPilotoTransportista — helpers de sync (PR5)', () => {
  const vinculoLocal = (
    id: string,
    pilotoId: string,
    transportistaId: string,
    activo: boolean,
    fechaModificacion: string,
  ): VinculoPilotoTransportistaLocal => ({ id, pilotoId, transportistaId, activo, fechaModificacion })

  it('upsertVinculosLocal inserta la tanda entera y re-upsertea por Id', () => {
    upsertVinculosLocal([
      vinculoLocal('v1', 'p1', 't1', true, '2026-09-01T00:00:00Z'),
      vinculoLocal('v2', 'p2', 't1', true, '2026-09-01T00:00:00Z'),
    ])
    expect(vinculosPorTransportistaLocal('t1').map((v) => v.pilotoId).sort()).toEqual(['p1', 'p2'])

    upsertVinculosLocal([vinculoLocal('v1', 'p1', 't1', false, '2026-09-02T00:00:00Z')])
    expect(vinculosPorTransportistaLocal('t1').map((v) => v.pilotoId)).toEqual(['p2'])
  })

  it('vinculosPorTransportistaLocal devuelve SOLO los enlaces activos de ESE transportista', () => {
    upsertVinculosLocal([
      vinculoLocal('v1', 'p1', 't1', true, '2026-09-01T00:00:00Z'),
      vinculoLocal('v2', 'p2', 't1', false, '2026-09-01T00:00:00Z'),
      vinculoLocal('v3', 'p3', 't2', true, '2026-09-01T00:00:00Z'),
    ])

    expect(vinculosPorTransportistaLocal('t1').map((v) => v.pilotoId)).toEqual(['p1'])
    expect(vinculosPorTransportistaLocal('t2').map((v) => v.pilotoId)).toEqual(['p3'])
    expect(vinculosPorTransportistaLocal('t-sin-enlaces')).toEqual([])
  })

  it('obtenerUltimaSincronizacionVinculos es MAX(FechaModificacion) y null sin filas', () => {
    expect(obtenerUltimaSincronizacionVinculos()).toBeNull()
    upsertVinculosLocal([
      vinculoLocal('v1', 'p1', 't1', true, '2026-09-01T00:00:00Z'),
      vinculoLocal('v2', 'p2', 't1', true, '2026-09-05T00:00:00Z'),
    ])
    expect(obtenerUltimaSincronizacionVinculos()).toBe('2026-09-05T00:00:00Z')
  })

  it('upsertMaestrosYVinculosLocal comitea Maestro y Vinculo en UNA sola transacción', () => {
    upsertMaestrosYVinculosLocal(
      [
        {
          id: 'p1',
          tipoCatalogo: 'Piloto',
          codigo: 'P-1',
          nombre: 'Juan',
          datosAdicionales: null,
          estado: 'Oficial',
          fusionadoConId: null,
          fechaModificacion: '2026-09-01T00:00:00Z',
          activo: true,
        },
      ],
      [vinculoLocal('v1', 'p1', 't1', true, '2026-09-01T00:00:00Z')],
    )

    expect(obtenerMaestroLocal('p1')?.nombre).toBe('Juan')
    expect(vinculosPorTransportistaLocal('t1').map((v) => v.pilotoId)).toEqual(['p1'])
  })

  it('G4: si el upsert de Vinculo falla, NINGÚN watermark avanza (ni Maestro ni Vinculo)', () => {
    const watermarkMaestroPrevio = obtenerUltimaSincronizacionMaestros()

    // Rompe upsertVinculosLocal -> la transacción exterior (Maestro + Vinculo)
    // entera tiene que revertirse, no solo la mitad de Vinculo.
    db.exec('DROP TABLE VinculoPilotoTransportista')

    expect(() =>
      upsertMaestrosYVinculosLocal(
        [
          {
            id: 'p2',
            tipoCatalogo: 'Piloto',
            codigo: 'P-2',
            nombre: 'Ana',
            datosAdicionales: null,
            estado: 'Oficial',
            fusionadoConId: null,
            fechaModificacion: '2026-09-09T00:00:00Z',
            activo: true,
          },
        ],
        [vinculoLocal('v2', 'p2', 't2', true, '2026-09-09T00:00:00Z')],
      ),
    ).toThrow()

    expect(obtenerUltimaSincronizacionMaestros()).toBe(watermarkMaestroPrevio)
    // El Maestro tampoco quedó persistido — la transacción entera se revirtió,
    // no solo la mitad de VinculoPilotoTransportista.
    expect(obtenerMaestroLocal('p2')).toBeNull()
  })

  it('G4 (simétrico): si el upsert de Maestro falla, el watermark de Vinculo tampoco avanza', () => {
    const watermarkVinculoPrevio = obtenerUltimaSincronizacionVinculos()

    db.exec('DROP TABLE Maestro')

    expect(() =>
      upsertMaestrosYVinculosLocal(
        [
          {
            id: 'p3',
            tipoCatalogo: 'Piloto',
            codigo: 'P-3',
            nombre: 'Zoe',
            datosAdicionales: null,
            estado: 'Oficial',
            fusionadoConId: null,
            fechaModificacion: '2026-09-10T00:00:00Z',
            activo: true,
          },
        ],
        [vinculoLocal('v3', 'p3', 't3', true, '2026-09-10T00:00:00Z')],
      ),
    ).toThrow()

    expect(obtenerUltimaSincronizacionVinculos()).toBe(watermarkVinculoPrevio)
    expect(vinculosPorTransportistaLocal('t3')).toEqual([])
  })
})

describe('crearBoletaLocal — carga del enlace de pre-ingreso (cola-transporte slice 4)', () => {
  beforeEach(() => {
    setConfig('BasculaCodigo', 'B1')
    db.prepare(
      `INSERT INTO TipoMovimiento (Id, Codigo, Nombre, Prefijo, Direccion, OperacionD365, GeneraQR, FormatoBoletaId, Activo)
       VALUES ('tm-1', 'REC', 'Recepcion', 'REC', 'Entrada', NULL, 0, NULL, 1)`,
    ).run()
  })

  const entradaBase = {
    prefijo: 'REC',
    codigoBascula: 'B1',
    tipoMovimientoId: 'tm-1',
    pesoIngreso: 1000,
    origenPesoIngreso: 'Bascula' as const,
    fechaHoraIngreso: '2026-09-09T12:00:00.000Z',
    usuarioIngreso: 'operador',
    creadaOffline: true,
  }

  it('acepta y persiste preIngresoId y el payload Crear del Outbox lo lleva', () => {
    const boleta = crearBoletaLocal({ ...entradaBase, preIngresoId: 'pre-77' })

    expect(obtenerBoletaLocal(boleta.id)?.preIngresoId).toBe('pre-77')

    const evento = listarOutboxLocal().find(
      (e) => e.operacion === 'Crear' && e.entidadId === boleta.id,
    )
    const payload = JSON.parse(evento!.payload) as { preIngresoId?: string | null }
    expect(payload.preIngresoId).toBe('pre-77')
  })

  it('sin pre-ingreso seleccionado guarda preIngresoId null, un solo evento Crear y sin advertencia', () => {
    const boleta = crearBoletaLocal({ ...entradaBase })

    expect(obtenerBoletaLocal(boleta.id)?.preIngresoId).toBeNull()

    const eventos = listarOutboxLocal()
    expect(eventos).toHaveLength(1)
    expect(eventos[0].operacion).toBe('Crear')
    const payload = JSON.parse(eventos[0].payload) as { preIngresoId?: string | null }
    expect(payload.preIngresoId).toBeNull()
  })
})

describe('marcarBoletasPreIngresoCancelado — marca sin alterar la boleta (cola-transporte slice 4)', () => {
  it('pone PreIngresoCancelado sin tocar estado, pesos, enlace ni validez', () => {
    db.prepare(
      `INSERT INTO Boleta (
        Id, NumeroBoleta, TipoMovimientoId, Estado, EstadoSync, PesoIngreso, PesoSalida, PesoNeto,
        OrigenPesoIngreso, FechaHoraIngreso, UsuarioIngreso, CreadaOffline, PreIngresoId
      ) VALUES ('b9', 'REC-B1-000009', 'tm1', 'Cerrada', 'Local', 20000, 3000, 17000,
        'Bascula', '2026-09-02T00:00:00Z', 'op', 1, 'p9')`,
    ).run()

    marcarBoletasPreIngresoCancelado(['p9'])

    const fila = db.prepare(`SELECT * FROM Boleta WHERE Id = 'b9'`).get() as Record<string, unknown>
    expect(fila.MarcaPreIngreso).toBe('PreIngresoCancelado')
    expect(fila.Estado).toBe('Cerrada')
    expect(fila.PreIngresoId).toBe('p9')
    expect(fila.PesoIngreso).toBe(20000)
    expect(fila.PesoSalida).toBe(3000)
    expect(fila.PesoNeto).toBe(17000)
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

describe('crearBoletaLocal — enlace a la boleta origen (recepción de transferencia NAT)', () => {
  const ORIGEN = 'aaaaaaaa-0000-4000-8000-000000000001'

  beforeEach(() => {
    setConfig('BasculaCodigo', 'B1')
    db.prepare(
      `INSERT INTO TipoMovimiento (Id, Codigo, Nombre, Prefijo, Direccion, OperacionD365, GeneraQR, FormatoBoletaId, Activo)
       VALUES ('tm-1', 'REC', 'Recepcion', 'REC', 'Entrada', NULL, 0, NULL, 1)`,
    ).run()
  })

  const entradaBase = {
    prefijo: 'REC',
    codigoBascula: 'B1',
    tipoMovimientoId: 'tm-1',
    pesoIngreso: 1000,
    origenPesoIngreso: 'Bascula' as const,
    fechaHoraIngreso: '2026-09-09T12:00:00.000Z',
    usuarioIngreso: 'operador',
    creadaOffline: true,
  }

  const secuencial = (): number | undefined =>
    (db.prepare("SELECT Secuencial FROM Correlativo WHERE Prefijo = 'REC'").get() as
      | { Secuencial: number }
      | undefined)?.Secuencial

  it('persiste boletaOrigenId y el payload Crear del Outbox lo lleva', () => {
    const boleta = crearBoletaLocal({ ...entradaBase, boletaOrigenId: ORIGEN })

    expect(obtenerBoletaLocal(boleta.id)?.boletaOrigenId).toBe(ORIGEN)
    const evento = listarOutboxLocal().find((e) => e.operacion === 'Crear' && e.entidadId === boleta.id)
    expect((JSON.parse(evento!.payload) as { boletaOrigenId?: string }).boletaOrigenId).toBe(ORIGEN)
  })

  it('sin origen guarda null', () => {
    expect(crearBoletaLocal({ ...entradaBase }).boletaOrigenId).toBeNull()
  })

  it('una segunda recepción del mismo origen lanza RecepcionDuplicadaError sin efectos colaterales', () => {
    const primera = crearBoletaLocal({ ...entradaBase, boletaOrigenId: ORIGEN })
    const secuencialAntes = secuencial()
    const eventosAntes = listarOutboxLocal().length

    let error: unknown
    try {
      crearBoletaLocal({ ...entradaBase, boletaOrigenId: ORIGEN })
    } catch (e) {
      error = e
    }

    expect(error).toBeInstanceOf(RecepcionDuplicadaError)
    expect(error).toMatchObject({ boletaId: primera.id, numeroBoleta: primera.numeroBoleta })
    expect(secuencial()).toBe(secuencialAntes)
    expect(listarOutboxLocal()).toHaveLength(eventosAntes)
    expect(db.prepare('SELECT COUNT(*) AS n FROM Boleta').get()).toEqual({ n: 1 })
  })

  it('una recepción Anulada no bloquea una nueva; una Reemitida sí', () => {
    const primera = crearBoletaLocal({ ...entradaBase, boletaOrigenId: ORIGEN })
    db.prepare("UPDATE Boleta SET Estado = 'Anulada' WHERE Id = ?").run(primera.id)
    expect(buscarBoletaRecibidaDeOrigen(ORIGEN)).toBeNull()

    const segunda = crearBoletaLocal({ ...entradaBase, boletaOrigenId: ORIGEN })
    db.prepare("UPDATE Boleta SET Estado = 'Reemitida' WHERE Id = ?").run(segunda.id)
    expect(buscarBoletaRecibidaDeOrigen(ORIGEN)).toEqual({
      id: segunda.id,
      numeroBoleta: segunda.numeroBoleta,
    })
    expect(() => crearBoletaLocal({ ...entradaBase, boletaOrigenId: ORIGEN })).toThrow(
      RecepcionDuplicadaError,
    )
  })

  it('crea IX_Boleta_BoletaOrigenId (parcial) también sobre una Boleta legacy sin la columna', () => {
    const indice = (base: Database.Database): { sql: string } | undefined =>
      base.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'IX_Boleta_BoletaOrigenId'").get() as
        | { sql: string }
        | undefined
    expect(indice(db)?.sql).toContain('WHERE BoletaOrigenId IS NOT NULL')

    const legacy = new Database(':memory:')
    legacy.exec(`
      CREATE TABLE ConfiguracionLocal (Clave TEXT PRIMARY KEY, Valor TEXT);
      CREATE TABLE Boleta (
        Id TEXT PRIMARY KEY, NumeroBoleta TEXT NOT NULL UNIQUE, TipoMovimientoId TEXT NOT NULL,
        Estado TEXT NOT NULL, EstadoSync TEXT NOT NULL, PesoIngreso REAL NOT NULL,
        OrigenPesoIngreso TEXT NOT NULL, FechaHoraIngreso TEXT NOT NULL, UsuarioIngreso TEXT NOT NULL,
        CreadaOffline INTEGER NOT NULL
      );
    `)
    legacy.prepare("INSERT INTO ConfiguracionLocal (Clave, Valor) VALUES ('EsquemaLocalVersion', '5')").run()
    inicializarEsquemaLocal(legacy)
    expect(indice(legacy)).toBeDefined()
    legacy.close()
  })
})

describe('obtenerMaestroLocalPorCodigo', () => {
  const insertar = (id: string, tipo: string, codigo: string, estado: string, activo: number): void => {
    db.prepare(
      `INSERT INTO Maestro (Id, TipoCatalogo, Codigo, Nombre, DatosAdicionales, Estado, FusionadoConId, FechaModificacion, Activo)
       VALUES (?, ?, ?, ?, NULL, ?, NULL, '2026-01-01T00:00:00Z', ?)`,
    ).run(id, tipo, codigo, `N-${id}`, estado, activo)
  }

  it('devuelve solo el Oficial (activo o inactivo) y nunca un provisional con el mismo código', () => {
    insertar('prov', 'Finca', 'X-1', 'Provisional', 1)
    expect(obtenerMaestroLocalPorCodigo('Finca', 'X-1')).toBeNull()

    insertar('of', 'Finca', 'X-1', 'Oficial', 0)
    expect(obtenerMaestroLocalPorCodigo('Finca', 'X-1')?.id).toBe('of')
    expect(obtenerMaestroLocalPorCodigo('Producto', 'X-1')).toBeNull()
  })
})
