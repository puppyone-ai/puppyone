# Repository Working Agreement

This file defines the default Git and delivery workflow for the entire PuppyOne Desktop repository. More specific `AGENTS.md` files may add rules for their own subdirectories.

## Documentation Authority

- Current Desktop product, architecture, operations, privacy, release, and source-control documentation lives in [`puppy-issues/document/puppyone-desktop`](https://github.com/puppyone-ai/puppy-issues/tree/main/document/puppyone-desktop).
- `docs/README.md` is only a relocation notice. Do not add current specifications or runbooks under `docs/`.
- `archive/legacy-desktop-docs/` is a frozen, non-canonical historical snapshot. Never use it to decide current behavior or implementation direction, and do not make code, tests, benchmarks, or quality gates depend on it.
- [`puppy-issues/document/product-philosophy.md`](https://github.com/puppyone-ai/puppy-issues/blob/main/document/product-philosophy.md) is the authority for the concepts users face and for user-facing wording. Its Vocabulary table decides which words may appear in `locales/renderer/**`; `npm run check:boundaries` enforces it through `scripts/check-user-vocabulary.mjs`, whose rules are generated from that table. Widen or narrow an exception by editing the table and running `node scripts/check-user-vocabulary.mjs --sync`, never by editing the generated rules or the violation baseline.
- When implementation changes affect documented behavior, update the canonical `puppy-issues` document in the same delivery window and include a source link using `repository@commit:path` provenance.

## Canonical Branches

- `main` is the protected stable and release branch. It must always represent a published or release-ready state.
- `qubits` is the single integration branch for the next desktop release.
- Do not develop directly on `main`. Changes reach `main` only through the release and promotion workflow.
- After every release, synchronize `qubits` to the released `main` commit before starting new feature work. Prefer a fast-forward; rebase only local, unpublished commits when necessary.
- Release branches are temporary. Delete them after the release is verified and `qubits` has been synchronized.

## Task Branches and Worktrees

- Start each independent task from the current `qubits` branch using a short-lived branch such as `codex/<task-name>`.
- Use one branch and, when isolation is useful, one worktree per task. Never create duplicate active worktrees for the same long-lived branch.
- Keep only the canonical `main` and `qubits` worktrees long term. Remove task worktrees immediately after their changes are integrated or deliberately archived.
- Never reuse a dirty worktree for a different task. Inspect `git status --short --branch` before editing, switching branches, rebasing, merging, or removing a worktree.
- Do not mix unrelated work in one branch or commit.

## Protecting Work in Progress

- Treat every existing local modification, untracked file, commit, branch, and worktree as user-owned work until proven otherwise.
- Before cleanup or history changes, preserve uncertain work in a clearly named archive branch and commit, or in a verified full repository bundle.
- Never use a force worktree removal, destructive reset, or checkout that discards changes as part of routine cleanup.
- Never rewrite commits that have already been pushed or shared. Rebase only unpublished task commits when it produces a clean integration history.

## Commits and Integration

- Stage only explicit paths that belong to the task. Do not use `git add .`, `git add -A`, or broad pathspecs that may capture unrelated work.
- Keep commits reviewable and single-purpose. Use an imperative conventional subject such as `fix(editor): ...`, `feat(terminal): ...`, or `docs: ...`.
- Integrate task branches into `qubits` only after reviewing the diff and running the relevant checks.
- Resolve overlapping implementations architecturally. Do not merge obsolete branches merely to preserve commit ancestry; archive them and port only still-needed behavior onto the current architecture.
- Pushes, remote branch deletion, PR closure, release publication, and other remote mutations require explicit user authorization.

## Verification and Release Flow

1. Update the task branch from current `qubits` and review the complete diff.
2. Run focused tests for changed behavior, then the repository-level checks appropriate to the affected surface.
3. Integrate the verified task into `qubits` and confirm the integration worktree is clean.
4. Prepare a temporary release branch from the verified integration commit, run the full release checks, and promote it to `main` through the repository's CI/CD workflow.
5. Verify the published tag and artifacts, then synchronize `qubits` to the released `main` commit before accepting new work.

Test or build failures must be reported and resolved before release. Do not describe a branch as clean, merged, or releasable without checking the actual Git state and relevant CI result.

## Cleanup

- Remove a worktree only after confirming it is clean or after preserving its contents.
- Run `git worktree prune` after removing obsolete worktrees.
- Delete merged or deliberately archived local task branches; retain only branches with active, clearly identified work.
- Close superseded PRs and delete obsolete remote branches only after verifying that their useful changes are integrated or recoverable.
- Finish each task by reporting the active branches, remaining worktrees, validation performed, and any intentionally preserved follow-up work.
