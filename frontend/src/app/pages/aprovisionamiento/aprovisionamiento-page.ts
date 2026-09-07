import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { finalize } from 'rxjs';
import { LocalServerService } from '../../api/local-server.service';

// Mensaje por defecto cuando el cuerpo de error del servidor local no trae un
// texto reutilizable — el electron route reenvía el `{ error }` real de Central
// (código inválido / báscula ya aprovisionada / código vencido), así que este
// fallback casi nunca se ve.
const ERROR_GENERICO = 'No se pudo aprovisionar la báscula.';

/** Extrae el mensaje de error que el servidor local reenvía desde Central. */
function mensajeDeError(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    const cuerpo = err.error as { error?: string; message?: string } | string | null;
    if (typeof cuerpo === 'string') return cuerpo.trim() || ERROR_GENERICO;
    return cuerpo?.error ?? cuerpo?.message ?? ERROR_GENERICO;
  }
  return ERROR_GENERICO;
}

/**
 * Pantalla de primer arranque: en una instalación nueva la báscula no está
 * aprovisionada, el guard (`aprovisionamiento.guard.ts`) manda acá y el operador
 * ingresa el código que generó el administrador desde la pantalla de Básculas.
 * Al confirmar hace `POST /aprovisionamiento { codigo }` contra el servidor
 * local de Electron, que a su vez llama a Central, siembra la config de la
 * báscula y baja el snapshot inicial de maestros. En éxito navega a `/pesaje`
 * (el guard re-consulta `GET /estado` y deja pasar).
 *
 * Ruta suelta, fuera del `AppShell` — no lleva nav ni encabezado porque no es
 * un destino de navegación, es una compuerta.
 */
@Component({
  selector: 'app-aprovisionamiento-page',
  imports: [
    ReactiveFormsModule,
    NzAlertModule,
    NzButtonModule,
    NzCardModule,
    NzFormModule,
    NzInputModule,
  ],
  templateUrl: './aprovisionamiento-page.html',
  styleUrl: './aprovisionamiento-page.css',
})
export class AprovisionamientoPage {
  private readonly localServer = inject(LocalServerService);
  private readonly router = inject(Router);
  private readonly message = inject(NzMessageService);

  readonly codigoCtrl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required],
  });

  /** Aprovisionamiento en vuelo — deshabilita el botón y muestra el spinner. */
  readonly enviando = signal(false);

  /** Mensaje de error del último intento fallido (se limpia al reintentar). */
  readonly error = signal<string | null>(null);

  aprovisionar(): void {
    const codigo = this.codigoCtrl.value.trim().toUpperCase();
    if (!codigo || this.enviando()) {
      this.codigoCtrl.markAsDirty();
      this.codigoCtrl.updateValueAndValidity();
      return;
    }

    this.enviando.set(true);
    this.error.set(null);

    this.localServer
      .aprovisionar(codigo)
      .pipe(finalize(() => this.enviando.set(false)))
      .subscribe({
        next: ({ basculaCodigo, maestrosDescargados }) => {
          this.message.success(
            `Báscula ${basculaCodigo} aprovisionada — ${maestrosDescargados} maestros descargados.`,
          );
          void this.router.navigateByUrl('/pesaje');
        },
        error: (err: unknown) => {
          this.error.set(mensajeDeError(err));
        },
      });
  }
}
