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
- `chore/<short-slug>`
- `temp/<short-slug>` (may be auto-cleaned once merged and idle >14 days)
- `revert-<sha-or-slug>`

Pull request flow
1. Target dev first → open PR into `qubits`.
2. Promote to stage → open PR from `qubits` to `convergency` after validation on dev.
3. Release to production → open PR from `convergency` to `main`.

CI checks you will see
- Build and Test Check: runs on push to any branch; additionally runs on PRs that target `qubits`.
- Prettier Auto Format: runs on push/PR for frontend files; if formatting differs it will push a "style: prettier auto-format" commit to your branch.
- Secret scanning (Gitleaks): runs on all PRs, on push to `main`, weekly on schedule, and via manual dispatch.
- Branch housekeeping: weekly job may delete remote branches that are merged into `main`, idle >14 days, and named with `temp/`, `feature/`, `fix/`, `feat/`, or `revert-`. Protected branches: `main`, `qubits`, `convergency`.

Commit/PR
- Use concise commit messages (scope: summary). Conventional prefixes like `feat`, `fix`, `chore` are welcome.
- Default PR target is `qubits` (dev). Use `convergency` for stage promotion and `main` for production releases.
- Include a clear description and test plan in PRs. Note any rollout or migration steps.
- Link related issues when applicable.

Security
- Never commit real secrets or `.env` files
- If a secret leaks, rotate immediately and follow the cleanup steps in SECURITY.md

License
- By contributing, you agree your contributions may be used under the project license
