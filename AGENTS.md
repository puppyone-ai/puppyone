# Repository Working Agreement

This file defines the default Git and delivery workflow for the entire PuppyOne Desktop repository. More specific `AGENTS.md` files may add rules for their own subdirectories.

## Documentation Authority

- Current Desktop product, architecture, operations, privacy, release, and source-control documentation lives in [`puppy-issues/document/puppyone-desktop`](https://github.com/puppyone-ai/puppy-issues/tree/main/document/puppyone-desktop).
- This repository has no `docs/` directory. Do not add current specifications or runbooks to it.
- `archive/legacy-desktop-docs/` is a frozen, non-canonical historical snapshot. Never use it to decide current behavior or implementation direction, and do not make code, tests, benchmarks, or quality gates depend on it.
- [`puppy-issues/document/product-philosophy.md`](https://github.com/puppyone-ai/puppy-issues/blob/main/document/product-philosophy.md) is the authority for the concepts users face and for user-facing wording. Its Vocabulary table decides which words may appear in `locales/renderer/**`; `npm run check:boundaries` enforces it through `scripts/check-user-vocabulary.mjs`, whose rules are generated from that table. Widen or narrow an exception by editing the table and running `node scripts/check-user-vocabulary.mjs --sync`, never by editing the generated rules or the violation baseline.
- When implementation changes affect documented behavior, update the canonical `puppy-issues` document in the same delivery window and include a source link using `repository@commit:path` provenance.

## Canonical Branches

- `main` is the protected stable and release branch. It must always represent a published or release-ready state.
- `qubits` is the single product integration branch for the next desktop release.
- `herbtest` is Herbert's local personal integration branch. Personal task branches start from the accepted `herbself` baseline and merge into `herbtest` only after review and relevant tests. Run combined integration checks there before promoting the selected changes to `herbself`.
- `herbself` is the accepted source for the personal daily app. Personal changes reach it through verified `herbtest` integration; package `puppyone herb` from its clean, exact commit only when an app update is explicitly requested. Product-intended changes may separately be promoted to `qubits` and then `main`.
- Do not develop directly on `main`. Changes reach `main` only through the release and promotion workflow.
- After every release, synchronize `qubits` to the released `main` commit before starting new feature work. Prefer a fast-forward; rebase only local, unpublished commits when necessary.
- Release branches are temporary. Delete them after the release is verified and `qubits` has been synchronized.

## Task Branches and Worktrees

- Start each independent task on a short-lived branch such as `codex/<task-name>`. General product tasks start from current `qubits`; Herbert's personal tasks start from accepted `herbself` and return through `herbtest` before promotion to `herbself`.
- Use one branch and, when isolation is useful, one worktree per task. Never create duplicate active worktrees for the same long-lived branch.
- Keep canonical `main` and `qubits` worktrees as needed. Herbert's personal workflow may keep one `herbtest` integration worktree and, when needed, one `herbself` checkout; never duplicate a long-lived branch across active worktrees. Remove task worktrees immediately after integration or deliberate archival.
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
- Review the diff and run relevant checks before integration. Personal task branches first integrate into `herbtest`; after combined integration checks, promote the intended tested set into `herbself`, preferably by fast-forward. Keep `herbtest` synchronized with accepted `herbself` changes. Promote only reviewed, tested changes intended for the product into `qubits`. Keep unfinished experiments on their task branches.
- Resolve overlapping implementations architecturally. Do not merge obsolete branches merely to preserve commit ancestry; archive them and port only still-needed behavior onto the current architecture.
- Pushes, remote branch deletion, PR closure, release publication, and other remote mutations require explicit user authorization.

## Verification and Release Flow

1. Synchronize the development baseline with current `qubits` without discarding personal work. Personal tasks use `herbself` as their starting branch. Review the complete task diff.
2. Run focused tests for changed behavior, then the repository-level checks appropriate to the affected surface.
3. Integrate tested personal tasks into `herbtest`, run combined integration checks, and promote the verified set into `herbself`. A requested personal app update packages that exact `herbself` commit. Product integration into `qubits` is a separate action. Confirm each integration worktree is clean.
4. Prepare a temporary release branch from the verified integration commit, run the full release checks, and promote it to `main` through the repository's CI/CD workflow.
5. Verify the published tag and artifacts, then synchronize `qubits` to the released `main` commit and bring that baseline back into `herbself` without rewriting shared commits.

Test or build failures must be reported and resolved before release. Do not describe a branch as clean, merged, or releasable without checking the actual Git state and relevant CI result.

## Personal Daily Application

- `puppyone herb` is an installed application, independent of all source worktrees.
- The personal flow is task branches → `herbtest` → `herbself` → an explicitly requested `puppyone herb` package.
- Personal daily builds use a clean, exact local `herbself` commit after relevant local tests, build checks, and packaged-app verification pass. This personal build does not require promotion to `qubits` or `main`, cloud pushes, or release publication. Official releases continue to follow the `main` promotion workflow.
- Build that verified source as channel `dev` with `--display-name "puppyone herb"`, followed by `npm run dist:mac:prepared`. Preserve the existing dev data/credential identity; the personal label does not create a release channel.
- Build in a temporary checkout of the verified commit. Verify the package and back up the installed app/data before replacement. Continuing development on `herbself` must not update the installed daily app.
- Updating the personal daily application is an explicit local action. Preserve the previous installed app and user data for rollback; do not update it automatically when `herbself` changes.

## Cleanup

- Remove a worktree only after confirming it is clean or after preserving its contents.
- Run `git worktree prune` after removing obsolete worktrees.
- Delete merged or deliberately archived local task branches; retain only branches with active, clearly identified work.
- Close superseded PRs and delete obsolete remote branches only after verifying that their useful changes are integrated or recoverable.
- Finish each task by reporting the active branches, remaining worktrees, validation performed, and any intentionally preserved follow-up work.
