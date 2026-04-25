<!--
Thanks for the PR! Please fill in the sections below so reviewers can move fast.
See CONTRIBUTING.md for the full workflow:
https://github.com/puppyone-ai/puppyone/blob/main/CONTRIBUTING.md
-->

## Summary

<!-- One or two sentences: what does this PR change and why? -->

## Target branch

<!--
Default target should be `qubits` (staging). Only release PRs from `qubits` to
`main` should target `main`. If you opened this PR against `main` from any
other branch, please change the base to `qubits` — the "Check PR Target" CI
job will block the merge otherwise.
-->

- [ ] Base branch is **`qubits`** (or this is a `qubits` → `main` release PR)

## Type of change

- [ ] feat — new feature
- [ ] fix — bug fix
- [ ] perf — performance improvement
- [ ] refactor — code change that is neither a fix nor a feature
- [ ] docs — documentation only
- [ ] chore — tooling, build, CI, deps
- [ ] hotfix — urgent production fix targeted at `main`

## Test plan

<!--
How did you verify this change? Examples:
- Ran `uv run pytest -m "unit"` locally — all green
- Manually tested the new endpoint with `curl ...`
- Verified UI in `npm run dev` at http://localhost:3000/foo
-->

## Linked issues

<!-- Use `Fixes #123` to auto-close, or `Refs #123` to reference. -->

## Checklist

- [ ] I have read [CONTRIBUTING.md](../CONTRIBUTING.md)
- [ ] My code follows the existing style (frontend: ESLint via `npm run lint`; backend: ruff via `uv run ruff format`)
- [ ] I have not committed any secrets, `.env` files, or credentials
- [ ] I have updated docs / comments where behaviour changed
- [ ] I have added or updated tests when adding logic that should be covered
