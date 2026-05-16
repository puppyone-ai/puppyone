"""Content hashing helpers.

Thin wrappers around :func:`hash_object` so callers can talk in terms of
plain bytes/files without re-stating the ``"blob"`` framing every time.
``HASH_LEN`` is exported here as the canonical SHA-1 hex length used for
path validation when objects are stored under ``<sha[:2]>/<sha[2:]>``.

Kept separate from ``git_object_format`` to keep that module focused on
the low-level loose/tree/commit encoding.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

from src.mut_engine.application.git_object_format import hash_object


# Length of a SHA-1 hex digest.
HASH_LEN = 40


def hash_blob_bytes(data: bytes) -> str:
    """Return SHA-1 hex of a blob object framed as ``blob <size>\\x00<data>``."""
    return hash_object("blob", data)


def hash_blob_file(path: Path) -> str:
    """Stream a file's contents through git blob framing and SHA-1."""
    size = path.stat().st_size
    h = hashlib.sha1()
    h.update(f"blob {size}".encode("ascii"))
    h.update(b"\x00")
    with open(path, "rb") as f:
        while True:
            chunk = f.read(8192)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


# Aliases — call sites scattered across ingest / merge use these names.
def hash_bytes(data: bytes) -> str:
    return hash_blob_bytes(data)


def hash_file(path: Path) -> str:
    return hash_blob_file(path)
