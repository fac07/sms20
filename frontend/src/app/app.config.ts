import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, withHashLocation } from '@angular/router';
import { routes } from './app.routes';
import { es_ES, provideNzI18n } from 'ng-zorro-antd/i18n';
import { registerLocaleData } from '@angular/common';
import es from '@angular/common/locales/es';
import { provideNzDateFnsAdapter } from 'ng-zorro-antd/core/time';
import { provideNzIcons } from 'ng-zorro-antd/icon';
import {
  ApiOutline,
  AppstoreOutline,
  BarChartOutline,
  CheckCircleFill,
  DatabaseOutline,
  DesktopOutline,
  EditOutline,
  ExportOutline,
  FileTextOutline,
  ImportOutline,
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
    provideHttpClient(),
    provideNzI18n(es_ES),
    provideNzDateFnsAdapter(),
    provideNzIcons([
      ApiOutline,
      AppstoreOutline,
      BarChartOutline,
      CheckCircleFill,
      DatabaseOutline,
      DesktopOutline,
      EditOutline,
      ExportOutline,
      FileTextOutline,
      ImportOutline,
      MinusCircleFill,
      PlusOutline,
      StopOutline,
      SwapOutline,
    ]),
  ],
};
