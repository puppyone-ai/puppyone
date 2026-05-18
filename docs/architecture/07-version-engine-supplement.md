# PuppyOne Version Engine Supplement

This file used to hold the transition notes for the pre-Git protocol migration.
That migration is now complete at runtime.

The canonical architecture is:

- [01-version-engine.md](01-version-engine.md)
- [07-version-engine-todo.md](07-version-engine-todo.md), only for remaining
  future work that is not part of the current runtime contract

Current invariant:

- Stock Git is the external version protocol.
- Web/API/Puppyone CLI writes enter through the Product Operation Adapter.
- `GitNativeTransactionEngine` is the only publish authority.
- Physical database names from the old schema are isolated in
  `backend/src/version_engine/server/db_names.py` until a future physical DB
  rename migration.
