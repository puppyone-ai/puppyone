"""
mut_engine — PuppyOne's Git-native Version Transaction Engine.

The package name is historical; the role today is the central write
authority that turns Git pushes, FS CLI / PAPI operations, connector
imports, and agent writes into Git-compatible version facts (commits,
trees, blobs, refs) plus PuppyOne audit facts. See
``docs/architecture/01-version-engine.md`` and
``docs/architecture/07-version-engine-supplement.md`` for the model.

The legacy MUT wire protocol has been removed: there is no longer a
``protocol_router.py``, ``adapters/mut/``, or any
``/api/v1/mut/{clone,push,pull,...}`` route. Git smart HTTP is the only
external wire protocol; the in-process Product Operation Adapter
(``MutOps``) handles Web/PAPI/CLI/connector/agent writes.

Directory structure:

  domain/          Write-intent dataclasses and conflict records
  application/     Transaction engine, conflict policy, projection
  adapters/        Protocol adapters
    git/             Git smart HTTP / SSH
    operations/      Product Operation Adapter (planned; today in services/ops.py)
  infrastructure/  (planned) Storage repositories — see 01-version-engine §3
  server/          Repo manager, server-side auth, storage backends
    backends/        S3 + Supabase History/Audit/Scope adapters
  services/        Business orchestration (MutOps, tree reader, hooks, outbox)
  routers/         HTTP endpoints
    content_router.py     Frontend REST API
    access_point.py       Access-key → (project, scope) resolver (no MUT routes)
    access_point_fs.py    Cloud-scoped FS CLI backend
    content_history.py    Version history + rollback
    audit_router.py       Audit log API

  schemas.py       Request / response data models
  dependencies.py  FastAPI dependency injection factories
"""
