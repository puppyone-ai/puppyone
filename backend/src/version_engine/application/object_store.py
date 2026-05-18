"""Git-format content-addressed object store owned by PuppyOne."""

from __future__ import annotations

import abc
import asyncio
import os
import tempfile
from pathlib import Path

from src.version_engine.application.errors import ObjectNotFoundError
from src.version_engine.application.git_object_format import (
    decode_object,
    encode_object,
    hash_object,
)


class StorageBackend(abc.ABC):
    @abc.abstractmethod
    def get(self, h: str) -> bytes:
        """Return Git loose-object bytes for object id ``h``."""

    @abc.abstractmethod
    def put(self, h: str, loose_bytes: bytes) -> None:
        """Store Git loose-object bytes under object id ``h``."""

    @abc.abstractmethod
    def exists(self, h: str) -> bool: ...

    @abc.abstractmethod
    def all_hashes(self) -> list[str]: ...

    @abc.abstractmethod
    def count(self) -> tuple[int, int]: ...

    @abc.abstractmethod
    def delete(self, h: str) -> bool: ...


class FileSystemBackend(StorageBackend):
    """Git loose-object filesystem layout: ``objects/aa/bb...``."""

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
        if path.exists():
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(prefix=path.name + ".", dir=str(path.parent))
        try:
            with os.fdopen(fd, "wb") as tmp:
                tmp.write(loose_bytes)
            os.replace(tmp_name, path)
        finally:
            try:
                os.unlink(tmp_name)
            except FileNotFoundError:
                pass

    def exists(self, h: str) -> bool:
        return self._path_for(h).exists()

    def all_hashes(self) -> list[str]:
        result: list[str] = []
        if not self.dir.exists():
            return result
        for shard in sorted(self.dir.iterdir()):
            if shard.is_dir() and len(shard.name) == 2:
                for obj in sorted(shard.iterdir()):
                    result.append(shard.name + obj.name)
        return result

    def count(self) -> tuple[int, int]:
        n, size = 0, 0
        if not self.dir.exists():
            return 0, 0
        for shard in self.dir.iterdir():
            if shard.is_dir():
                for obj in shard.iterdir():
                    n += 1
                    size += obj.stat().st_size
        return n, size

    def delete(self, h: str) -> bool:
        path = self._path_for(h)
        if not path.exists():
            return False
        path.unlink()
        parent = path.parent
        if parent.exists() and not any(parent.iterdir()):
            parent.rmdir()
        return True


class ObjectStore:
    """High-level store for Git loose objects."""

    def __init__(self, objects_dir: Path, backend: StorageBackend | None = None):
        self.dir = objects_dir
        self._backend = backend or FileSystemBackend(objects_dir)

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
            raise ObjectNotFoundError(f"object corrupt: {sha1} ({exc})") from exc
        actual = hash_object(obj_type, content)
        if actual != sha1:
            raise ObjectNotFoundError(f"object corrupt: expected {sha1}, got {actual}")
        return obj_type, content

    def put_loose(self, sha1: str, loose_bytes: bytes) -> None:
        self._backend.put(sha1, loose_bytes)

    def get_loose(self, sha1: str) -> bytes:
        return self._backend.get(sha1)

    def put(self, data: bytes) -> str:
        return self.put_blob(data)

    def get(self, h: str) -> bytes:
        _obj_type, content = self.get_object(h)
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
