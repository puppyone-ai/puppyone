"""
S3StorageBackend — Mut ObjectStore 的 S3 实现

每个 project 的对象存储在 S3 的 mut/{project_id}/objects/ 前缀下。
对象按 hash 的前 2 字符分片：mut/{project_id}/objects/ab/cdef1234...

Sync/Async 策略:
  Mut 的 ObjectStore 接口是同步的（get/put/exists）。
  PuppyOne 的 S3Service 是异步的。
  同步方法通过 concurrent.futures 线程池桥接，避免 asyncio 嵌套。
"""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor

from mut.core.object_store import StorageBackend
from mut.foundation.error import ObjectNotFoundError

from src.s3.service import S3Service
from src.utils.logger import log_error

_thread_pool = ThreadPoolExecutor(max_workers=4)


def _run_async(coro):
    """在线程池中运行异步协程（安全地从同步上下文调用异步代码）"""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        import concurrent.futures
        future = concurrent.futures.Future()

        async def _wrapper():
            try:
                result = await coro
                future.set_result(result)
            except Exception as e:
                future.set_exception(e)

        loop.create_task(_wrapper())
        return future.result(timeout=30)
    else:
        return asyncio.run(coro)


class S3StorageBackend(StorageBackend):
    """Mut ObjectStore 的 S3 后端，按 project_id 隔离。"""

    def __init__(self, s3: S3Service, project_id: str):
        self._s3 = s3
        self._prefix = f"mut/{project_id}/objects"

    def _key_for(self, h: str) -> str:
        return f"{self._prefix}/{h[:2]}/{h[2:]}"

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
                self._s3.list_files(prefix=f"{self._prefix}/", max_keys=10000)
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
