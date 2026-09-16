import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { Sesion, SesionService } from '../../core/sesion.service';
import { LoginPage } from './login-page';

const SESION_OK: Sesion = {
  usuarioId: 'u-1',
  usuario: 'operador',
  rol: 'Operador',
  centros: ['centro-a'],
  alcance: 'asignado',
};

describe('LoginPage', () => {
  const sesion = { login: vi.fn() };
  const router = { navigateByUrl: vi.fn() };

  beforeEach(async () => {
    sesion.login.mockReset();
    router.navigateByUrl.mockReset();
    await TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [
        { provide: SesionService, useValue: sesion },
        { provide: Router, useValue: router },
      ],
    }).compileComponents();
  });

  function crear() {
    return TestBed.createComponent(LoginPage).componentInstance;
  }

  it('no llama a login() con el formulario vacío', () => {
    const page = crear();

    page.ingresar();

    expect(sesion.login).not.toHaveBeenCalled();
    expect(page.form.invalid).toBe(true);
  });

  it('llama a login(), guarda la sesión y navega al home del modo actual en éxito', () => {
    sesion.login.mockReturnValue(of(SESION_OK));
    const page = crear();
    page.form.setValue({ nombreUsuario: 'operador', clave: 'Operador123!' });

    page.ingresar();

    expect(sesion.login).toHaveBeenCalledWith('operador', 'Operador123!');
    expect(page.enviando()).toBe(false);
    expect(page.error()).toBeNull();
    expect(router.navigateByUrl).toHaveBeenCalledWith(
      environment.modo === 'bascula' ? '/pesaje' : '/tipos-movimiento',
    );
  });

  it('muestra un error de credenciales inválidas en un 401 y no navega', () => {
    sesion.login.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 401, statusText: 'Unauthorized' })),
    );
    const page = crear();
    page.form.setValue({ nombreUsuario: 'operador', clave: 'mal' });

    page.ingresar();

    expect(page.error()).toBe('Usuario o clave incorrectos.');
    expect(page.enviando()).toBe(false);
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });
});
