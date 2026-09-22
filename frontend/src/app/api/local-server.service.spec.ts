import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  CrearBoletaInput,
  LocalServerService,
  MaestroLocal,
} from './local-server.service';

// El servidor local es `environment.localServerUrl` fuera de Electron (acá,
// sin `window.sms`): http://127.0.0.1:4127.
const LOCAL = 'http://127.0.0.1:4127';

function maestro(parcial: Partial<MaestroLocal> = {}): MaestroLocal {
  return {
    id: 'm-1',
    tipoCatalogo: 'Piloto',
    codigo: 'PIL-001',
    nombre: 'Juan Pérez',
    datosAdicionales: null,
    estado: 'Activo',
    fusionadoConId: null,
    fechaModificacion: '2026-09-20T00:00:00Z',
    activo: true,
    ...parcial,
  };
}

function crearInput(parcial: Partial<CrearBoletaInput> = {}): CrearBoletaInput {
  return {
    numeroBoletaPrefijo: 'RT',
    codigoBascula: 'B01',
    tipoMovimientoId: 'tm-recep',
    pesoIngreso: 18000,
    origenPesoIngreso: 'Bascula',
    usuarioIngreso: 'operador',
    creadaOffline: true,
    valores: [],
    ...parcial,
  };
}

describe('LocalServerService — recepción QR (origen, recibida-de, maestros)', () => {
  let service: LocalServerService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(LocalServerService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('crearBoleta envía boletaOrigenId en el body (POST /boletas)', () => {
    let body: Record<string, unknown> | null = null;
    service.crearBoleta(crearInput({ boletaOrigenId: 'origen-1' })).subscribe();

    const req = httpMock.expectOne(`${LOCAL}/boletas`);
    body = req.request.body as unknown as Record<string, unknown>;
    expect(body['boletaOrigenId']).toBe('origen-1');
    req.flush({ id: 'b-new' });
  });

  it('boletaRecibidaDe consulta GET /boletas/recibida-de/:origenId', () => {
    let resultado: { recibida: boolean; boletaId?: string } | null = null;
    service.boletaRecibidaDe('origen-1').subscribe((r) => (resultado = r));

    httpMock.expectOne(`${LOCAL}/boletas/recibida-de/origen-1`).flush({
      recibida: true,
      boletaId: 'b-9',
      numeroBoleta: 'RT-B01-000007',
    });
    expect(resultado).toEqual({ recibida: true, boletaId: 'b-9', numeroBoleta: 'RT-B01-000007' });
  });

  it('boletaRecibidaDe codifica el origenId en la ruta', () => {
    service.boletaRecibidaDe('a/b c').subscribe();
    const req = httpMock.expectOne(`${LOCAL}/boletas/recibida-de/a%2Fb%20c`);
    req.flush({ recibida: false });
  });

  it('maestroPorId: 200 devuelve la fila y 404 se convierte en null', () => {
    let uno: MaestroLocal | null | undefined;
    let dos: MaestroLocal | null | undefined;
    service.maestroPorId('m-1').subscribe((m) => (uno = m));
    httpMock.expectOne(`${LOCAL}/maestros/m-1`).flush(maestro());

    service.maestroPorId('fantasma').subscribe((m) => (dos = m));
    httpMock.expectOne(`${LOCAL}/maestros/fantasma`).flush('', { status: 404, statusText: 'Not Found' });

    expect(uno).toEqual(maestro());
    expect(dos).toBeNull();
  });

  it('maestroPorId: los errores que no son 404 se propagan', () => {
    let error: HttpErrorResponse | null = null;
    service.maestroPorId('m-5').subscribe({ error: (e) => (error = e) });

    httpMock.expectOne(`${LOCAL}/maestros/m-5`).error(new ProgressEvent('boom'));
    expect(error).not.toBeNull();
    expect(error!.status).toBe(0);
  });

  it('maestroPorCodigo: parámetros codificados en la query', () => {
    let uno: MaestroLocal | null | undefined;
    service.maestroPorCodigo('Piloto', 'PIL 001/x').subscribe((m) => (uno = m));

    // El codec de HttpParams de Angular escapa el espacio (%20) pero deja el
    // slash de valor sin codificar; el server lo decodifica igual.
    const req = httpMock.expectOne(
      `${LOCAL}/maestros/por-codigo?tipoCatalogo=Piloto&codigo=PIL%20001/x`,
    );
    expect(req.request.params.get('tipoCatalogo')).toBe('Piloto');
    expect(req.request.params.get('codigo')).toBe('PIL 001/x');
    req.flush(maestro());

    expect(uno).toEqual(maestro());
  });

  it('maestroPorCodigo: 404 devuelve null', () => {
    let r: MaestroLocal | null | undefined;
    service.maestroPorCodigo('Equipo', 'no-existe').subscribe((m) => (r = m));
    httpMock
      .expectOne(`${LOCAL}/maestros/por-codigo?tipoCatalogo=Equipo&codigo=no-existe`)
      .flush('', { status: 404, statusText: 'Not Found' });

    expect(r).toBeNull();
  });

  it('importarMaestroProvisional: POST /maestros/importar-provisional; 201 y 200 son éxito', () => {
    const input = { id: 'prov-1', tipoCatalogo: 'Piloto', nombre: 'Noviembre' };
    const creados: string[] = [];
    service.importarMaestroProvisional(input).subscribe((m) => creados.push(m.id));

    let req = httpMock.expectOne(`${LOCAL}/maestros/importar-provisional`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(input);
    req.flush(maestro({ id: 'prov-1' }), { status: 201, statusText: 'Created' });

    service.importarMaestroProvisional(input).subscribe((m) => creados.push(m.id));
    req = httpMock.expectOne(`${LOCAL}/maestros/importar-provisional`);
    req.flush(maestro({ id: 'prov-1' })); // 200 = ya existía, también éxito

    expect(creados).toEqual(['prov-1', 'prov-1']);
  });

  it('documenta la recepción duplicada: el 409 de POST /boletas llega con { error, boletaId, numeroBoleta }', () => {
    // El tratamiento UI (mostrar la boleta existente) lo hace la pantalla de
    // recepción después; el servicio solo propaga el error con el cuerpo tal
    // como lo define el contrato del servidor local.
    let error: { status: number; body: Record<string, string> } | null = null;
    service.crearBoleta(crearInput({ boletaOrigenId: 'origen-1' })).subscribe({
      error: (e) => (error = { status: e.status, body: e.error }),
    });

    const req = httpMock.expectOne(`${LOCAL}/boletas`);
    req.flush(
      { error: 'boleta ya recibida', boletaId: 'b-9', numeroBoleta: 'RT-B01-000007' },
      { status: 409, statusText: 'Conflict' },
    );

    expect(error).toEqual({
      status: 409,
      body: { error: 'boleta ya recibida', boletaId: 'b-9', numeroBoleta: 'RT-B01-000007' },
    });
  });
});

