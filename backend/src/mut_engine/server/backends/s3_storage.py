"""
S3StorageBackend — S3 implementation of Mut ObjectStore

Each project's objects are stored under the S3 prefix mut/{project_id}/objects/.
Objects are sharded by the first 2 characters of the hash: mut/{project_id}/objects/ab/cdef1234...

Performance layers:
  1. CachedStorageBackend — process-wide LRU keyed by content hash (immutable = forever cacheable)
  2. Shared thread pool — reused across all S3 calls instead of per-call creation
  3. S3StorageBackend — actual S3 I/O

Sync/Async strategy:
  Mut's ObjectStore interface is synchronous (get/put/exists).
  PuppyOne's S3Service is asynchronous.
  Synchronous methods bridge via a shared thread pool to avoid nested asyncio.
"""

from __future__ import annotations

import asyncio
import threading
from contextlib import contextmanager
from contextvars import ContextVar

import cachetools

from src.mut_engine.infrastructure.errors import (
    ObjectNotFoundError,
    StorageWriteError,
)
from src.mut_engine.infrastructure.git_format import decode_object, hash_object
from src.mut_engine.infrastructure.object_store import StorageBackend

from src.infra.s3.service import S3Service
from src.utils.logger import log_error

# Single-blob S3 download budget. Used by the sync→async bridge below
# to bound how long `store.get(blob_hash)` can block. The previous 30s
# was tight: when MutOps does a full clone-on-write, every blob in the
# scope is fetched serially, and large imports (e.g. Gmail messages
# with attachments, multi-MB documents) routinely exceed it — symptom
# was every mkdir / write_file / create_sync raising `TimeoutError`
# from `future.result(timeout=...)` in `_run_async`. Bumped to 300s to
# match the boto3 client's `read_timeout` (see infra/s3/service.py),
# so the bridge timeout doesn't bite before S3 itself does.
_ASYNC_BRIDGE_TIMEOUT_SECS = 300
_HASH_PREFIX_LEN = 2
_MAX_LIST_KEYS = 10000

_BRIDGE_LOOP: asyncio.AbstractEventLoop | None = None
_BRIDGE_LOCK = threading.Lock()


def _get_bridge_loop() -> asyncio.AbstractEventLoop:
    """Lazily create a single persistent event loop running on a background thread."""
    global _BRIDGE_LOOP
    if _BRIDGE_LOOP is None or _BRIDGE_LOOP.is_closed():
        with _BRIDGE_LOCK:
            if _BRIDGE_LOOP is None or _BRIDGE_LOOP.is_closed():
                loop = asyncio.new_event_loop()
                t = threading.Thread(
                    target=loop.run_forever, daemon=True, name="mut-s3-loop",
                )
                t.start()
                _BRIDGE_LOOP = loop
    return _BRIDGE_LOOP


def _run_async(coro):
    """Execute an async coroutine from a synchronous context via a persistent loop."""
    loop = _get_bridge_loop()
    future = asyncio.run_coroutine_threadsafe(coro, loop)
    return future.result(timeout=_ASYNC_BRIDGE_TIMEOUT_SECS)

# ═══════════════════════════════════════════════
# CachedStorageBackend — process-wide LRU cache
# ═══════════════════════════════════════════════

# LRU is keyed by content hash, so cached objects are immutable —
# we can cache aggressively and the only cost is RAM. Tree nodes are
# tiny (a few KB) but blob payloads can be tens of MB on real
# projects, and version submissions can hit them repeatedly while flattening
# incoming/current/base trees for server-side merge and CAS retry.
# A 1 MB threshold meant a 26 MB user blob fell through both passes
# and triggered two 19-second S3 GETs per push. Lifting the
# per-object threshold to ~64 MB lets large blobs land in the LRU
# after the first push, so subsequent writes don't pay the round-
# trip again. Total budget bumped to keep room for a handful of
# large blobs alongside the tree nodes.
_CACHE_MAX_BYTES = 512 * 1024 * 1024  # 512 MB total budget
_CACHEABLE_THRESHOLD = 64 * 1024 * 1024  # cache up to 64 MB per object

_global_cache: cachetools.LRUCache | None = None
_cache_lock = threading.Lock()
_ACTIVE_WRITE_BATCH: ContextVar["ObjectWriteBatch | None"] = ContextVar(
    "mut_object_write_batch",
    default=None,
)


def _get_global_cache() -> cachetools.LRUCache:
    global _global_cache
    if _global_cache is None:
        with _cache_lock:
            if _global_cache is None:
                _global_cache = cachetools.LRUCache(
                    maxsize=_CACHE_MAX_BYTES,
                    getsizeof=len,
                )
    return _global_cache


class CachedStorageBackend(StorageBackend):
    """In-memory LRU cache in front of any StorageBackend.

    Content-addressed objects are immutable by definition:
    same hash = same content, forever. No TTL needed.

    The cache is process-wide and shared across all projects.
    All cache access is protected by _cache_lock because
    cachetools.LRUCache is not thread-safe.
    """

    def __init__(self, inner: StorageBackend):
        self._inner = inner
        self._cache = _get_global_cache()

    def get(self, h: str) -> bytes:
        active_batch = _ACTIVE_WRITE_BATCH.get()
        if active_batch is not None and active_batch.backend is self:
            pending = active_batch.get(h)
            if pending is not None:
                return pending
        with _cache_lock:
            cached = self._cache.get(h)
        if cached is not None:
            return cached
        data = self._inner.get(h)
        if len(data) < _CACHEABLE_THRESHOLD:
            with _cache_lock:
                self._cache[h] = data
        return data

    def get_range(self, h: str, start: int = 0, limit: int | None = None) -> tuple[bytes, int]:
        """Return a byte range without forcing a full download when possible."""
        with _cache_lock:
            cached = self._cache.get(h)
        if cached is not None:
            end = len(cached) if limit is None else min(len(cached), start + limit)
            return cached[start:end], len(cached)

        get_range = getattr(self._inner, "get_range", None)
        if callable(get_range):
            return get_range(h, start=start, limit=limit)

        data = self.get(h)
        end = len(data) if limit is None else min(len(data), start + limit)
        return data[start:end], len(data)

    def put(self, h: str, data: bytes) -> None:
        # Content-addressed: if the hash is already in the cache,
        # the inner backend has the same bytes (we put them there
        # ourselves on a previous call). Skip the S3 HEAD round-trip.
        # This is what makes repeated tree rebuilds that re-put already-known
        # blobs effectively free.
        with _cache_lock:
            already_cached = h in self._cache
        if already_cached:
            return
        active_batch = _ACTIVE_WRITE_BATCH.get()
        if active_batch is not None and active_batch.backend is self:
            active_batch.put(h, data)
            if len(data) < _CACHEABLE_THRESHOLD:
                with _cache_lock:
                    self._cache[h] = data
            return
        self._inner.put(h, data)
        if len(data) < _CACHEABLE_THRESHOLD:
            with _cache_lock:
                self._cache[h] = data

    def exists(self, h: str) -> bool:
        active_batch = _ACTIVE_WRITE_BATCH.get()
        if (
            active_batch is not None
            and active_batch.backend is self
            and active_batch.has(h)
        ):
            return True
        with _cache_lock:
            if h in self._cache:
                return True
        return self._inner.exists(h)

    def all_hashes(self) -> list[str]:
        return self._inner.all_hashes()

    def all_hashes_with_metadata(self) -> dict[str, dict]:
        getter = getattr(self._inner, "all_hashes_with_metadata", None)
        if callable(getter):
            return getter()
        return {h: {} for h in self.all_hashes()}

    def count(self) -> tuple[int, int]:
        return self._inner.count()

    def delete(self, h: str) -> bool:
        with _cache_lock:
            self._cache.pop(h, None)
        return self._inner.delete(h)


class ObjectWriteBatch:
    """Stage content-addressed object writes and flush them as one batch."""

    def __init__(self, backend: CachedStorageBackend):
        self.backend = backend
        self._objects: dict[str, bytes] = {}

    def put(self, h: str, data: bytes) -> None:
        _verify_loose_hash(h, data)
        self._objects[h] = data

    def get(self, h: str) -> bytes | None:
        return self._objects.get(h)

    def has(self, h: str) -> bool:
        return h in self._objects

    def flush(self) -> None:
        objects = dict(self._objects)
        if not objects:
            return
        inner = self.backend._inner
        async_put_many = getattr(inner, "async_put_many", None)
        if callable(async_put_many):
            _run_async(async_put_many(objects, skip_exists=True))
        else:
            for h, data in objects.items():
                inner.put(h, data)
        self._objects.clear()


@contextmanager
def stage_object_writes(store_or_backend):
    """Stage ObjectStore writes for a synchronous version transaction.

    A Git object id is a hash of the object body, so accepted operation
    writes can safely compute all blob/tree/commit ids first, then upload
    those immutable objects in parallel immediately before publishing the
    scope ref. This keeps the publish boundary synchronous while removing
    avoidable serial S3 latency from tiny CLI writes.
    """
    backend = getattr(store_or_backend, "_backend", store_or_backend)
    if not isinstance(backend, CachedStorageBackend):
        yield None
        return

    batch = ObjectWriteBatch(backend)
    token = _ACTIVE_WRITE_BATCH.set(batch)
    try:
        yield batch
    finally:
        _ACTIVE_WRITE_BATCH.reset(token)


def _verify_loose_hash(expected_hash: str, data: bytes) -> None:
    try:
        obj_type, content = decode_object(data)
        actual_hash = hash_object(obj_type, content)
    except Exception as e:
        raise StorageWriteError(f"invalid git loose object for {expected_hash}: {e}") from e
    if actual_hash != expected_hash:
        raise StorageWriteError(
            f"content-addressed object mismatch: expected {expected_hash}, got {actual_hash}",
        )


# ═══════════════════════════════════════════════
# S3StorageBackend — actual S3 I/O
# ═══════════════════════════════════════════════

class S3StorageBackend(StorageBackend):
    """S3 backend for Mut ObjectStore, isolated by project_id."""

    def __init__(self, s3: S3Service, project_id: str):
        self._s3 = s3
        self._prefix = f"mut/{project_id}/objects"

    def _key_for(self, h: str) -> str:
        return f"{self._prefix}/{h[:_HASH_PREFIX_LEN]}/{h[_HASH_PREFIX_LEN:]}"

    # ── Sync methods (called by Mut's ObjectStore) ──

    def get(self, h: str) -> bytes:
        try:
            return _run_async(self._s3.download_file(self._key_for(h)))
        except ObjectNotFoundError:
            raise
        except Exception as e:
            if _is_not_found_error(e):
                raise ObjectNotFoundError(f"object not found in S3: {h}") from e
            raise

    def get_range(self, h: str, start: int = 0, limit: int | None = None) -> tuple[bytes, int]:
        try:
            return _run_async(
                self._s3.download_file_range(
                    self._key_for(h),
                    start=start,
                    limit=limit,
                )
            )
        except ObjectNotFoundError:
            raise
        except Exception as e:
            if _is_not_found_error(e):
                raise ObjectNotFoundError(f"object not found in S3: {h}") from e
            raise

    def put(self, h: str, data: bytes) -> None:
        try:
            _run_async(self._do_put(self._key_for(h), data))
        except Exception as e:
            log_error(f"[MutS3] Failed to put {h}: {e}")
            raise StorageWriteError(f"failed to write object {h} to S3: {e}") from e

    def exists(self, h: str) -> bool:
        try:
            return _run_async(self._s3.file_exists(self._key_for(h)))
        except Exception as e:
            if _is_not_found_error(e):
                return False
            raise

    def all_hashes(self) -> list[str]:
        try:
            hashes = []
            for item in self._list_all_object_items():
                object_id = self._hash_from_key(item.key)
                if object_id:
                    hashes.append(object_id)
            return hashes
        except Exception as e:
            log_error(f"[MutS3] Failed to list hashes: {e}")
            raise

    def all_hashes_with_metadata(self) -> dict[str, dict]:
        """Return object ids and S3 metadata needed by conservative GC."""
        try:
            result: dict[str, dict] = {}
            for item in self._list_all_object_items():
                object_id = self._hash_from_key(item.key)
                if object_id:
                    result[object_id] = {
                        "last_modified": item.last_modified,
                        "size": item.size,
                    }
            return result
        except Exception as e:
            log_error(f"[MutS3] Failed to list hash metadata: {e}")
            raise

    def _list_all_object_items(self) -> list:
        items = []
        token = None
        while True:
            page, _, token, truncated = _run_async(
                self._s3.list_files(
                    prefix=f"{self._prefix}/",
                    max_keys=_MAX_LIST_KEYS,
                    continuation_token=token,
                )
            )
            items.extend(page)
            if not truncated or not token:
                return items

    def _hash_from_key(self, key: str) -> str:
        parts = key.removeprefix(f"{self._prefix}/").split("/")
        if len(parts) != 2:
            return ""
        return parts[0] + parts[1]

    def count(self) -> tuple[int, int]:
        hashes = self.all_hashes()
        return len(hashes), 0

    def delete(self, h: str) -> bool:
        try:
            _run_async(self._s3.delete_file(self._key_for(h)))
            return True
        except Exception as e:
            log_error(f"[MutS3] Failed to delete {h}: {e}")
            raise

    # ── Async methods (for direct use in async contexts) ──

    async def async_get(self, h: str) -> bytes:
        key = self._key_for(h)
        try:
            return await self._s3.download_file(key)
        except ObjectNotFoundError:
            raise
        except Exception as e:
            if _is_not_found_error(e):
                raise ObjectNotFoundError(f"object not found in S3: {h}") from e
            raise

    async def async_get_range(
        self, h: str, start: int = 0, limit: int | None = None
    ) -> tuple[bytes, int]:
        key = self._key_for(h)
        try:
            return await self._s3.download_file_range(key, start=start, limit=limit)
        except ObjectNotFoundError:
            raise
        except Exception as e:
            if _is_not_found_error(e):
                raise ObjectNotFoundError(f"object not found in S3: {h}") from e
            raise

    async def async_put(self, h: str, data: bytes) -> None:
        await self._do_put(self._key_for(h), data)

    async def async_exists(self, h: str) -> bool:
        return await self._s3.file_exists(self._key_for(h))

    async def async_get_many(self, hashes: list[str], concurrency: int = 20) -> dict[str, bytes]:
        """Fetch multiple objects in parallel. Returns {hash: bytes}."""
        import asyncio
        sem = asyncio.Semaphore(concurrency)
        results: dict[str, bytes] = {}

        async def _fetch(h: str):
            async with sem:
                results[h] = await self.async_get(h)

        await asyncio.gather(*[_fetch(h) for h in hashes], return_exceptions=True)
        return results

    async def async_put_many(self, objects: dict[str, bytes], concurrency: int = 20, skip_exists: bool = False) -> None:
        """Upload multiple objects in parallel.

        Args:
            skip_exists: If True, skip the HEAD existence check before PUT.
                Use when the caller already knows these objects don't exist
                (e.g. negotiate confirmed them as missing).
        """
        import asyncio
        sem = asyncio.Semaphore(concurrency)

        async def _upload(h: str, data: bytes):
            async with sem:
                key = self._key_for(h)
                if skip_exists:
                    await self._s3.upload_file(key, data, content_type="application/octet-stream")
                else:
                    await self._do_put(key, data)

        results = await asyncio.gather(
            *[_upload(h, d) for h, d in objects.items()],
            return_exceptions=True,
        )
        errors = [item for item in results if isinstance(item, Exception)]
        if errors:
            raise errors[0]

    async def async_exists_many(self, hashes: list[str], concurrency: int = 20) -> set[str]:
        """Check existence of multiple objects in parallel. Returns set of existing hashes."""
        import asyncio
        sem = asyncio.Semaphore(concurrency)
        existing: set[str] = set()

        async def _check(h: str):
            async with sem:
                if await self.async_exists(h):
                    existing.add(h)

        await asyncio.gather(*[_check(h) for h in hashes], return_exceptions=True)
        return existing

    async def _do_put(self, key: str, data: bytes) -> None:
        if not await self._s3.file_exists(key):
            await self._s3.upload_file(key, data, content_type="application/octet-stream")


def _is_not_found_error(exc: Exception) -> bool:
    """Detect S3 'object not found' errors across exception wrapper types."""
    msg = str(exc).lower()
    return any(s in msg for s in ("not found", "nosuchkey", "404", "does not exist"))
