import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { QrClaveService, provideQrClave } from './api/qr-clave.service';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withHashLocation } from '@angular/router';
import { authInterceptor } from './core/auth.interceptor';
import { routes } from './app.routes';
import { es_ES, provideNzI18n } from 'ng-zorro-antd/i18n';
import { registerLocaleData } from '@angular/common';
import es from '@angular/common/locales/es';
import { provideNzDateFnsAdapter } from 'ng-zorro-antd/core/time';
import { provideNzIcons } from 'ng-zorro-antd/icon';
import {
  ApartmentOutline,
  ApiOutline,
  AppstoreOutline,
  BarChartOutline,
  CheckCircleFill,
  CloseCircleFill,
  DashboardOutline,
  DatabaseOutline,
  DeleteOutline,
  DesktopOutline,
  EditOutline,
  ExclamationCircleFill,
  ExportOutline,
  EyeOutline,
  FileTextOutline,
  FormOutline,
  ImportOutline,
  InboxOutline,
  LockOutline,
  MinusCircleFill,
  PlusOutline,
  QrcodeOutline,
  StopOutline,
  SwapOutline,
} from '@ant-design/icons-angular/icons';

registerLocaleData(es);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Hash routing — el renderer de Electron carga desde file:// en
    // producción, sin servidor detrás que resuelva rutas reales.
    provideRouter(routes, withHashLocation()),
    // Sin esto, ng-zorro nunca dispara el callback de "animación terminada"
    // al cerrar un modal — el overlay se queda invisible pero sigue
    // capturando clicks (pointer-events: auto con opacity: 0), bloqueando
    // toda la pantalla hasta recargar. Encontrado cerrando el modal de
    // "Cerrar boleta" en Pesaje, pero afecta a CUALQUIER nz-modal.
    provideAnimationsAsync(),
    provideHttpClient(withInterceptors([authInterceptor])),
    // Clave HMAC del QR de transferencia: se carga una vez al arrancar desde el
    // servidor local. No se espera (void): si está caído o no hay clave, la app
    // arranca igual y el QR sale sin firma.
    provideQrClave(),
    provideAppInitializer(() => {
      void inject(QrClaveService).cargar();
    }),
    provideNzI18n(es_ES),
    provideNzDateFnsAdapter(),
    provideNzIcons([
      ApartmentOutline,
      ApiOutline,
      AppstoreOutline,
      BarChartOutline,
      CheckCircleFill,
      DashboardOutline,
      DatabaseOutline,
      DeleteOutline,
      DesktopOutline,
      EditOutline,
      ExclamationCircleFill,
      ExportOutline,
      EyeOutline,
      FileTextOutline,
      FormOutline,
      ImportOutline,
      InboxOutline,
      LockOutline,
      MinusCircleFill,
      PlusOutline,
      QrcodeOutline,
      StopOutline,
      SwapOutline,
    ]),
  ],
};
