import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ProvisionalesStore } from './provisionales-store';

const CENTRAL = 'http://localhost:5094';

describe('ProvisionalesStore', () => {
  let store: ProvisionalesStore;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ProvisionalesStore, provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(ProvisionalesStore);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('arranca en 0', () => {
    expect(store.cantidad()).toBe(0);
  });

  it('refrescar() cuenta la longitud de GET /api/maestros?estado=Provisional', () => {
    store.refrescar();
    const req = httpMock.expectOne(
      `${CENTRAL}/api/maestros?estado=Provisional&incluirInactivos=false`,
    );
    expect(req.request.method).toBe('GET');
    req.flush([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]);
    expect(store.cantidad()).toBe(3);
  });

  it('un poll fallido conserva el último conteo conocido', () => {
    store.fijar(4);
    store.refrescar();
    httpMock
      .expectOne(`${CENTRAL}/api/maestros?estado=Provisional&incluirInactivos=false`)
      .flush('boom', { status: 500, statusText: 'Server Error' });
    expect(store.cantidad()).toBe(4);
  });

  it('fijar() setea el conteo sin pegarle a central', () => {
    store.fijar(7);
    expect(store.cantidad()).toBe(7);
    httpMock.expectNone(`${CENTRAL}/api/maestros?estado=Provisional&incluirInactivos=false`);
  });
});
