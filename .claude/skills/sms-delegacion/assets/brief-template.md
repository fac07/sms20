# Delegation brief

## Goal
<One or two sentences: the outcome, not the steps.>

## Decisions already made
<Domain and design choices resolved beforehand. The agent must not reopen them.>

## Worktree
- Path: `../sms20-<agent>-<slug>`
- Branch: `<feat|fix>/<slug>`, based on `origin/main`

## Allowed paths
- <paths or globs the agent may edit>
- <shared file>: edit only <exact region>. Other agents own the rest.

## Forbidden paths
- <e.g. `backend/`, `frontend/electron/`, `motor-campos`, `tests/parity`>

## Rules
- Direct implementation. Do not invoke SDD.
- Strict TDD: failing test first, then implementation.
- Keep the authored diff near 400 lines.
- Conventional commits in English. No AI attribution.
- Never push.

## Suites to run before reporting
- Backend: `dotnet test tests/SmsBackend.Tests/SmsBackend.Tests.csproj`
- Angular: `cd frontend && npx ng test --watch=false`
- Build: `cd frontend && npx ng build`
- Electron: `cd frontend && npm run test:electron`
- Expected pre-existing failures/warnings: <fill in from an `origin/main` baseline run>

## Deliver
Branch, commit SHAs, pass counts per suite, files touched, and any deviation from this brief with the reason.
