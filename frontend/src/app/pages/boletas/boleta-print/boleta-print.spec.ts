import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BoletaDto } from '../../../api/boletas.service';
import { ValorCampoLeidoDto } from '../../../api/configuracion.models';
import * as QRCode from 'qrcode';
import { QR_CLAVE_PROVIDER, decodificarQrTransferencia } from '../qr-transferencia/qr-transferencia';
import { BoletaPrint } from './boleta-print';

vi.mock('qrcode', () => ({
  toDataURL: vi.fn(),
}));

function boleta(parcial: Partial<BoletaDto> = {}): BoletaDto {
  return {
    id: 'b-1',
    numeroBoleta: 'IF-B01-000001',
    basculaId: 'ba-1',
    basculaCodigo: 'B01',
    centroCodigo: 'C01',
    tipoMovimientoId: 'tm-1',
    tipoMovimientoNombre: 'Ingreso de fruta',
    generaQR: false,
    estado: 'Cerrada',
    estadoSync: 'SincronizadoCentral',
    pesoIngreso: 20000,
    pesoSalida: 3000,
    pesoNeto: 17000,
    origenPesoIngreso: 'Bascula',
    origenPesoSalida: 'Bascula',
    motivoPesoManual: null,
    motivoPesoManualDetalle: null,
    fechaHoraIngreso: '2026-09-10T12:00:00Z',
    fechaHoraSalida: '2026-09-10T13:00:00Z',
    usuarioIngreso: 'operador',
    usuarioSalida: 'caporal1',
    usuarioAnula: null,
    usuarioAutoriza: null,
    motivoAnulacion: null,
    fechaHoraAnulacion: null,
    boletaReemplazoId: null,
    boletaOrigenId: null,
    basculaSalidaId: null,
    preIngresoId: null,
    preIngresoNumeroEnvio: null,
    preIngresoEstado: null,
    marcaPreIngreso: null,
    respuestaD365Id: null,
    creadaOffline: false,
    valores: [],
    ...parcial,
  } as BoletaDto;
}

function valor(parcial: Partial<ValorCampoLeidoDto> &
  Pick<ValorCampoLeidoDto, 'campoId' | 'seccionClave' | 'campoClave'>): ValorCampoLeidoDto {
  return {
    seccionNombre: '',
    etiqueta: parcial.campoClave,
    tipoCampo: 'Texto',
    ocurrencia: 0,
    valorTexto: 'x',
    ...parcial,
  } as ValorCampoLeidoDto;
}

// Envoltorio mínimo: input requerido en plantillas necesita host declarado.
@Component({
  imports: [BoletaPrint],
  template: '<app-boleta-print [boleta]="b()" />',
})
class Host {
  b = signal(boleta());
}

describe('BoletaPrint (layout de impresión — sin nz-icon, detectChanges ok)', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    vi.mocked(QRCode.toDataURL).mockImplementation(
      (async () => 'data:image/png;base64,qr-b-1') as typeof QRCode.toDataURL,
    );
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
  });

  afterEach(() => {
    document.body.classList.remove('boleta-print-open');
    vi.clearAllMocks();
  });

  // El QR se arma en dos pasos async (codec + renderer): esperar a que aparezca la imagen.
  async function esperarQr(): Promise<void> {
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).querySelector('.boleta-qr img')).not.toBeNull();
    });
  }

  function setBoleta(b: BoletaDto): void {
    fixture.componentInstance.b.set(b);
    fixture.detectChanges();
  }

  it('encabeza con los campos fijos de la boleta', () => {
    setBoleta(boleta());
    const texto = (fixture.nativeElement as HTMLElement).textContent!;

    expect(texto).toContain('IF-B01-000001');
    expect(texto).toContain('B01');
    expect(texto).toContain('Ingreso de fruta');
    expect(texto).toContain('Cerrada');
    expect(texto).toContain('20000');
    expect(texto).toContain('3000');
    expect(texto).toContain('17000');
    expect(texto).toContain('operador');
    expect(texto).toContain('caporal1');
  });

  it('pliega las secciones EAV agrupadas con valor legible por campo', () => {
    setBoleta(
      boleta({
        valores: [
          valor({ campoId: 'a', seccionClave: 'calidad', seccionNombre: 'Calidad', campoClave: 'acidez', etiqueta: 'Acidez (%)', tipoCampo: 'Decimal', valorTexto: null, valorNumero: 3.2 }),
          valor({ campoId: 'p', seccionClave: 'transporte', seccionNombre: 'Transporte', campoClave: 'piloto', etiqueta: 'Piloto', valorTexto: null, valorMaestroNombre: 'Ana Pérez' }),
        ],
      }),
    );
    const texto = (fixture.nativeElement as HTMLElement).textContent!;

    expect(texto).toContain('Calidad');
    expect(texto).toContain('Acidez (%)');
    expect(texto).toContain('3.2');
    expect(texto).toContain('Transporte');
    expect(texto).toContain('Ana Pérez');
  });

  it('diferencia ocurrencias en secciones repetibles', () => {
    setBoleta(
      boleta({
        valores: [
          valor({ campoId: 'm0', seccionClave: 'marchamos', seccionNombre: 'Marchamos', campoClave: 'numero', etiqueta: 'Número de marchamo', valorTexto: 'M-0' }),
          valor({ campoId: 'm1', seccionClave: 'marchamos', campoClave: 'numero', etiqueta: 'Número de marchamo', valorTexto: 'M-1', ocurrencia: 1 }),
        ],
      }),
    );
    const texto = (fixture.nativeElement as HTMLElement).textContent!;

    expect(texto).toContain('M-0');
    expect(texto).toContain('M-1');
    expect(texto).toMatch(/#1[\s\S]*#2|Ocurrencia 1[\s\S]*Ocurrencia 2/);
  });

  it('muestra el rastro de reimpresión solo cuando hubo reimpresiones', () => {
    setBoleta(boleta({ cantidadReimpresiones: 2, ultimaReimpresionUsuario: 'operador2' } as Partial<BoletaDto>));
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Reimpresiones: 2');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('operador2');

    const primera = TestBed.createComponent(Host);
    primera.componentInstance.b.set(boleta());
    primera.detectChanges();
    expect((primera.nativeElement as HTMLElement).textContent).not.toContain('Reimpresiones:');
  });

  it('genera y muestra el QR con el payload firmable versionado de la boleta', async () => {
    setBoleta(boleta({ id: '8c263238-d3f3-4be0-9945-3a86fd953a19', generaQR: true }));
    await esperarQr();

    const [texto, opciones] = vi.mocked(QRCode.toDataURL).mock.calls[0] as unknown as [string, { errorCorrectionLevel: string }];
    expect(opciones.errorCorrectionLevel).toBe('L');
    const decodificado = await decodificarQrTransferencia(texto);
    expect(decodificado.ok && decodificado.payload.b).toBe('8c263238-d3f3-4be0-9945-3a86fd953a19');
    expect(decodificado.ok && decodificado.payload.ce).toBe('C01');
    expect(decodificado.ok && decodificado.firma).toBe('ausente'); // hoy no hay clave

    const imagen = (fixture.nativeElement as HTMLElement).querySelector<HTMLImageElement>(
      '.boleta-qr img',
    );
    expect(imagen?.src).toBe('data:image/png;base64,qr-b-1');
  });

  it('firma el payload cuando el proveedor entrega clave', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [Host],
      providers: [{ provide: QR_CLAVE_PROVIDER, useValue: () => 'clave-de-prueba' }],
    }).compileComponents();
    fixture = TestBed.createComponent(Host);

    setBoleta(boleta({ generaQR: true }));
    await esperarQr();

    const texto = vi.mocked(QRCode.toDataURL).mock.calls[0][0] as unknown as string;
    const decodificado = await decodificarQrTransferencia(texto, 'clave-de-prueba');
    expect(decodificado.ok && decodificado.firma).toBe('valida');
  });

  it('descarta el QR de una boleta anterior si la boleta cambió mientras se generaba', async () => {
    const pendientes: Array<(dataUrl: string) => void> = [];
    vi.mocked(QRCode.toDataURL).mockImplementation(
      (() => new Promise<string>((resolver) => pendientes.push(resolver))) as unknown as typeof QRCode.toDataURL,
    );

    setBoleta(boleta({ id: 'vieja', generaQR: true }));
    await vi.waitFor(() => expect(pendientes).toHaveLength(1));
    setBoleta(boleta({ id: 'nueva', generaQR: true }));
    await vi.waitFor(() => expect(pendientes).toHaveLength(2));

    pendientes[1]('data:image/png;base64,nueva');
    pendientes[0]('data:image/png;base64,vieja'); // llega tarde
    await fixture.whenStable();
    fixture.detectChanges();

    const imagen = (fixture.nativeElement as HTMLElement).querySelector<HTMLImageElement>('.boleta-qr img');
    expect(imagen?.src).toBe('data:image/png;base64,nueva');
  });

  it('no genera ni renderiza el bloque QR cuando el tipo no lo habilita', async () => {
    setBoleta(boleta({ generaQR: false }));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(QRCode.toDataURL).not.toHaveBeenCalled();
    expect((fixture.nativeElement as HTMLElement).querySelector('.boleta-qr')).toBeNull();
  });

  it('activa la clase de cuerpo para el CSS de impresión y la limpia al destruir', () => {
    setBoleta(boleta());
    expect(document.body.classList.contains('boleta-print-open')).toBe(true);

    fixture.destroy();
    expect(document.body.classList.contains('boleta-print-open')).toBe(false);
  });
});
