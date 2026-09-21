---
name: sms-delegacion
description: "Trigger: delegate to Codex or Qwen, assign a frente, parallel agents, hand off a task, review a delivery in sms20. Brief template and acceptance checklist for externally delegated work."
license: Apache-2.0
metadata:
  author: "cristiancastellanos"
  version: "1.0"
---

## Activation Contract

Load before briefing Codex, Qwen, or any external agent on `sms20` work, and before accepting their delivery.

## Hard Rules

- One worktree and branch per agent: `sms20-<agent>-<slug>`. Never let two agents share a working tree.
- Every brief follows `assets/brief-template.md`. It always states allowed paths, forbidden paths, exact suite commands, and "no push, no SDD, conventional English commits, no AI attribution".
- Resolve design and domain ambiguities yourself before briefing. Never delegate the decision.
- Split parallel work by file ownership. If two agents must touch one file, name the exact region each may edit.
- Never trust the delivery summary. Re-run every suite in the agent's worktree and read the full diff before approving.
- Check domain rules against the endpoint or source code, not only against green tests.
- Before merging parallel branches, trial-merge them and check for same-name symbols and add/add files.
- If the agent delivers uncommitted work, commit it yourself after verification.

## Decision Gates

| Situation | Action |
|-----------|--------|
| Independent slice with clear file boundaries | Delegate in its own worktree |
| Shared files (`boletas-page`, `reportes.service.ts`, `Map*` extension methods) | Serialize the work or assign regions |
| Frontend-only task | Forbid `backend/` and `frontend/electron/` in the brief |
| Ambiguous domain term | Resolve it in legacy code first, then brief |

## Execution Steps

1. Create the worktree from a fresh `origin/main` (see `sms-pr-workflow`). A new frontend worktree needs `cd frontend && npm ci --ignore-scripts`.
2. Fill `assets/brief-template.md` and hand it over.
3. On delivery: read the diff, re-run the suites, and check domain rules against the source.
4. Compare the failures with `origin/main` before attributing them to the agent.
5. Commit if uncommitted. Do not push unless the user asks.

## Output Contract

Return: agent, worktree and branch, commit SHAs, suite results you re-ran (`n/n`), defects found and fixed, collision risk with other open branches, and "not pushed".

## References

- `assets/brief-template.md` — brief template for delegated work.
- `../sms-pr-workflow/SKILL.md` — worktree, TDD, and commit rules.
