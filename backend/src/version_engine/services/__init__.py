"""
Version-engine services — repairable orchestration around the core engine.

The publish authority lives in ``application.transaction_engine`` and the
Product Operation Adapter lives in ``adapters.operations``. This package is
for derived or auxiliary work that must not define version semantics:

  tree_reader.py       Lightweight Git-tree reading
  tree_splice.py       Typed tree edit helpers for product operations
  hooks.py             Projection, scope-ref sync, and notification hooks
  version_outbox.py    Durable repair loop for post-commit side effects
  fs_path_index.py     Materialized file lookup projection
  in_process_client.py  In-process Version Engine client
  write_command.py     L3 command normalization before operation adapters
"""
