"""Content hashing utilities (SHA-1 over git object framing).

Formerly ``mut.foundation.hash`` — copied into PuppyOne as part of the
MUT-protocol removal so the engine has no runtime dependency on the
legacy package.
"""

import hashlib
from pathlib import Path

from src.mut_engine.infrastructure.git_format import hash_object


# Length of a SHA-1 hex digest. Useful for path validation when the engine
# stores objects under ``<sha[:2]>/<sha[2:]>`` paths.
HASH_LEN = 40


def hash_blob_bytes(data: bytes) -> str:
    """Return SHA-1 hex of a blob object framed as git ``blob <size>\\x00<data>``."""
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


# Backwards-compatible aliases (call sites still reference these).
def hash_bytes(data: bytes) -> str:
    return hash_blob_bytes(data)


def hash_file(path: Path) -> str:
    return hash_blob_file(path)
