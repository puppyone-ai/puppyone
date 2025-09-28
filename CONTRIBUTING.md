# Contributing

Thanks for considering contributing!

Developer setup
- Fork and clone the repo
- Create a feature branch from the latest `qubits` branch (dev)
- Use `./scripts/run-all.sh` to start local services quickly
- Copy `.env.example` to `.env` in each service and edit as needed

Code style
- Frontend: TypeScript/React, follow existing formatting; run `npm run lint` in PuppyFlow
- Backend: Python 3.10+, use black formatting (see `pyproject.toml`); run `npm run format:backend`

Branches and environments
- `main`: production (stable)
- `convergency`: stage (pre-release)
- `qubits`: dev (integration)

Branch naming
- `feature/<short-slug>`
- `fix/<short-slug>`
- `perf/<short-slug>`
- `docs/<short-slug>`
- `chore/<short-slug>`
- `temp/<short-slug>` (may be auto-cleaned once merged and idle >14 days)
- `revert-<sha-or-slug>`

Pull request flow
1. Default (features and non-fix work): open PR into `qubits` (dev). After validation, promote `qubits` → `convergency` → `main`.
2. Fixes:
   - Not urgent: base `convergency` (stage). After validation, back-merge to `qubits` to keep dev aligned.
   - Urgent (hotfix): base `main` (production). After release, back-merge to `convergency` and `qubits`.
   - Maintainers may direct an alternative target depending on risk/rollout.

CI checks you will see
- Build and Test Check: runs on push to any branch; additionally runs on PRs that target `qubits`.
- Prettier Auto Format: runs on push/PR for frontend files; if formatting differs it will push a "style: prettier auto-format" commit to your branch.
- Secret scanning (Gitleaks): runs on all PRs, on push to `main`, weekly on schedule, and via manual dispatch.
- Branch housekeeping: weekly job may delete remote branches that are merged into `main`, idle >14 days, and named with `temp/`, `feature/`, `fix/`, `feat/`, `perf/`, `docs/`, or `revert-`. Protected branches: `main`, `qubits`, `convergency`.

Commit/PR
- Use concise commit messages (scope: summary). Conventional prefixes like `feat`, `fix`, `chore`, `perf`, `docs` are welcome.
- Default PR target is `qubits` (dev). Use `convergency` for stage promotion and `main` for production releases.
- Include a clear description and test plan in PRs. Note any rollout or migration steps.
- Link related issues when applicable.
- Choose a PR template that matches the purpose: Feature, Bugfix, Perf, Refactor, or CI.

## Process governance (avoid infinite meta-optimization)
- Single source of truth: only this file and the PR templates define how to write PRs. Do not create meta-docs about the docs.
- Automation first, minimal guidance: prefer checks and one-line inline hints in templates over long explanations.
- Complexity budget: if you add any required section or rule, remove one of equal weight to keep total complexity flat.

- Hard caps
  - Template types: max 6 (`feature`, `bugfix`, `perf`, `refactor`, `ci`, `docs`). New types require ≥5 misfit examples per week for 2 consecutive weeks before being proposed.
  - Required sections per template: ≤6
  - Guidance per section: ≤1 line

- Change budget and time-boxing
  - At most 1 template/process change per week; freeze during release weeks.
  - Writing/implementing a change must take ≤15 minutes; otherwise postpone to the next cycle.

- Data-gated changes (make changes only if at least one holds for the last 2 weeks)
  - One-shot template pass rate (PR passes enforcer on first try) <70% and trending down
  - Any section is in top-3 "missing sections" with share ≥20%
  - ≥5 similar feedback items in two weeks, or TFFR/Merge-cycle degrades by ≥10%

- Rollout and rollback
  - Ship as a 2-week trial to a subset (e.g., label or branch prefix). If metrics do not improve, auto-rollback to the previous rule set.
  - Enforcer noise guardrail: median bot comments per PR ≤0.4 and false-positive rate ≤5%; crossing either threshold triggers rollback.

- Weekly digest includes only 3 signals: one-shot pass rate, top-3 missing sections, and TFFR/Merge-cycle change.

- Decision record (max 10 lines, no long docs)
  - Problem & evidence (1 line)
  - Success metric (1 line)
  - Change (≤3 lines) and equal removal to keep complexity flat
  - Scope & trial cohort (1 line)
  - Rollback condition & DRI (2 lines)

- Escape hatches
  - Keep the `template:skip` label, and allow `temp/` branches to pick the closest template.
  - Do not add new template types unless the "new type" criterion above is met.

- Change one thing at a time: do not modify both template structure and enforcer logic in the same week.

- Choose a PR template that matches the purpose: Feature, Bugfix, Perf, Refactor, or CI.

## Process governance (avoid infinite meta-optimization)
- Single source of truth: only this file and the PR templates define how to write PRs. Do not create meta-docs about the docs.
- Automation first, minimal guidance: prefer checks and one-line inline hints in templates over long explanations.
- Complexity budget: if you add any required section or rule, remove one of equal weight to keep total complexity flat.

- Hard caps
  - Template types: max 6 (`feature`, `bugfix`, `perf`, `refactor`, `ci`, `docs`). New types require ≥5 misfit examples per week for 2 consecutive weeks before being proposed.
  - Required sections per template: ≤6
  - Guidance per section: ≤1 line

- Change budget and time-boxing
  - At most 1 template/process change per week; freeze during release weeks.
  - Writing/implementing a change must take ≤15 minutes; otherwise postpone to the next cycle.

- Data-gated changes (make changes only if at least one holds for the last 2 weeks)
  - One-shot template pass rate (PR passes enforcer on first try) <70% and trending down
  - Any section is in top-3 "missing sections" with share ≥20%
  - ≥5 similar feedback items in two weeks, or TFFR/Merge-cycle degrades by ≥10%

- Rollout and rollback
  - Ship as a 2-week trial to a subset (e.g., label or branch prefix). If metrics do not improve, auto-rollback to the previous rule set.
  - Enforcer noise guardrail: median bot comments per PR ≤0.4 and false-positive rate ≤5%; crossing either threshold triggers rollback.

- Weekly digest includes only 3 signals: one-shot pass rate, top-3 missing sections, and TFFR/Merge-cycle change.

- Decision record (max 10 lines, no long docs)
  - Problem & evidence (1 line)
  - Success metric (1 line)
  - Change (≤3 lines) and equal removal to keep complexity flat
  - Scope & trial cohort (1 line)
  - Rollback condition & DRI (2 lines)

- Escape hatches
  - Keep the `template:skip` label, and allow `temp/` branches to pick the closest template.
  - Do not add new template types unless the "new type" criterion above is met.

- Change one thing at a time: do not modify both template structure and enforcer logic in the same week.

Security
- Never commit real secrets or `.env` files
- If a secret leaks, rotate immediately and follow the cleanup steps in SECURITY.md

License
- By contributing, you agree your contributions may be used under the project license
