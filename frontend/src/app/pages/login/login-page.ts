import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCardModule } from 'ng-zorro-antd/card';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzInputModule } from 'ng-zorro-antd/input';
import { finalize } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Modo } from '../../../environments/environment.model';
import { SesionService } from '../../core/sesion.service';

const ERROR_GENERICO = 'No se pudo iniciar sesión.';
const ERROR_CREDENCIALES = 'Usuario o clave incorrectos.';

/**
 * Home por modo al loguearse. Duplica intencionalmente `HOME_POR_MODO` de
 * `modo.guard.ts` (no exportado ahí): esta página todavía no está enlazada
 * a ninguna ruta protegida (PR9 hace esa conexión junto con `rolGuard`), y
 * tocar `modo.guard.ts`/su spec está fuera del alcance de este PR.
 */
const HOME_POR_MODO: Record<Modo, string> = {
  bascula: '/pesaje',
  admin: '/tipos-movimiento',
};

/** Traduce el error de `SesionService.login()` a un mensaje mostrable. */
function mensajeDeError(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 401) return ERROR_CREDENCIALES;
    const cuerpo = err.error as { error?: string; message?: string } | string | null;
    if (typeof cuerpo === 'string') return cuerpo.trim() || ERROR_GENERICO;
    return cuerpo?.error ?? cuerpo?.message ?? ERROR_GENERICO;
  }
  return ERROR_GENERICO;
}

/**
 * Página de login mock (design D3). Formulario usuario/clave contra
 * `SesionService.login()` — en éxito navega al home del modo activo del
 * build; un 401 muestra "Usuario o clave incorrectos" y deja el formulario
 * usable para reintentar. Ruta suelta, sin enlazar todavía a ningún guard
 * de rutas real: PR9 la conecta al flujo protegido junto con `rolGuard`.
 */
@Component({
  selector: 'app-login-page',
  imports: [
    ReactiveFormsModule,
    NzAlertModule,
    NzButtonModule,
    NzCardModule,
    NzFormModule,
    NzInputModule,
  ],
  templateUrl: './login-page.html',
  styleUrl: './login-page.css',
})
export class LoginPage {
  private readonly sesion = inject(SesionService);
  private readonly router = inject(Router);

  readonly form = new FormGroup({
    nombreUsuario: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    clave: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  /** Login en vuelo — deshabilita el formulario y muestra el spinner. */
  readonly enviando = signal(false);

  /** Mensaje de error del último intento fallido (se limpia al reintentar). */
  readonly error = signal<string | null>(null);

  ingresar(): void {
    if (this.form.invalid || this.enviando()) {
      this.form.markAllAsTouched();
      return;
    }

    const { nombreUsuario, clave } = this.form.getRawValue();
    this.enviando.set(true);
    this.error.set(null);

    this.sesion
      .login(nombreUsuario, clave)
      .pipe(finalize(() => this.enviando.set(false)))
      .subscribe({
        next: () => {
          void this.router.navigateByUrl(HOME_POR_MODO[environment.modo]);
        },
        error: (err: unknown) => {
          this.error.set(mensajeDeError(err));
        },
      });
  }
}
