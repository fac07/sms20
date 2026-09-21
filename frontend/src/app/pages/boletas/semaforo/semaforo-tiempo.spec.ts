import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNzIcons } from 'ng-zorro-antd/icon';
import { NzTooltipDirective } from 'ng-zorro-antd/tooltip';
import {
  CheckCircleFill,
  CloseCircleFill,
  ExclamationCircleFill,
} from '@ant-design/icons-angular/icons';
import { SemaforoTiempo } from './semaforo-tiempo';

// Host mínimo: `duracionMs` es input requerido en plantilla.
@Component({
  imports: [SemaforoTiempo],
  template: '<app-semaforo-tiempo [duracionMs]="ms" />',
})
class Host {
  ms = 0;
}

describe('SemaforoTiempo — ícono + color + texto + tooltip (no solo color)', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    // Los íconos se registran estáticos (como en app.config): así el render
    // resuelve el SVG desde el pool y no dispara el fetch HTTP que rompe
    // `httpMock.verify()` en otros specs de la app.
    await TestBed.configureTestingModule({
      imports: [Host],
      providers: [provideNzIcons([CheckCircleFill, ExclamationCircleFill, CloseCircleFill])],
    }).compileComponents();

    fixture = TestBed.createComponent(Host);
  });

  function render(ms: number) {
    fixture.componentInstance.ms = ms;
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement.querySelector('.semaforo');
    // En ng-zorro v22 la propiedad en instancia es `title`; `nzTooltipTitle`
    // es solo el alias del template.
    const tooltip = fixture.debugElement
      .query(By.directive(NzTooltipDirective))!
      .injector.get(NzTooltipDirective) as unknown as { title: string };
    return { el, tooltip: tooltip.title };
  }

  it('verde: clase, ícono check-circle, texto con la duración y tooltip descriptivo', () => {
    const { el, tooltip } = render(3 * 3_600_000 + 31 * 60_000 + 49_000);

    expect(el.classList).toContain('semaforo--verde');
    expect(el.querySelector('.semaforo__icono')).toBeTruthy();
    expect(el.querySelector('.semaforo__texto')!.textContent?.trim()).toBe('0.03:31:49');
    expect(tooltip).toContain('0.03:31:49');
    expect(tooltip).toContain('verde');
  });

  it('amarillo a las 16 h + 1 s, con el rango en el tooltip', () => {
    const { el, tooltip } = render(16 * 3_600_000 + 1_000);

    expect(el.classList).toContain('semaforo--amarillo');
    expect(el.querySelector('.semaforo__texto')!.textContent?.trim()).toBe('0.16:00:01');
    expect(tooltip).toContain('amarillo');
  });

  it('rojo pasadas las 24 h y accesible: aria-label igual al tooltip', () => {
    const { el, tooltip } = render(27 * 3_600_000 + 13 * 60_000 + 49_000);

    expect(el.classList).toContain('semaforo--rojo');
    expect(el.querySelector('.semaforo__texto')!.textContent?.trim()).toBe('1.03:13:49');
    expect(el.getAttribute('aria-label')).toBe(tooltip);
  });
});
