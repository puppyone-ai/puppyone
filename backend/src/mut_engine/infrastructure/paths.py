"""Path normalization helpers shared by adapters, engine, and storage.

Extracted from ``mut.foundation.config`` so the engine does not depend
on the legacy ``mut`` package. Only server-side constants and helpers
that the engine actually needs are kept here; client-side layout
(``.git/``, ``.mut/``, ignore files, gitconfig I/O) lives in user
working copies, not on the server, so it has no PuppyOne equivalent.
"""

from __future__ import annotations


# Full SHA-1 hex length. Used for path validation when objects are stored
# under ``<sha[:2]>/<sha[2:]>`` keys.
HASH_LEN = 40

# Patterns the server treats as ignored by default when ingesting a
# working tree manifest. Kept for parity with the legacy MUT ignore
# matcher in ``infrastructure/ignore.py``.
BUILTIN_IGNORE = frozenset({
    ".mut", ".mut-server", ".git", ".DS_Store",
    "__pycache__", ".env", "node_modules", ".venv",
})

# Name of the ignore file on the client. The server doesn't read it
# directly, but ingest paths look it up under this name.
IGNORE_FILE = ".gitignore"


def normalize_path(path: str) -> str:
    """Strip leading/trailing slashes for consistent path comparison.

    Rejects paths containing '..' segments to prevent path traversal attacks.
    """
    clean = (path or "").strip("/")
    if clean and ".." in clean.split("/"):
        raise ValueError(f"path traversal not allowed: {path}")
    return clean
