# Git Kernel Migration

The runtime migration is complete. PuppyOne uses PuppyOne-owned Git object,
tree, commit, merge, diff, scope, and transaction modules under
`backend/src/version_engine/`.

Current guardrails:

- Backend runtime must not import the removed external version package.
- Removed protocol routes must not return to active routers.
- Product write paths must not import Git transport materialization helpers.
- Active runtime/frontend/CLI/docs must use Version Engine, Git Remote,
  Puppyone CLI, scope, conflict, audit, and transaction language.

See `backend/tests/version_engine/test_git_kernel_migration_contracts.py`.
