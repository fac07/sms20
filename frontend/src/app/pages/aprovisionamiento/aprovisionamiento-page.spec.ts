import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { NzMessageService } from 'ng-zorro-antd/message';
import { AprovisionamientoPage } from './aprovisionamiento-page';

const LOCAL = 'http://127.0.0.1:4127';

describe('AprovisionamientoPage (TestBed + HttpTestingController)', () => {
  let httpMock: HttpTestingController;
  const message = { error: vi.fn(), success: vi.fn() };
  const router = { navigateByUrl: vi.fn() };

  beforeEach(async () => {
    message.error.mockReset();
    message.success.mockReset();
    router.navigateByUrl.mockReset();
    await TestBed.configureTestingModule({
      imports: [AprovisionamientoPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: NzMessageService, useValue: message },
        { provide: Router, useValue: router },
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    vi.restoreAllMocks();
  });

  function crear() {
    return TestBed.createComponent(AprovisionamientoPage).componentInstance;
  }

  it('no envía nada cuando el código está vacío', () => {
    const page = crear();

    page.aprovisionar();

    httpMock.expectNone(`${LOCAL}/aprovisionamiento`);
    expect(page.codigoCtrl.invalid).toBe(true);
  });

  it('postea el código en mayúsculas y sin espacios, y navega a /pesaje en éxito', () => {
    const page = crear();
    page.codigoCtrl.setValue('  b01-a1b2c3  ');

    page.aprovisionar();
    expect(page.enviando()).toBe(true);

    const req = httpMock.expectOne(`${LOCAL}/aprovisionamiento`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ codigo: 'B01-A1B2C3' });
    req.flush({ basculaId: 'bsc-1', basculaCodigo: 'B01', maestrosDescargados: 42 });

    expect(page.enviando()).toBe(false);
    expect(page.error()).toBeNull();
    expect(message.success).toHaveBeenCalledWith(
      'Báscula B01 aprovisionada — 42 maestros descargados.',
    );
    expect(router.navigateByUrl).toHaveBeenCalledWith('/pesaje');
  });

  it('muestra el mensaje del servidor en error y deja el formulario usable para reintentar', () => {
    const page = crear();
    page.codigoCtrl.setValue('MAL-1');

    page.aprovisionar();
    httpMock
      .expectOne(`${LOCAL}/aprovisionamiento`)
      .flush(
        { error: 'El código de aprovisionamiento no es válido.' },
        { status: 404, statusText: 'Not Found' },
      );

    expect(page.error()).toBe('El código de aprovisionamiento no es válido.');
    expect(page.enviando()).toBe(false);
    expect(router.navigateByUrl).not.toHaveBeenCalled();

    // El formulario sigue usable: un segundo intento vuelve a postear.
    page.codigoCtrl.setValue('B01-OK');
    page.aprovisionar();
    const reintento = httpMock.expectOne(`${LOCAL}/aprovisionamiento`);
    expect(reintento.request.body).toEqual({ codigo: 'B01-OK' });
    expect(page.error()).toBeNull();
    reintento.flush({ basculaId: 'bsc-1', basculaCodigo: 'B01', maestrosDescargados: 0 });
    expect(router.navigateByUrl).toHaveBeenCalledWith('/pesaje');
  });

  it('cae a un mensaje genérico cuando el cuerpo de error no trae texto', () => {
    const page = crear();
    page.codigoCtrl.setValue('B01-X');

    page.aprovisionar();
    httpMock
      .expectOne(`${LOCAL}/aprovisionamiento`)
      .flush(null, { status: 500, statusText: 'Server Error' });

    expect(page.error()).toBe('No se pudo aprovisionar la báscula.');
  });
});
