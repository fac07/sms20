import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { NzMessageService } from 'ng-zorro-antd/message';
import { environment } from '../../../../environments/environment';
import { InformeDiarioPage } from './informe-diario-page';

describe('InformeDiarioPage', () => {
  let component: InformeDiarioPage;
  let http: HttpTestingController;
  const message = { error: vi.fn() };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InformeDiarioPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: NzMessageService, useValue: message },
      ],
    }).compileComponents();

    component = TestBed.createComponent(InformeDiarioPage).componentInstance;
    http = TestBed.inject(HttpTestingController);
    http.expectOne(`${environment.apiUrl}/api/tipos-movimiento?incluirInactivos=false`).flush([
      { id: 'tm-1', nombre: 'Ingreso de fruta' },
    ]);
  });

  afterEach(() => http.verify());

  it('consulta el rango seleccionado y calcula el total general', () => {
    component.tipoMovimientoId.setValue('tm-1');
    component.desde.setValue('2026-09-10');
    component.hasta.setValue('2026-09-11');

    component.consultar();

    const request = http.expectOne(
      `${environment.apiUrl}/api/reportes/diario?tipoMovimientoId=tm-1&desde=2026-09-10&hasta=2026-09-11`,
    );
    request.flush([
      { fecha: '2026-09-10', cantidadBoletas: 2, pesoNetoTotal: 125 },
      { fecha: '2026-09-11', cantidadBoletas: 1, pesoNetoTotal: 75 },
    ]);

    expect(component.total()).toEqual({ cantidadBoletas: 3, pesoNetoTotal: 200 });
  });

  it('no consulta cuando faltan filtros requeridos', () => {
    component.consultar();
    http.expectNone((request) => request.url.includes('/api/reportes/diario'));
  });
});
