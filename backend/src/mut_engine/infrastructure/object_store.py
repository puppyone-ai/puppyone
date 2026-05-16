"""Content-addressable object store using git's loose-object format.

Formerly ``mut.core.object_store``. Stores objects as
``<dir>/<sha1[:2]>/<sha1[2:]>`` where each file holds
``zlib(b"<type> <size>\\x00<content>")`` — byte-identical to git's own
loose object encoding so a server-side dump is consumable by stock git.
"""

from __future__ import annotations

import abc
import asyncio
from pathlib import Path

from src.mut_engine.infrastructure.errors import ObjectNotFoundError
from src.mut_engine.infrastructure.fs_utils import atomic_write
from src.mut_engine.infrastructure.git_format import (
    decode_object,
    encode_object,
    hash_object,
)


# ── Backend ───────────────────────────────────

class StorageBackend(abc.ABC):
    @abc.abstractmethod
    def get(self, h: str) -> bytes:
        """Return the raw on-disk bytes for an object hash (zlib-compressed)."""

    @abc.abstractmethod
    def put(self, h: str, loose_bytes: bytes) -> None:
        """Store the zlib-compressed bytes under hash *h* (idempotent)."""

    @abc.abstractmethod
    def exists(self, h: str) -> bool: ...

    @abc.abstractmethod
    def all_hashes(self) -> list[str]: ...

    @abc.abstractmethod
    def count(self) -> tuple[int, int]: ...

    @abc.abstractmethod
    def delete(self, h: str) -> bool: ...


class FileSystemBackend(StorageBackend):
    """Default backend mirroring git's ``objects/<aa>/<bb..>`` layout."""

    def __init__(self, objects_dir: Path):
        self.dir = objects_dir

    def _path_for(self, h: str) -> Path:
        return self.dir / h[:2] / h[2:]

    def get(self, h: str) -> bytes:
        path = self._path_for(h)
        if not path.exists():
            raise ObjectNotFoundError(f"object not found: {h}")
        return path.read_bytes()

    def put(self, h: str, loose_bytes: bytes) -> None:
        path = self._path_for(h)
        if not path.exists():
            atomic_write(path, loose_bytes)

    def exists(self, h: str) -> bool:
        return self._path_for(h).exists()

    def all_hashes(self) -> list[str]:
        result: list[str] = []
        if not self.dir.exists():
            return result
        for d in sorted(self.dir.iterdir()):
            if d.is_dir() and len(d.name) == 2:
                for f in sorted(d.iterdir()):
                    result.append(d.name + f.name)
        return result

    def count(self) -> tuple[int, int]:
        n, size = 0, 0
        if not self.dir.exists():
            return 0, 0
        for d in self.dir.iterdir():
            if d.is_dir():
                for f in d.iterdir():
                    n += 1
                    size += f.stat().st_size
        return n, size

    def delete(self, h: str) -> bool:
        path = self._path_for(h)
        if path.exists():
            path.unlink()
            parent = path.parent
            if parent.exists() and not any(parent.iterdir()):
                parent.rmdir()
            return True
        return False


# ── Object store ──────────────────────────────

class ObjectStore:
    """Git-format loose object store with high-level put/get for each type."""

    def __init__(self, objects_dir: Path, backend: StorageBackend | None = None):
        self.dir = objects_dir
        self._backend = backend or FileSystemBackend(objects_dir)

    # ── high-level (typed) ─────────────────────

    def _put_typed(self, obj_type: str, content: bytes) -> str:
        sha1, loose = encode_object(obj_type, content)
        self._backend.put(sha1, loose)
        return sha1

    def put_blob(self, data: bytes) -> str:
        return self._put_typed("blob", data)

    def put_tree(self, content: bytes) -> str:
        return self._put_typed("tree", content)

    def put_commit(self, content: bytes) -> str:
        return self._put_typed("commit", content)

    def get_object(self, sha1: str) -> tuple[str, bytes]:
        loose = self._backend.get(sha1)
        try:
            obj_type, content = decode_object(loose)
        except Exception as exc:
            raise ObjectNotFoundError(
                f"object corrupt: {sha1} ({exc})"
            ) from exc
        actual = hash_object(obj_type, content)
        if actual != sha1:
            raise ObjectNotFoundError(
                f"object corrupt: expected {sha1}, got {actual}"
            )
        return obj_type, content

    # ── low-level (loose bytes pass-through) ───

    def put_loose(self, sha1: str, loose_bytes: bytes) -> None:
        """Store pre-encoded loose bytes (used by Git receive-pack)."""
        self._backend.put(sha1, loose_bytes)

    def get_loose(self, sha1: str) -> bytes:
        return self._backend.get(sha1)

    # ── back-compat thin wrappers ──────────────

    def put(self, data: bytes) -> str:
        return self.put_blob(data)

    def get(self, h: str) -> bytes:
        _type, content = self.get_object(h)
        return content

    def exists(self, h: str) -> bool:
        return self._backend.exists(h)

    def all_hashes(self) -> list[str]:
        return self._backend.all_hashes()

    def count(self) -> tuple[int, int]:
        return self._backend.count()

    def gc(self, reachable: set[str]) -> int:
        deleted = 0
        for h in self.all_hashes():
            if h not in reachable and self._backend.delete(h):
                deleted += 1
        return deleted

    # ── async wrappers ─────────────────────────

    async def async_put(self, data: bytes) -> str:
        return await asyncio.to_thread(self.put, data)

    async def async_get(self, h: str) -> bytes:
        return await asyncio.to_thread(self.get, h)

    async def async_exists(self, h: str) -> bool:
        return await asyncio.to_thread(self.exists, h)

    async def async_all_hashes(self) -> list[str]:
        return await asyncio.to_thread(self.all_hashes)

    async def async_count(self) -> tuple[int, int]:
        return await asyncio.to_thread(self.count)

    async def async_put_loose(self, h: str, loose: bytes) -> None:
        await asyncio.to_thread(self.put_loose, h, loose)

    async def async_get_loose(self, h: str) -> bytes:
        return await asyncio.to_thread(self.get_loose, h)
