import { Environment } from './environment.model';

// Modo báscula: build por defecto (`ng build`, sin `--configuration web`).
// Se empaqueta en Electron (`build:app`); el pesaje corre offline contra el
// servidor local. El build `web` reemplaza este archivo por `environment.web.ts`.
export const environment: Environment = {
  modo: 'bascula',
  apiUrl: 'http://localhost:5094',
  localServerUrl: 'http://127.0.0.1:4127',
};
