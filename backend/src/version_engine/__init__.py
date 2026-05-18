"""
version_engine — PuppyOne's Git-native Version Transaction Engine.

The role is the central write authority that turns Git pushes, FS CLI /
PAPI operations, connector imports, and agent writes into Git-compatible version facts (commits,
trees, blobs, refs) plus PuppyOne audit facts. See
``docs/architecture/01-version-engine.md`` for the model.

The old version wire protocol has been removed: there is no longer a
``protocol_router.py`` or any
``/api/v1/version/{clone,push,pull,...}`` route. Git smart HTTP is the only
external wire protocol. Web/PAPI/CLI and typed connector writes use the
Product Operation Adapter (``ProductOperationAdapter``); agent/sandbox
working-copy write-back submits version intents directly to the same
transaction engine.

Directory structure:

  domain/          Write-intent dataclasses and conflict records
  application/     Transaction engine, conflict policy, projection, and the
                   PuppyOne-owned Git/tree/merge/object-store primitives
                   (git_object_format, object_store, tree, merge, diff,
                   errors, path_utils, hash_utils, scope, ...).
  adapters/        Protocol/product adapters
    git/             Git smart HTTP / SSH
    operations/      Product Operation Adapter (ProductOperationAdapter)
  server/          Repo manager, server-side auth, scope manager, storage backends
    backends/        S3 + Supabase History/Audit/Scope adapters
  services/        Business orchestration (tree reader, hooks, outbox)
  routers/         HTTP endpoints
    content_router.py     Frontend REST API
    access_point.py       Access-key → (project, scope) resolver
    access_point_fs.py    Cloud-scoped FS CLI backend
    content_history.py    Version history + rollback
    audit_router.py       Audit log API

  schemas.py       Request / response data models
  dependencies.py  FastAPI dependency injection factories
"""
