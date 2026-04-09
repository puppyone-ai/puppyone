"""
MUT Server layer — infrastructure and data access.

Makes MUT run on PuppyOne's cloud infrastructure (S3 + PostgreSQL).

  backends/          Storage adapters (S3, Supabase History/Audit/Scope)
  server_repo.py     PuppyOneServerRepo (implements mut core ServerRepo interface)
  repo_manager.py    Per-project repo factory + cache
  auth.py            MUT protocol authentication (JWT / Access Key → MUT auth)
  admin.py           Server admin: init_tree, version history, diff
  audit_repository.py  Audit log queries
"""
