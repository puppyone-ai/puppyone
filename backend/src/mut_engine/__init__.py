"""
Mut Engine — PuppyOne's version control core

Three-layer architecture:
  Upper: Channels → Middle: MutOps → Lower: MUT Server Handlers

Module structure:
  ops.py              MutOps — unified read/write entry point for all channels
  ephemeral_client.py MutEphemeralClient — clone->push wrapper used internally by MutOps
  tree_reader.py      MutTreeReader — lightweight reader used internally by MutOps
  tree_router.py      REST HTTP shell for MutOps (Web UI / internal)
  protocol_router.py  MUT wire-protocol HTTP shell for MutOps (CLI daemon)
  write_service.py    MutWriteService — admin only: init_tree / rollback / version history
  repo_manager.py     Per-project Mut repo factory
  dependencies.py     FastAPI DI factory (get_mut_ops / create_mut_ops)
  audit_router.py     Audit log API
  backends/           S3 + Supabase backend implementations
"""
