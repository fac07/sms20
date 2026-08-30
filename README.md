# SMS 2.0

Rediseño desde cero del sistema de control de báscula de Naturaceites (reemplaza `NAT_Basculas`, WinForms + .NET Framework 4.7.2).

Esquema de datos y decisiones de diseño: [documento vivo](https://claude.ai/code/artifact/ee209896-8ae8-422d-a9f8-da994fcb7184).

## Estructura

```
frontend/    Angular + ng-zorro-antd, empaquetado con Electron. Confirmado
             contra la diapositiva "Solución propuesta" del kickoff — el
             stack acordado con NAT es Angular, no otro framework.
             La UI (renderer) no toca SQLite ni el puerto serial directo —
             le pide todo a un servidor HTTP local (127.0.0.1) que corre en
             el proceso principal de Electron. Mismo contrato online/offline.
             - electron/main.ts     proceso principal, ventana + arranque del server local
             - electron/local-server.ts  servidor HTTP local (Express)
             - electron/db.ts       SQLite embebida (better-sqlite3)
             - electron/preload.ts  contextBridge — puente mínimo hacia el renderer
             - src/app/pages/       pantallas standalone (ng-zorro-antd)
             - src/app/layout/      AppShell — sidebar + header, sin nada de Electron adentro
             - src/app/api/         servicios HttpClient contra el backend central
backend/     .NET 8 Web API — sync central, outbox, integración D365
             - Domain/TiposMovimiento/  catálogo configurable de tipos de
               movimiento (entidad EF Core, config, DTOs, endpoints)
             - Domain/Maestros/         catálogo genérico (piloto, transportista,
               equipo, producto, tercero, finca, almacén, centro) +
               flujo de ítems provisionales (Aprobar / Fusionar)
             - Data/                    SmsDbContext + migraciones
SMS20.slnx   Solución .NET (backend)
```

Los archivos de `electron/` son TypeScript/Node puro — no dependen de si el renderer es React o Angular, así que sobrevivieron intactos al cambio de framework (`electron:compile` los compila aparte con `tsc`, sin pasar por el build de Angular).

No hay un proceso separado para leer la báscula — esa lógica vive dentro del proceso principal de Electron (`electron/`), no en un servicio aparte. Antes de esta versión existía `agente-bascula/` como Worker Service .NET independiente; se dio de baja al confirmar la arquitectura real (Electron + servidor local, sin proceso separado).

## Requisitos

- Node.js 20+
- .NET 8 SDK
- Docker (para la base de datos local — ver abajo)

## Base de datos local (Docker)

IT todavía no nos dio el SQL Server central — hasta que lo tengamos, se trabaja contra un contenedor local.

```bash
docker compose up -d
```

Levanta SQL Server en `localhost:1433` (usuario `sa`, password de desarrollo en `docker-compose.yml` — nunca sale de tu máquina, no es una credencial real). La imagen es `azure-sql-edge`, no la de SQL Server: en Apple Silicon la imagen oficial de Microsoft no tiene build nativo para arm64 y solo corre emulada; Azure SQL Edge sí es nativo y suficientemente compatible con T-SQL/EF Core para desarrollo. El `docker-compose.yml` trae comentado el cambio a la imagen oficial si preferís correrla emulada para tener paridad exacta.

No hace falta correr `dotnet ef database update` a mano: el backend aplica las migraciones pendientes solo al arrancar en modo Development (ver `Program.cs`) — contra el SQL Server central real ese paso se saca y las migraciones van por un deploy explícito.

## Correr cada parte

```bash
# Frontend + Electron (dev) — levanta `ng serve` y Electron juntos
cd frontend && npm install && npm run dev

# Backend (con el contenedor de la base ya levantado)
cd backend && dotnet run
```

`npm run build:app` empaqueta el instalador de escritorio con `electron-builder` (`postinstall` corre `electron-rebuild` para que `better-sqlite3` quede compilado contra el Node ABI de Electron, no el del sistema).

`npm run build:web` genera un `dist/` plano (sin Electron adentro) para hostear el panel de administración por separado, en caso de que termine siendo web-accedido en vez de vivir dentro de la app de báscula — todavía sin confirmar con el cliente, pero la diapositiva del kickoff ya lista "Panel de administración y reportería" bajo *Servidor central*, separado de la capa de báscula. Mismo código en los dos casos: las pantallas que hablan directo con el backend central (como `TipoMovimiento`) no dependen de Electron, así que no hace falta duplicar nada.

`dotnet ef migrations add` / `dotnet ef database update` necesitan el **runtime de .NET 8** instalado, además del SDK que uses para todo lo demás (si tenés un SDK más nuevo como .NET 10, `dotnet-ef` igual falla en tiempo de ejecución sin el runtime 8 físicamente presente). En macOS: `brew install dotnet@8` y anteponer `/opt/homebrew/opt/dotnet@8/bin` al `PATH` para esos comandos puntuales.

Con `dotnet@8` en el `PATH`, buildear/correr **`backend/SmsBackend.csproj` directo**, no `SMS20.slnx` — el MSBuild que trae el SDK 8 no reconoce el formato `.slnx` (es más nuevo). `dotnet build`/`dotnet run` contra la carpeta `backend/` funcionan igual.

`GET /health` hace un chequeo real contra la base (no solo "el proceso está vivo") — devuelve 503 si `SmsCentral` no responde.

El frontend habla **directo** contra el backend central (`http://localhost:5094` hardcodeado en `src/app/api/`, sin `.env` — no hay secretos en esa URL), no a través del servidor local de Electron: eso es solo para datos que necesitan funcionar offline (Boleta), y `TipoMovimiento` es `scope: central` únicamente en el esquema. En dev hace falta la política de CORS que ya está en `Program.cs` (solo activa en Development, apuntando a `http://localhost:4200`) para que el renderer pueda pegarle al backend.

## Aprovisionamiento de báscula (primer arranque)

Cada instalación de báscula se identifica con un código corto de un solo uso, generado por el admin al pre-registrar la báscula en el panel central. Al primer arranque, el operador escribe ese código; la app lo cambia por la config completa de esa báscula (conexión serial/Ethernet, centro, impresora) más el snapshot inicial de `Maestro`, y queda operando offline desde ahí. Ver sección "Aprovisionamiento" del esquema de datos — el endpoint real (`POST /aprovisionamiento`) todavía es un placeholder en `electron/local-server.ts`.

## Pendiente antes de implementar sync D365

El contrato real de payloads hacia D365 (`DatosIngresoFruta`, `DatosOrdenCompraRecepcion`, `DatosOrdenVentaSalida`, `DatosTransferenciaCrear/Recibir`) vive en los repos legacy `naturaceites-sincronizacion-sms` (`SyncSMS.API`) y `naturaceites-sms-winservice` (`WS_ProcesoAutomatico`) — ya revisado y aplicado al esquema (`OutboxD365.TipoOperacion`).

**Seguridad — antes de tocar `naturaceites-sms-api` (NAT_API_Interfaces_365) para migrar su lógica**: ese repo tiene credenciales en texto plano committeadas (password de SQL Server + client secret de Azure AD, sin gitignore), cero autenticación en sus endpoints, y no valida la respuesta de D365 antes de devolver 200 OK. Rotar credenciales y limpiar el historial de git antes de que ese código (o su historial) toque un remoto compartido.
