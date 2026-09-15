import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { NzMessageService } from 'ng-zorro-antd/message';
import { environment } from '../../../environments/environment';
import { routes } from '../../app.routes';
import { OutboxPage } from './outbox-page';

const LOCAL = environment.localServerUrl;

const evento = {
  id: 'evt-1',
  secuencia: 1,
  tipoEntidad: 'Boleta' as const,
  entidadId: 'bol-1',
  operacion: 'Crear' as const,
  payload: '{"numeroBoleta":"B-1","valores":[{"campo":"equipo"}]}',
  estado: 'Pendiente' as const,
  intentos: 2,
  ultimoError: 'Central no disponible',
  fechaCreacion: '2026-09-15T10:00:00Z',
  fechaEnviado: null,
};

describe('OutboxPage', () => {
  let httpMock: HttpTestingController;
  const message = { error: vi.fn() };

  beforeEach(async () => {
    message.error.mockReset();
    await TestBed.configureTestingModule({
      imports: [OutboxPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: NzMessageService, useValue: message },
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('lista el outbox local con todas las columnas de diagnóstico y sin acciones de escritura', () => {
    const fixture = TestBed.createComponent(OutboxPage);
    httpMock.expectOne(`${LOCAL}/outbox`).flush([evento]);
    fixture.detectChanges();

    const texto = fixture.nativeElement.textContent;
    for (const columna of [
      'Tipo de entidad',
      'Entidad',
      'Operación',
      'Estado',
      'Intentos',
      'Último error',
      'Fecha de creación',
      'Fecha de envío',
    ]) {
      expect(texto).toContain(columna);
    }
    expect(texto).toContain('Central no disponible');
    expect(texto).not.toMatch(/reintentar|eliminar|despachar/i);
  });

  it('filtra en el servidor usando exclusivamente los estados persistidos reales', () => {
    const fixture = TestBed.createComponent(OutboxPage);
    httpMock.expectOne(`${LOCAL}/outbox`).flush([]);

    expect(fixture.componentInstance.estados).toEqual(['Pendiente', 'Enviado', 'Error']);
    fixture.componentInstance.filtrarPorEstado('Error');

    httpMock.expectOne(`${LOCAL}/outbox?estado=Error`).flush([]);
  });

  it('cancela la solicitud anterior para que una respuesta vieja no reemplace el filtro vigente', () => {
    const fixture = TestBed.createComponent(OutboxPage);
    const solicitudInicial = httpMock.expectOne(`${LOCAL}/outbox`);

    fixture.componentInstance.filtrarPorEstado('Enviado');

    expect(solicitudInicial.cancelled).toBe(true);
    httpMock
      .expectOne(`${LOCAL}/outbox?estado=Enviado`)
      .flush([{ ...evento, id: 'enviado', estado: 'Enviado' }]);
    expect(fixture.componentInstance.eventos().map((item) => item.id)).toEqual(['enviado']);
    expect(fixture.componentInstance.cargando()).toBe(false);
  });

  it('limpia filas obsoletas y finaliza la carga cuando falla el filtro vigente', () => {
    const fixture = TestBed.createComponent(OutboxPage);
    httpMock.expectOne(`${LOCAL}/outbox`).flush([evento]);
    fixture.detectChanges();

    fixture.componentInstance.filtrarPorEstado('Error');
    fixture.detectChanges();

    expect(fixture.componentInstance.eventos()).toEqual([]);
    expect(fixture.componentInstance.cargando()).toBe(true);
    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent).toContain(
      'Cargando tramas',
    );

    httpMock.expectOne(`${LOCAL}/outbox?estado=Error`).flush('error', {
      status: 500,
      statusText: 'Server Error',
    });
    fixture.detectChanges();

    expect(fixture.componentInstance.eventos()).toEqual([]);
    expect(fixture.componentInstance.cargando()).toBe(false);
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain(
      'No se pudieron cargar las tramas',
    );
    expect(message.error).toHaveBeenCalledWith('No se pudo cargar el visor de tramas.');
  });

  it('distingue una respuesta vacía válida de un error de carga', () => {
    const fixture = TestBed.createComponent(OutboxPage);
    httpMock.expectOne(`${LOCAL}/outbox`).flush([]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent).toContain(
      'No hay tramas para mostrar',
    );
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('expande y contrae una fila con click y Enter, exponiendo aria-expanded y JSON indentado', () => {
    const fixture = TestBed.createComponent(OutboxPage);
    httpMock.expectOne(`${LOCAL}/outbox`).flush([evento]);
    fixture.detectChanges();

    const fila = fixture.nativeElement.querySelector('tr.evento') as HTMLTableRowElement;
    expect(fila.getAttribute('aria-expanded')).toBe('false');
    fila.click();
    fixture.detectChanges();

    expect(fila.getAttribute('aria-expanded')).toBe('true');
    const payload = fixture.nativeElement.querySelector('pre.payload')?.textContent;
    expect(payload).toBe(JSON.stringify(JSON.parse(evento.payload), null, 2));
    expect(payload).toContain('\n  "numeroBoleta": "B-1"');

    fila.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();
    expect(fila.getAttribute('aria-expanded')).toBe('false');
    expect(fixture.nativeElement.querySelector('pre.payload')).toBeNull();
  });

  it('conserva sin cambios un payload que no es JSON válido', () => {
    const fixture = TestBed.createComponent(OutboxPage);
    httpMock.expectOne(`${LOCAL}/outbox`).flush([]);

    expect(fixture.componentInstance.formatearPayload('trama legada {incompleta')).toBe(
      'trama legada {incompleta',
    );
  });

  it('muestra placeholders para último error y fecha de envío nulos', () => {
    const fixture = TestBed.createComponent(OutboxPage);
    httpMock.expectOne(`${LOCAL}/outbox`).flush([{ ...evento, ultimoError: null }]);
    fixture.detectChanges();

    const fila = fixture.nativeElement.querySelector('tr.evento') as HTMLTableRowElement;
    expect(fila.querySelector('.error')?.textContent?.trim()).toBe('—');
    expect(fila.cells[7].textContent.trim()).toBe('—');
  });
});

describe('app.routes — visor de tramas', () => {
  it('registra una ruta nueva de báscula bajo el shell', () => {
    const hijos = routes.find((r) => r.path === '' && r.children)?.children ?? [];
    const ruta = hijos.find((r) => r.path === 'outbox');

    expect(ruta?.component).toBe(OutboxPage);
    expect(ruta?.data?.['modo']).toBe('bascula');
    expect(ruta?.canActivate).toBeDefined();
  });
});
