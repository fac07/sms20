import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../../environments/environment';
import { Modo } from '../../../../environments/environment.model';
import { CampoAplicable, ValorCampoLeidoDto } from '../../../api/configuracion.models';
import { TipoMovimiento } from '../../../api/tipos-movimiento.service';
import { TrasegarBoletaDialog } from './trasegar-boleta-dialog';

const BASE = `${environment.apiUrl}/api`;

function tipo(parcial: Partial<TipoMovimiento> & Pick<TipoMovimiento, 'id' | 'nombre'>): TipoMovimiento {
  return {
    codigo: parcial.id,
    prefijo: 'X',
    direccion: 'Salida',
    operacionD365: null,
    generaQR: false,
    formatoBoletaId: null,
    activo: true,
    ...parcial,
  };
}

function campo(parcial: Partial<CampoAplicable> & Pick<CampoAplicable, 'campoId' | 'campoClave'>): CampoAplicable {
  return {
    seccionId: 'sec-1',
    seccionClave: parcial.seccionClave ?? 'transporte',
    etiqueta: parcial.campoClave,
    tipoCampo: 'Texto',
    tipoCatalogoRef: null,
    requerido: false,
    cardinalidad: 'Unica',
    seccionRequerida: false,
    configuracion: null,
    orden: 0,
    seccionOrden: 0,
    seccionEtiqueta: '',
    ...parcial,
  };
}

function valor(
  parcial: Partial<ValorCampoLeidoDto> & Pick<ValorCampoLeidoDto, 'seccionClave' | 'campoClave'>,
): ValorCampoLeidoDto {
  return {
    campoId: `origen.${parcial.seccionClave}.${parcial.campoClave}`,
    seccionNombre: '',
    etiqueta: parcial.campoClave,
    tipoCampo: 'Texto',
    ocurrencia: 0,
    ...parcial,
  };
}

describe('TrasegarBoletaDialog', () => {
  let component: TrasegarBoletaDialog;
  let http: HttpTestingController;
  const modoOriginal = environment.modo;

  function setModo(modo: Modo): void {
    (environment as { modo: Modo }).modo = modo;
  }

  beforeEach(async () => {
    setModo('admin');
    await TestBed.configureTestingModule({
      imports: [TrasegarBoletaDialog],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    component = TestBed.createComponent(TrasegarBoletaDialog).componentInstance;
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    setModo(modoOriginal);
  });

  // `incluirInactivos=false` en la querystring ya filtra del lado del backend
  // (mismo contrato que el resto de la app) — el mock solo simula esa
  // respuesta ya filtrada, no re-testea el filtro del servidor.
  function abrir(valores: ValorCampoLeidoDto[] = []) {
    component.abrir({ id: 'b-1', numeroBoleta: 'TRF-N01-000001', valores });
    http
      .expectOne(`${BASE}/tipos-movimiento?incluirInactivos=false`)
      .flush([
        tipo({ id: 'tm-transferencia', nombre: 'Otra transferencia', direccion: 'Transferencia' }),
        tipo({ id: 'tm-salida', nombre: 'Salida MP y Graneles', direccion: 'Salida' }),
      ]);
  }

  it('al abrir, carga los tipos destino excluyendo transferencias', () => {
    abrir();

    expect(component.destinos().map((t: TipoMovimiento) => t.id)).toEqual(['tm-salida']);
  });

  it('elegir un destino carga su formulario y arma la vista previa del mapeo', () => {
    abrir([valor({ seccionClave: 'transporte', campoClave: 'placa', valorTexto: 'P-1' })]);

    component.seleccionarDestino('tm-salida');
    http
      .expectOne(`${BASE}/tipos-movimiento/tm-salida/formulario`)
      .flush([campo({ campoId: 'd-placa', seccionClave: 'transporte', campoClave: 'placa' })]);

    expect(component.preview()?.valores).toEqual([
      { campoId: 'd-placa', ocurrencia: 0, valorTexto: 'P-1' },
    ]);
  });

  it('avisa qué campos requeridos del destino quedan sin valor, sin bloquear el envío', () => {
    abrir([]);

    component.seleccionarDestino('tm-salida');
    http
      .expectOne(`${BASE}/tipos-movimiento/tm-salida/formulario`)
      .flush([campo({ campoId: 'd-orden', campoClave: 'orden_despacho', requerido: true })]);

    expect(
      component.preview()?.requeridosSinValor.map((c: CampoAplicable) => c.campoId),
    ).toEqual(['d-orden']);
  });

  it('confirmar sin destino, número, usuario o motivo no envía nada', () => {
    abrir();
    component.confirmar();
    expect(component.error()).toBeTruthy();
  });

  it('confirmar envía el trasiego con los valores mapeados y limpia al terminar', () => {
    const valores = [valor({ seccionClave: 'transporte', campoClave: 'placa', valorTexto: 'P-1' })];
    abrir(valores);
    component.seleccionarDestino('tm-salida');
    http
      .expectOne(`${BASE}/tipos-movimiento/tm-salida/formulario`)
      .flush([campo({ campoId: 'd-placa', seccionClave: 'transporte', campoClave: 'placa' })]);

    component.numeroBoleta.set('TRS-N01-000001');
    component.usuarioAutoriza.set('supervisor@naturaceites.com');
    component.motivoTrasiego.set('Se convierte a salida de MP y graneles');
    let emitido: unknown;
    component.trasegado.subscribe((dto: unknown) => (emitido = dto));
    component.confirmar();

    const req = http.expectOne(`${BASE}/boletas/b-1/trasegar`);
    expect(req.request.body).toEqual({
      tipoMovimientoDestinoId: 'tm-salida',
      numeroBoleta: 'TRS-N01-000001',
      usuarioAutoriza: 'supervisor@naturaceites.com',
      motivoTrasiego: 'Se convierte a salida de MP y graneles',
      valores: [{ campoId: 'd-placa', ocurrencia: 0, valorTexto: 'P-1' }],
    });
    req.flush({ id: 'nueva', numeroBoleta: 'TRS-N01-000001' });

    expect(emitido).toEqual({ id: 'nueva', numeroBoleta: 'TRS-N01-000001' });
    expect(component.boleta()).toBeNull();
  });

  it('un 409/422 del servidor se muestra y no cierra el diálogo', () => {
    abrir();
    component.seleccionarDestino('tm-salida');
    http.expectOne(`${BASE}/tipos-movimiento/tm-salida/formulario`).flush([]);
    component.numeroBoleta.set('TRS-1');
    component.usuarioAutoriza.set('sup');
    component.motivoTrasiego.set('motivo');

    component.confirmar();
    http
      .expectOne(`${BASE}/boletas/b-1/trasegar`)
      .flush('La boleta ya fue reemplazada.', { status: 409, statusText: 'Conflict' });

    expect(component.error()).toBeTruthy();
    expect(component.boleta()).not.toBeNull();
  });

  it('cerrar limpia el estado', () => {
    abrir();
    component.cerrar();
    expect(component.boleta()).toBeNull();
  });
});
