"""Compatibility re-export for the legacy ``direct_writer`` import path.

The actual publish authority is
``src.mut_engine.application.transaction_engine.GitNativeTransactionEngine``.

Only ``ConcurrentMutationError`` is still imported from this path by
``routers/access_point_fs.py`` and ``routers/content_write.py``; the
old ``apply_mutation()`` wrapper had no real callers and has been
removed. New code should import directly from
``application/transaction_engine``:

    from src.mut_engine.application.transaction_engine import (
        ConcurrentMutationError,
        GitNativeTransactionEngine,
    )

This shim only exists to avoid touching every router call site in one
PR; it can be deleted once those imports are migrated.
"""

from src.mut_engine.application.transaction_engine import (  # noqa: F401
    ConcurrentMutationError,
)


__all__ = ["ConcurrentMutationError"]
