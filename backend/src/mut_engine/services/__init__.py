"""
MUT Services layer — business logic and orchestration.

Provides the unified API that all PuppyOne channels use to interact with MUT.

  ops.py               MutOps — unified tree operation entry point
  ephemeral_client.py  In-process MUT client (REST → MUT protocol bridge)
  tree_reader.py       Lightweight Merkle tree reading
  hooks.py             Post-commit hooks (access_points table consistency)
"""
