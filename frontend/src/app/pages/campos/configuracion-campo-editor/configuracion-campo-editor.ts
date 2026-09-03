import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  inject,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzInputNumberModule } from 'ng-zorro-antd/input-number';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { TipoCampo } from '../../../api/configuracion.models';

// Claves de ConfiguracionCampo que aplican a cada TipoCampo. Espejo de
// backend `ValidacionCampo.ClavesPermitidas` — el servidor revalida con
// `ValidacionCampo` / `ConfiguracionCampo.TryParse`, así que este editor es
// solo un adelanto de conveniencia. Lista usa solo `opciones` (subconjunto
// seguro de lo que el backend acepta).
const CLAVES_RELEVANTES: Record<TipoCampo, readonly string[]> = {
  Texto: ['maxLength', 'regex'],
  Entero: ['min', 'max'],
  Decimal: ['min', 'max', 'decimales', 'unidad'],
  Fecha: [],
  FechaHora: [],
  Booleano: [],
  Lista: ['opciones'],
  ReferenciaMaestro: [],
};

interface ConfiguracionForm {
  maxLength: number | null;
  regex: string | null;
  min: number | null;
  max: number | null;
  decimales: number | null;
  unidad: string | null;
  opciones: string[];
}

@Component({
  imports: [
    CommonModule,
    ReactiveFormsModule,
    NzFormModule,
    NzInputModule,
    NzInputNumberModule,
    NzSelectModule,
  ],
  selector: 'app-configuracion-campo-editor',
  styleUrl: './configuracion-campo-editor.css',
  templateUrl: './configuracion-campo-editor.html',
})
export class ConfiguracionCampoEditor implements OnInit, OnChanges, OnDestroy {
  private readonly fb = inject(FormBuilder);

  @Input({ required: true }) tipoCampo!: TipoCampo;
  @Input() value: string | null = null;
  @Output() valueChange = new EventEmitter<string | null>();
  @Output() validChange = new EventEmitter<boolean>();

  private sub?: Subscription;
  private listo = false;

  readonly form = this.fb.group({
    maxLength: this.fb.control<number | null>(null),
    regex: this.fb.control<string | null>(null),
    min: this.fb.control<number | null>(null),
    max: this.fb.control<number | null>(null),
    decimales: this.fb.control<number | null>(null),
    unidad: this.fb.control<string | null>(null),
    opciones: this.fb.nonNullable.control<string[]>([]),
  });

  errorRegex = false;
  errorRango = false;
  errorOpciones = false;

  ngOnInit(): void {
    this.form.patchValue(this.parsear(this.value), { emitEvent: false });
    this.sub = this.form.valueChanges.subscribe(() => this.emitir());
    this.listo = true;
    this.emitir();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (this.listo && changes['tipoCampo'] && !changes['tipoCampo'].firstChange) {
      this.emitir();
    }
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  get clavesRelevantes(): readonly string[] {
    return CLAVES_RELEVANTES[this.tipoCampo] ?? [];
  }

  get sinConfiguracion(): boolean {
    return this.clavesRelevantes.length === 0;
  }

  muestra(clave: string): boolean {
    return this.clavesRelevantes.includes(clave);
  }

  private parsear(raw: string | null): Partial<ConfiguracionForm> {
    if (!raw) return {};
    try {
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') return {};
      return {
        maxLength: typeof obj.maxLength === 'number' ? obj.maxLength : null,
        regex: typeof obj.regex === 'string' ? obj.regex : null,
        min: typeof obj.min === 'number' ? obj.min : null,
        max: typeof obj.max === 'number' ? obj.max : null,
        decimales: typeof obj.decimales === 'number' ? obj.decimales : null,
        unidad: typeof obj.unidad === 'string' ? obj.unidad : null,
        opciones: Array.isArray(obj.opciones)
          ? obj.opciones.filter((o: unknown): o is string => typeof o === 'string')
          : [],
      };
    } catch {
      // JSON malformado — se trata como configuración vacía (el backend
      // igual revalida al guardar).
      return {};
    }
  }

  private emitir(): void {
    const raw = this.form.getRawValue();
    const obj: Record<string, unknown> = {};

    for (const clave of this.clavesRelevantes) {
      if (clave === 'opciones') {
        if (raw.opciones.length > 0) obj['opciones'] = raw.opciones;
        continue;
      }
      const valor = raw[clave as keyof ConfiguracionForm];
      if (valor !== null && valor !== undefined && valor !== '') {
        obj[clave] = valor;
      }
    }

    this.errorRegex = false;
    this.errorRango = false;
    this.errorOpciones = false;

    if (this.tipoCampo === 'Texto' && typeof obj['regex'] === 'string') {
      try {
        RegExp(obj['regex']);
      } catch {
        this.errorRegex = true;
      }
    }

    if (typeof obj['min'] === 'number' && typeof obj['max'] === 'number' && obj['min'] > obj['max']) {
      this.errorRango = true;
    }

    if (this.tipoCampo === 'Lista' && !(Array.isArray(obj['opciones']) && obj['opciones'].length > 0)) {
      this.errorOpciones = true;
    }

    const valido = !this.errorRegex && !this.errorRango && !this.errorOpciones;
    const json = Object.keys(obj).length > 0 ? JSON.stringify(obj) : null;

    this.valueChange.emit(json);
    this.validChange.emit(valido);
  }
}
