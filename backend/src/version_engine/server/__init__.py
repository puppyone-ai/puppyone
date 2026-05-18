"""
Version server layer — infrastructure and data access.

Runs the version engine on PuppyOne's cloud infrastructure (S3 + PostgreSQL).

  backends/          Storage adapters (S3, Supabase History/Audit/Scope)
  server_repo.py     PuppyOneServerRepo
  repo_manager.py    Per-project repo factory + cache
  auth.py            Version access authentication (JWT / Access Key)
  admin.py           Server admin: init_tree, version history, diff
  audit_repository.py  Audit log queries
"""
