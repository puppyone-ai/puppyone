# PuppyOne Cloud Source Mirror (Retired)

This directory is a retired verbatim source mirror of the PuppyOne Cloud
frontend. Desktop no longer builds against this mirror.

Current desktop reuse flows through repo-local packages instead:

- `packages/data-core` for portable data contracts and `DataPort`
- `packages/data-ui` for reusable Data workspace UI

Do not add new desktop imports from this directory. New shared UI should move
into `packages/data-ui`, while Cloud app shell code should stay in `frontend/`.
