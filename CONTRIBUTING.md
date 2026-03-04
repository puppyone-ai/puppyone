# Contributing

Thanks for considering contributing to PuppyOne!

## Developer Setup

- Fork and clone the repo
- Copy `.env.example` to `.env` in `backend/` and `frontend/` and fill in your credentials
- See [Getting Started](docs/getting-started.md) for full setup instructions

## Code Style

- **Frontend**: TypeScript/React — follow existing formatting; run `npm run lint` in `frontend/`
- **Backend**: Python 3.12+, use `ruff` formatting (configured in `pyproject.toml`); run `uv run ruff format`

## Configuration Files

- **Single source of truth**: Use `pyproject.toml` for all Python tool configurations (pytest, ruff, mypy, etc.)
- **Do NOT create** `pytest.ini`, `setup.cfg`, or other tool-specific config files
- **Rationale**: Prevents configuration drift (PEP 518 standard)

## Branches and Environments

- `main`: production (stable)
- `convergency`: stage (pre-release)
- `qubits`: dev (integration)

## Branch Naming

- `feature/<short-slug>`
- `fix/<short-slug>`
- `perf/<short-slug>`
- `docs/<short-slug>`
- `chore/<short-slug>`
- `temp/<short-slug>` (may be auto-cleaned once merged and idle >14 days)
- `revert-<sha-or-slug>`

## Pull Request Flow

1. **Default (features and non-fix work)**: open PR into `qubits` (dev). After validation, promote `qubits` → `convergency` → `main`.
2. **Fixes**:
   - Not urgent: base `convergency` (stage). After validation, back-merge to `qubits`.
   - Urgent (hotfix): base `main` (production). After release, back-merge to `convergency` and `qubits`.

## CI Checks

- **Build and Test**: runs on push to any branch; additionally runs on PRs targeting `qubits`
- **Prettier Auto Format**: runs on push/PR for frontend files; pushes a "style: prettier auto-format" commit if formatting differs
- **Secret scanning (Gitleaks)**: runs on all PRs, on push to `main`, and weekly on schedule
- **Branch housekeeping**: weekly job may delete merged remote branches idle >14 days (protected: `main`, `qubits`, `convergency`)

## Testing

Test layers:

| Layer | Description |
|-------|-------------|
| `unit` | Pure functions/classes, no external deps |
| `integration` | In-process integration (Supabase/Redis) |
| `contract` | FastAPI route contract tests |
| `e2e` | Full stack with Docker Compose |

Local commands (from `backend/`):

```bash
uv run pytest -v -m "unit"
uv run pytest -v -m "integration"
uv run pytest -v -m "not e2e"
```

## Commit & PR Guidelines

- Use concise commit messages with conventional prefixes: `feat`, `fix`, `chore`, `perf`, `docs`
- Default PR target is `qubits` (dev)
- Include a clear description and test plan in PRs
- Link related issues when applicable

## Security

- Never commit real secrets or `.env` files
- If a secret leaks, rotate immediately and follow the cleanup steps in [SECURITY.md](SECURITY.md)

## License

By contributing, you agree your contributions may be used under the project license.
