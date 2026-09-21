---
name: sms-auth-gates
description: "Trigger: authorization, RequireAuthorization, Politicas, role gate, endpoint auth, rolMinimo, terminal sync, anonymous endpoint in sms20. Checklist for gating or ungating backend routes without breaking Electron sync."
license: Apache-2.0
metadata:
  author: "cristiancastellanos"
  version: "1.0"
---

## Activation Contract

Load before adding, changing, or reviewing authorization on any `backend/Domain/**/*Endpoints.cs` route, or any `rolMinimo` in `frontend/src/app/app.routes.ts`.

## Hard Rules

- Every human route declares exactly one `.RequireAuthorization(Politicas.X)` with `Operador`, `Supervisor`, or `Administrador` (`backend/Domain/Seguridad/Politicas.cs`). Never add per-route or per-domain policies.
- There is no `[AllowAnonymous]`. A terminal route is anonymous only by omitting `RequireAuthorization`, and it needs a comment naming its Electron caller.
- Before gating any route, grep its path in `frontend/electron` (excluding `*.spec.ts`). If Electron calls it without an `Authorization` header, do not gate it.
- Anonymous terminal GETs must use `IgnoreQueryFilters()`. Without a user claim, Centro filters return empty rows.
- Centro scope lives in `ICentroContext`, never in a policy.
- Keep `data.rolMinimo` in `app.routes.ts` equal to the backend policy of the routes it calls.
- Never tighten or loosen a gate without a test that proves the new behavior.

## Decision Gates

| Route | Gate |
|-------|------|
| Called by Electron sync/device without a token | Ungated + comment + `IgnoreQueryFilters()` |
| Human read | `Operador` (Reportes: `Supervisor`) |
| Human mutation, code generation, central Boletas mutations | `Administrador` |
| Unsure whether Electron calls it | Grep first; if still unsure, ask one question |

## Execution Steps

1. Grep `frontend/electron` for the route path; classify it with the table.
2. RED, in `tests/SmsBackend.Tests/*Auth*Tests.cs`:
   - Gated: anonymous returns 401; a role below the floor returns 403; the right role passes.
   - Ungated: an anonymous request returns real seeded rows, not just a non-401 status.
3. GREEN: add or remove `.RequireAuthorization(...)` and the explanatory comment.
4. Run `dotnet test tests/SmsBackend.Tests/SmsBackend.Tests.csproj` and `cd frontend && npm run test:electron`.

## Output Contract

Return: route, gate chosen, Electron caller found (`file:line`) or "none", tests added, and suite results (`n/n`).

## References

- `backend/Domain/Seguridad/Politicas.cs` — the three policies and their hierarchy.
- `tests/SmsBackend.Tests/ConfiguracionTransporteAuthTests.cs` — gated-route test pattern.
- `../sms-pr-workflow/SKILL.md` — worktree, TDD, and commit rules.
