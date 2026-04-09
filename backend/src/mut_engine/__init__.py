"""
mut_engine — MUT integration for PuppyOne.

Directory structure:

  server/          MUT Server layer (infrastructure + data access)
    backends/        Storage adapters (S3, Supabase History/Audit/Scope)
    server_repo.py   PuppyOneServerRepo (implements mut core ServerRepo)
    repo_manager.py  Per-project repo factory + cache
    auth.py          MUT protocol authentication
    admin.py         Server admin: init_tree, version history, diff
    audit_repository.py  Audit log queries

  services/        Business services layer (orchestration + logic)
    ops.py             MutOps — unified tree operation entry point
    ephemeral_client.py  In-process MUT client (clone → push bridge)
    tree_reader.py     Lightweight Merkle tree reading
    hooks.py           Post-commit hooks (connections consistency)

  routers/         HTTP endpoints
    content_router.py  Content API — frontend REST API
    protocol_router.py MUT wire protocol (CLI / remote clients)
    access_point.py    MUT protocol with URL-embedded access key
    audit_router.py    Audit log API

  schemas.py       Request / response data models
  dependencies.py  FastAPI dependency injection factories
"""
