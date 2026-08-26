# SMS 2.0

Rediseño desde cero del sistema de control de báscula de Naturaceites (reemplaza `NAT_Basculas`, WinForms + .NET Framework 4.7.2).

Esquema de datos y decisiones de diseño: [documento vivo](https://claude.ai/code/artifact/ee209896-8ae8-422d-a9f8-da994fcb7184).

## Estructura

```
frontend/         React + Vite + TypeScript, PWA offline-first (vite-plugin-pwa)
backend/          .NET 8 Web API — sync central, outbox, integración D365
agente-bascula/   .NET 8 Worker Service — lectura de báscula (Serial + Ethernet), corre local en cada punto de pesaje
SMS20.slnx        Solución .NET (backend + agente-bascula)
```

## Requisitos

- Node.js 20+
- .NET 8 SDK

## Correr cada parte

```bash
# Frontend
cd frontend && npm install && npm run dev

# Backend
cd backend && dotnet run

# Agente de báscula
cd agente-bascula && dotnet run
```

## Pendiente antes de implementar sync D365

El contrato real de payloads hacia D365 (`DatosIngresoFruta`, `DatosOrdenCompraRecepcion`, `DatosOrdenVentaSalida`, `DatosTransferenciaCrear/Recibir`) vive en los repos legacy `naturaceites-sincronizacion-sms` (`SyncSMS.API`) y `naturaceites-sms-winservice` (`WS_ProcesoAutomatico`). Revisar esos contratos antes de cerrar el `TipoOperacion` de `OutboxD365` — los nombres del esquema actual son un primer borrador, no confirmados contra el contrato real.
