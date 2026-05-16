"""Re-export shim for ``MutOps`` after the move to ``adapters/operations/``.

The implementation lives at
``src.mut_engine.adapters.operations.ops_adapter`` (per
docs/architecture/07-version-engine-supplement.md §4: it's a Protocol
Adapter, not a service). This shim keeps the historical import path
working so the 17+ call sites don't all need to change in one PR.

New code should import from the canonical location:

    from src.mut_engine.adapters.operations.ops_adapter import MutOps

Old call sites continue to work via this re-export:

    from src.mut_engine.services.ops import MutOps        # still OK
"""

from src.mut_engine.adapters.operations.ops_adapter import (  # noqa: F401
    BlobRef,
    MissingBlobError,
    MutOps,
    WriteResult,
)
