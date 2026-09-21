import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../environments/environment';
import { QR_CLAVE_PROVIDER } from '../pages/boletas/qr-transferencia/qr-transferencia';
import { QrClaveService, provideQrClave } from './qr-clave.service';

const URL_CLAVE = `${environment.localServerUrl}/qr-clave`;

describe('QrClaveService', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideQrClave()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('arranca sin clave y la expone cuando el servidor local responde', async () => {
    const servicio = TestBed.inject(QrClaveService);
    expect(servicio.clave()).toBeNull();

    const carga = servicio.cargar();
    http.expectOne(URL_CLAVE).flush({ clave: 'clave-base64' });
    await carga;

    expect(servicio.clave()).toBe('clave-base64');
  });

  it('una terminal sin clave (clave: null) queda en null', async () => {
    const servicio = TestBed.inject(QrClaveService);

    const carga = servicio.cargar();
    http.expectOne(URL_CLAVE).flush({ clave: null });
    await carga;

    expect(servicio.clave()).toBeNull();
  });

  it('ante un error del servidor local queda en null, sin lanzar', async () => {
    const servicio = TestBed.inject(QrClaveService);

    const carga = servicio.cargar();
    http.expectOne(URL_CLAVE).flush('caido', { status: 502, statusText: 'Bad Gateway' });

    await expect(carga).resolves.toBeUndefined();
    expect(servicio.clave()).toBeNull();
  });

  it('carga una sola vez aunque se invoque de nuevo', async () => {
    const servicio = TestBed.inject(QrClaveService);

    const primera = servicio.cargar();
    http.expectOne(URL_CLAVE).flush({ clave: 'k' });
    await primera;
    await servicio.cargar();

    http.expectNone(URL_CLAVE);
  });

  it('en modo web (sin servidor local) no hace ninguna request y queda en null', async () => {
    const original = environment.localServerUrl;
    (environment as { localServerUrl: string | null }).localServerUrl = null;
    try {
      const servicio = TestBed.inject(QrClaveService);
      await servicio.cargar();

      http.expectNone(() => true);
      expect(servicio.clave()).toBeNull();
    } finally {
      (environment as { localServerUrl: string | null }).localServerUrl = original;
    }
  });

  it('QR_CLAVE_PROVIDER entrega la clave vigente del servicio', async () => {
    const servicio = TestBed.inject(QrClaveService);
    const proveedor = TestBed.inject(QR_CLAVE_PROVIDER);
    expect(proveedor()).toBeNull();

    const carga = servicio.cargar();
    http.expectOne(URL_CLAVE).flush({ clave: 'clave-base64' });
    await carga;

    expect(proveedor()).toBe('clave-base64');
  });
});
