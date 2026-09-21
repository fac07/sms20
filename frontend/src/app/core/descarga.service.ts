import { Injectable } from '@angular/core';

/**
 * Único punto de la app que dispara descargas de archivos: convierte el
 * contenido en blob, lo cuelga de un `<a download>` sintético y limpia la
 * URL de objeto. Inyectable para poder fakearlo desde los specs sin
 * `vi.mock` de rutas relativas (no soportado por el unit-test builder).
 */
@Injectable({ providedIn: 'root' })
export class DescargaService {
  csv(nombreArchivo: string, contenido: string): void {
    const url = URL.createObjectURL(new Blob([contenido], { type: 'text/csv;charset=utf-8' }));
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = nombreArchivo;
    enlace.click();
    URL.revokeObjectURL(url);
  }
}
