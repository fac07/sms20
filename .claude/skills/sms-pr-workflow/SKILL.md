---
name: sms-pr-workflow
description: "Trigger: sms20 implementation, new branch, worktree, commit, PR slice, push, feature or fix in SMS 2.0. Isolated worktree + strict TDD + reviewable-size workflow for the sms20 repo."
license: Apache-2.0
metadata:
  author: "cristiancastellanos"
  version: "1.0"
---

## Activation Contract

Load before writing, committing, or delegating any code change in the `sms20` repo (backend .NET, Angular frontend, Electron).

## Hard Rules

- Never edit in the `main` worktree. Work in a sibling worktree created from a freshly fetched `origin/main`.
- Strict TDD: write the failing test first, see it fail, then implement.
- Keep the authored diff near 400 lines. Report generated/lockfile lines separately; a raw overage needs a maintainer decision.
- Conventional commits in English. No `Co-Authored-By` and no AI attribution.
- Never push unless the user asks. Fix review feedback on an unpushed commit with `git commit --amend`.
- Do not touch `motor-campos` or `tests/parity` unless the task names them.
- Run every suite below before reporting done. A failure counts as pre-existing only if it reproduces unchanged on `origin/main`.

## Decision Gates

| Situation | Action |
|-----------|--------|
| Authored diff >400 lines | Split into chained PRs (`chained-pr` skill) |
| Failing test unrelated to the change | Reproduce on `origin/main`; report it, do not fix inline |
| Scope or behavior ambiguous | Ask one question and stop |

## Execution Steps

1. `git fetch origin && git worktree add ../sms20-<slug> -b <feat|fix>/<slug> origin/main`
2. Write the RED test, then the GREEN implementation, in small steps.
3. Run the suites:

| Area | Command |
|------|---------|
| Backend (docker-compose SQL up; target the `.csproj`, never `.slnx`) | `dotnet test tests/SmsBackend.Tests/SmsBackend.Tests.csproj` |
| Electron | `cd frontend && npm run test:electron` |
| Angular | `cd frontend && npm test` |
| Build | `cd frontend && npm run build && npm run electron:compile` |

4. Commit once, conventional message; confirm `git status` is clean.

## Output Contract

Return: branch, worktree path, commit SHA, pass counts per suite (`n/n`), authored vs generated line counts, pre-existing failures with evidence, and "not pushed".

## References

- `README.md` (repo root) — environment setup, .NET 8 runtime and test database notes.
