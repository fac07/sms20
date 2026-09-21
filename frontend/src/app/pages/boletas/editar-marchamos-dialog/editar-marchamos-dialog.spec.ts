import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../../environments/environment';
import { EditarMarchamosDialog } from './editar-marchamos-dialog';

describe('EditarMarchamosDialog', () => {
  let component: EditarMarchamosDialog;
  let http: HttpTestingController;
  const base = `${environment.apiUrl}/api/boletas/b-1/marchamos`;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EditarMarchamosDialog],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    component = TestBed.createComponent(EditarMarchamosDialog).componentInstance;
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function abrir(): void {
    component.abrir({ id: 'b-1', numeroBoleta: 'B-001' });
    http.expectOne(base).flush({
      rowVersion: 'AQID',
      marchamos: [
        {
          ocurrencia: 0,
          numero: 'M-001',
          placa: 'P-111AAA',
          activo: true,
          observaciones: 'Original',
        },
      ],
    });
  }

  it('loads the grid when opened', () => {
    abrir();

    expect(component.boleta()?.numeroBoleta).toBe('B-001');
    expect(component.marchamos()).toHaveLength(1);
    expect(component.marchamos()[0].numero).toBe('M-001');
  });

  it('requires a change observation before rectifying', () => {
    abrir();

    component.rectificar(component.marchamos()[0]);

    expect(component.error()).toContain('observación');
    http.expectNone(`${base}/0`);
  });

  it('rectifies and refreshes the row version', () => {
    abrir();
    component.observacionCambio.set('Digit corrected');
    component.marchamos.update((rows) => [{ ...rows[0], numero: 'M-010' }]);

    component.rectificar(component.marchamos()[0]);

    const req = http.expectOne(`${base}/0`);
    expect(req.request.body).toEqual({
      numero: 'M-010',
      activo: true,
      observaciones: 'Original',
      observacionCambio: 'Digit corrected',
      rowVersion: 'AQID',
    });
    req.flush({ rowVersion: 'BAUG', marchamos: req.request.body ? [] : [] });
    expect(component.rowVersion()).toBe('BAUG');
  });

  it('adds a new marchamo and clears the form', () => {
    abrir();
    component.nuevoNumero.set('M-002');
    component.nuevaPlaca.set('P-222BBB');
    component.nuevasObservaciones.set('Replacement');
    component.observacionCambio.set('New seal installed');

    component.agregar();

    const req = http.expectOne(base);
    expect(req.request.body).toEqual({
      numero: 'M-002',
      placa: 'P-222BBB',
      activo: true,
      observaciones: 'Replacement',
      observacionCambio: 'New seal installed',
      rowVersion: 'AQID',
    });
    req.flush({ rowVersion: 'BAUG', marchamos: [] });
    expect(component.nuevoNumero()).toBe('');
  });
});
