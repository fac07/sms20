import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BoletaDto } from '../../../api/boletas.service';
import { ValorCampoLeidoDto } from '../../../api/configuracion.models';
import { BoletaPrint } from './boleta-print';

function boleta(parcial: Partial<BoletaDto> = {}): BoletaDto {
  return {
    id: 'b-1',
    numeroBoleta: 'IF-B01-000001',
    basculaId: 'ba-1',
    basculaCodigo: 'B01',
    tipoMovimientoId: 'tm-1',
    tipoMovimientoNombre: 'Ingreso de fruta',
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
  template: '<app-boleta-print [boleta]="b" />',
})
class Host {
  b = boleta();
}

describe('BoletaPrint (layout de impresión — sin nz-icon, detectChanges ok)', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
  });

  afterEach(() => {
    document.body.classList.remove('boleta-print-open');
  });

  function setBoleta(b: BoletaDto): void {
    fixture.componentInstance.b = b;
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
    primera.componentInstance.b = boleta();
    primera.detectChanges();
    expect((primera.nativeElement as HTMLElement).textContent).not.toContain('Reimpresiones:');
  });

  it('activa la clase de cuerpo para el CSS de impresión y la limpia al destruir', () => {
    setBoleta(boleta());
    expect(document.body.classList.contains('boleta-print-open')).toBe(true);

    fixture.destroy();
    expect(document.body.classList.contains('boleta-print-open')).toBe(false);
  });
});
