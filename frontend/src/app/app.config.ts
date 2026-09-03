import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, withHashLocation } from '@angular/router';
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
  DashboardOutline,
  DatabaseOutline,
  DeleteOutline,
  DesktopOutline,
  EditOutline,
  ExportOutline,
  EyeOutline,
  FileTextOutline,
  FormOutline,
  ImportOutline,
  LockOutline,
  MinusCircleFill,
  PlusOutline,
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
    provideHttpClient(),
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
      ExportOutline,
      EyeOutline,
      FileTextOutline,
      FormOutline,
      ImportOutline,
      LockOutline,
      MinusCircleFill,
      PlusOutline,
      StopOutline,
      SwapOutline,
    ]),
  ],
};
