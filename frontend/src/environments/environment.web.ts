import { Environment } from './environment.model';

// Modo admin: build `web` (`ng build --configuration web`). Servido en la web,
// solo contra central. No hay servidor local de Electron detrás, así que
// `localServerUrl` es null y las pantallas que dependen de él (pesaje,
// peso-simulado) quedan fuera de este modo vía `modoGuard` + NAV_ITEMS.
export const environment: Environment = {
  modo: 'admin',
  apiUrl: 'http://localhost:5094',
  localServerUrl: null,
};
