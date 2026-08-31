import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { catchError, of } from 'rxjs';

// Servidor LOCAL de Electron (127.0.0.1:4127) — no confundir con el backend
// central (http://localhost:5094) que usan los demás servicios de src/app/api.
const LOCAL_SERVER_URL = 'http://127.0.0.1:4127';

type OrigenPeso = 'Bascula' | 'Manual';

interface LecturaPeso {
  peso: number | null;
  origen: OrigenPeso | null;
}

interface EstadoLocal {
  aprovisionada: boolean;
  basculaId: string | null;
  dev: boolean;
}

const POLL_MS = 2000;
const CLAVE_MINIMIZADO = 'sms20:peso-simulado-panel:minimizado';

/**
 * Panel flotante solo-dev: deja fijar "a mano" lo que la báscula está
 * pesando, para probar el flujo de pesaje sin hardware conectado. Se
 * automonta en app-shell y no renderiza nada si no está corriendo dentro de
 * Electron en modo desarrollo (el fetch a /estado falla o dev es false).
 */
@Component({
  imports: [CommonModule],
  selector: 'app-peso-simulado-panel',
  styleUrl: './peso-simulado-panel.css',
  templateUrl: './peso-simulado-panel.html',
})
export class PesoSimuladoPanel implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);

  readonly visible = signal(false);
  readonly pesoInput = signal<number | null>(null);
  readonly lectura = signal<LecturaPeso>({ peso: null, origen: null });
  // Recuerda si el panel estaba minimizado — tapa parte de la pantalla y no
  // hace falta perder ese estado cada vez que se recarga.
  readonly minimizado = signal(localStorage.getItem(CLAVE_MINIMIZADO) === '1');

  private intervalId: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.http
      .get<EstadoLocal>(`${LOCAL_SERVER_URL}/estado`)
      .pipe(catchError(() => of(null)))
      .subscribe((estado) => {
        if (!estado?.dev) return;

        this.visible.set(true);
        this.actualizarLectura();
        this.intervalId = setInterval(() => this.actualizarLectura(), POLL_MS);
      });
  }

  ngOnDestroy(): void {
    if (this.intervalId !== null) clearInterval(this.intervalId);
  }

  onInputChange(event: Event): void {
    const valor = (event.target as HTMLInputElement).value;
    this.pesoInput.set(valor === '' ? null : Number(valor));
  }

  enviar(origen: OrigenPeso): void {
    const peso = this.pesoInput();
    if (peso === null || !Number.isFinite(peso)) return;

    this.http
      .post<LecturaPeso>(`${LOCAL_SERVER_URL}/peso-simulado`, { peso, origen })
      .pipe(catchError(() => of(null)))
      .subscribe((lectura) => {
        if (lectura) this.lectura.set(lectura);
      });
  }

  alternarMinimizado(): void {
    const nuevo = !this.minimizado();
    this.minimizado.set(nuevo);
    localStorage.setItem(CLAVE_MINIMIZADO, nuevo ? '1' : '0');
  }

  private actualizarLectura(): void {
    this.http
      .get<LecturaPeso>(`${LOCAL_SERVER_URL}/peso`)
      .pipe(catchError(() => of(null)))
      .subscribe((lectura) => {
        if (lectura) this.lectura.set(lectura);
      });
  }
}
