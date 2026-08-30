# SMS 2.0

Rediseño desde cero del sistema de control de báscula de Naturaceites (reemplaza `NAT_Basculas`, WinForms + .NET Framework 4.7.2).

Esquema de datos y decisiones de diseño: [documento vivo](https://claude.ai/code/artifact/ee209896-8ae8-422d-a9f8-da994fcb7184).

## Estructura

```
frontend/    React + Vite + TypeScript, empaquetado con Electron.
             La UI (renderer) no toca SQLite ni el puerto serial directo —
             le pide todo a un servidor HTTP local (127.0.0.1) que corre en
             el proceso principal de Electron. Mismo contrato online/offline.
             - electron/main.ts     proceso principal, ventana + arranque del server local
             - electron/local-server.ts  servidor HTTP local (Express)
             - electron/db.ts       SQLite embebida (better-sqlite3)
             - electron/preload.ts  contextBridge — puente mínimo hacia el renderer
backend/     .NET 8 Web API — sync central, outbox, integración D365
SMS20.slnx   Solución .NET (backend)
```

No hay un proceso separado para leer la báscula — esa lógica vive dentro del proceso principal de Electron (`electron/`), no en un servicio aparte. Antes de esta versión existía `agente-bascula/` como Worker Service .NET independiente; se dio de baja al confirmar la arquitectura real (Electron + IPC/servidor local, sin proceso separado).

## Requisitos

- Node.js 20+
- .NET 8 SDK

## Correr cada parte

```bash
# Frontend + Electron (dev)
cd frontend && npm install && npm run dev

# Backend
cd backend && dotnet run
```

`npm run build:app` empaqueta el instalador de escritorio con `electron-builder` (`postinstall` corre `electron-rebuild` para que `better-sqlite3` quede compilado contra el Node ABI de Electron, no el del sistema).

## Aprovisionamiento de báscula (primer arranque)

Cada instalación de báscula se identifica con un código corto de un solo uso, generado por el admin al pre-registrar la báscula en el panel central. Al primer arranque, el operador escribe ese código; la app lo cambia por la config completa de esa báscula (conexión serial/Ethernet, centro, impresora) más el snapshot inicial de `Maestro`, y queda operando offline desde ahí. Ver sección "Aprovisionamiento" del esquema de datos — el endpoint real (`POST /aprovisionamiento`) todavía es un placeholder en `electron/local-server.ts`.

## Pendiente antes de implementar sync D365

El contrato real de payloads hacia D365 (`DatosIngresoFruta`, `DatosOrdenCompraRecepcion`, `DatosOrdenVentaSalida`, `DatosTransferenciaCrear/Recibir`) vive en los repos legacy `naturaceites-sincronizacion-sms` (`SyncSMS.API`) y `naturaceites-sms-winservice` (`WS_ProcesoAutomatico`) — ya revisado y aplicado al esquema (`OutboxD365.TipoOperacion`).

**Seguridad — antes de tocar `naturaceites-sms-api` (NAT_API_Interfaces_365) para migrar su lógica**: ese repo tiene credenciales en texto plano committeadas (password de SQL Server + client secret de Azure AD, sin gitignore), cero autenticación en sus endpoints, y no valida la respuesta de D365 antes de devolver 200 OK. Rotar credenciales y limpiar el historial de git antes de que ese código (o su historial) toque un remoto compartido.
