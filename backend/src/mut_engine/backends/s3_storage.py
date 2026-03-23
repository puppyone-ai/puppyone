"""
S3StorageBackend — S3 implementation of Mut ObjectStore

Each project's objects are stored under the S3 prefix mut/{project_id}/objects/.
Objects are sharded by the first 2 characters of the hash: mut/{project_id}/objects/ab/cdef1234...

Sync/Async strategy:
  Mut's ObjectStore interface is synchronous (get/put/exists).
  PuppyOne's S3Service is asynchronous.
  Synchronous methods bridge via concurrent.futures thread pool to avoid nested asyncio.
"""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor

from mut.core.object_store import StorageBackend
from mut.foundation.error import ObjectNotFoundError

from src.infra.s3.service import S3Service
from src.utils.logger import log_error

_THREAD_POOL_SIZE = 4
_ASYNC_BRIDGE_TIMEOUT_SECS = 30
_HASH_PREFIX_LEN = 2
_MAX_LIST_KEYS = 10000

_thread_pool = ThreadPoolExecutor(max_workers=_THREAD_POOL_SIZE)


def _run_async(coro):
    """Safely execute an async coroutine from a synchronous context.

    Strategy: always run in a separate thread with a new event loop
    to avoid deadlocks with the caller's event loop.
    """
    import concurrent.futures

    def _run_in_thread():
        return asyncio.run(coro)

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(_run_in_thread).result(timeout=_ASYNC_BRIDGE_TIMEOUT_SECS)


class S3StorageBackend(StorageBackend):
    """S3 backend for Mut ObjectStore, isolated by project_id."""

    def __init__(self, s3: S3Service, project_id: str):
        self._s3 = s3
        self._prefix = f"mut/{project_id}/objects"

    def _key_for(self, h: str) -> str:
        return f"{self._prefix}/{h[:_HASH_PREFIX_LEN]}/{h[_HASH_PREFIX_LEN:]}"

    # ── Sync methods (called by Mut's ObjectStore) ──

    def get(self, h: str) -> bytes:
        key = self._key_for(h)
        try:
            return _run_async(self._s3.download_file(key))
        except Exception:
            raise ObjectNotFoundError(f"object not found in S3: {h}")

    def put(self, h: str, data: bytes) -> None:
        key = self._key_for(h)
        try:
            _run_async(self._do_put(key, data))
        except Exception as e:
            log_error(f"[MutS3] Failed to put {h}: {e}")

    def exists(self, h: str) -> bool:
        try:
            return _run_async(self._s3.file_exists(self._key_for(h)))
        except Exception:
            return False

    def all_hashes(self) -> list[str]:
        try:
            items, _, _, _ = _run_async(
                self._s3.list_files(prefix=f"{self._prefix}/", max_keys=_MAX_LIST_KEYS)
            )
            hashes = []
            for item in items:
                parts = item.key.removeprefix(f"{self._prefix}/").split("/")
                if len(parts) == 2:
                    hashes.append(parts[0] + parts[1])
            return hashes
        except Exception as e:
            log_error(f"[MutS3] Failed to list hashes: {e}")
            return []

    def count(self) -> tuple[int, int]:
        hashes = self.all_hashes()
        return len(hashes), 0

    def delete(self, h: str) -> bool:
        try:
            _run_async(self._s3.delete_file(self._key_for(h)))
            return True
        except Exception:
            return False

    # ── Async methods (for direct use in async contexts) ──

    async def async_get(self, h: str) -> bytes:
        key = self._key_for(h)
        try:
            return await self._s3.download_file(key)
        except Exception:
            raise ObjectNotFoundError(f"object not found in S3: {h}")

    async def async_put(self, h: str, data: bytes) -> None:
        await self._do_put(self._key_for(h), data)

    async def async_exists(self, h: str) -> bool:
        return await self._s3.file_exists(self._key_for(h))

    async def _do_put(self, key: str, data: bytes) -> None:
        if not await self._s3.file_exists(key):
            await self._s3.upload_file(key, data, content_type="application/octet-stream")
