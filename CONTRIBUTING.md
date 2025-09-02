# Contributing

Thanks for considering contributing!

Developer setup
- Fork and clone the repo
- Create a feature branch from latest default branch
- Use `./scripts/run-all.sh` to start local services quickly
- Copy `.env.example` to `.env` in each service and edit as needed

Code style
- Frontend: TypeScript/React, follow existing formatting; run `npm run lint` in PuppyFlow
- Backend: Python 3.10+, use black formatting (see `pyproject.toml`); run `npm run format:backend`

Commit/PR
- Use concise commit messages (scope: summary)
- Include a clear description and test plan in PRs
- Link related issues when applicable

Security
- Never commit real secrets or `.env` files
- If a secret leaks, rotate immediately and follow the cleanup steps in SECURITY.md

License
- By contributing, you agree your contributions may be used under the project license
