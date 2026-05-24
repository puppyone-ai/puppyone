"""Self-heal for stale bytes in the deferred-read namespace.

The legacy pre-Git-native finalize path (server-side ``copy_object``
from the upload staging key) wrote **raw** user/tree payloads under
keys that the current Git-native object store reads as loose Git
objects. When the store falls back to the deferred namespace and
zlib-decompresses those bytes, ``_verify_loose_hash`` raises
``StorageWriteError("invalid git loose object …")`` and the user-
facing bulk push surface dies with:

    Bulk push failed: invalid git loose object for {hash}:
    Error -3 while decompressing data: incorrect header check

We cannot ask every affected user to ``aws s3 rm`` the orphan bytes —
those keys must self-heal at read time. The behavior contract being
asserted here:

  1. Reading a hash whose ONLY presence is stale deferred-namespace
     bytes must NOT raise ``StorageWriteError`` (or any other zlib
     surfaced error). The engine treats it as 404 so callers can
     fall through to a clean "missing blob" error path.
  2. The stale S3 object is best-effort deleted as a side-effect, so
     the next read of the same hash takes the 404 fast path
     instead of re-paying the GET + verify dance.
  3. Both the sync ``get()`` and ``async_get()`` paths self-heal.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from src.version_engine.domain.errors import ObjectNotFoundError
from src.version_engine.infrastructure.s3.object_storage import (
    S3StorageBackend,
    _DEFERRED_STORAGE_NAMESPACE,
)


class _StubS3:
    """In-memory S3 stub keyed by full S3 key.

    Tracks every ``download_file`` and ``delete_file`` call so tests
    can assert (a) what the engine fetched and (b) what got cleaned up.
    """

    def __init__(self) -> None:
        self.bytes_by_key: dict[str, bytes] = {}
        self.download_calls: list[str] = []
        self.delete_calls: list[str] = []
        self.bucket_name = "test-bucket"

    async def download_file(self, key: str) -> bytes:
        self.download_calls.append(key)
        if key not in self.bytes_by_key:
            # Match the production not-found detection (see
            # ``_is_not_found_error``): the message has to contain one
            # of "not found" / "nosuchkey" / "404" / "does not exist"
            # so the engine treats it as a 404 fall-through rather
            # than a fatal error.
            from src.infra.s3.exceptions import S3FileNotFoundError
            raise S3FileNotFoundError(key)
        return self.bytes_by_key[key]

    async def file_exists(self, key: str) -> bool:
        return key in self.bytes_by_key

    async def delete_file(self, key: str) -> None:
        self.delete_calls.append(key)
        self.bytes_by_key.pop(key, None)

    async def upload_file(self, key: str, data: bytes, content_type: str = "") -> None:
        self.bytes_by_key[key] = data


def _supabase_wrapper():
    """Return a no-op Supabase wrapper. The deferred-loose read path
    doesn't touch ``mut_object_locations``, but the backend constructor
    expects something with the right shape."""
    wrap = MagicMock()
    wrap.client.table.return_value.select.return_value.eq.return_value.in_.return_value.execute.return_value.data = []
    return wrap


# ── Fixtures ─────────────────────────────────────────────────────


@pytest.fixture
def stub_s3() -> _StubS3:
    return _StubS3()


@pytest.fixture
def project_id() -> str:
    return "test-proj-019"


@pytest.fixture
def backend(stub_s3: _StubS3, project_id: str) -> S3StorageBackend:
    """A backend with deferred-namespace reads ON — that's the read
    path under test."""
    return S3StorageBackend(
        stub_s3,
        project_id=project_id,
        supabase=_supabase_wrapper(),
        allow_deferred_namespace_reads=True,
    )


# ── Helpers ──────────────────────────────────────────────────────


def _stale_deferred_key(project_id: str, hash_hex: str) -> str:
    """The same key shape the production code uses for deferred-namespace
    reads: ``{namespace}/{project_id}/objects/{shard}/{rest}``."""
    return (
        f"{_DEFERRED_STORAGE_NAMESPACE}/{project_id}/objects/"
        f"{hash_hex[:2]}/{hash_hex[2:]}"
    )


def _primary_loose_key(backend: S3StorageBackend, hash_hex: str) -> str:
    """The current-namespace loose key the backend would write to."""
    return backend._key_for(hash_hex)


# ── Tests ────────────────────────────────────────────────────────


class TestDeferredLooseSelfHeal:
    """Sync path."""

    def test_stale_deferred_bytes_do_not_propagate_zlib_error(
        self, backend: S3StorageBackend, stub_s3: _StubS3, project_id: str,
    ) -> None:
        """``get(h)`` for a hash whose ONLY presence is stale raw bytes
        in the deferred namespace must NOT raise ``StorageWriteError``
        — that's what surfaces as ``Bulk push failed: invalid git
        loose object``. Instead the engine should report a clean
        ``ObjectNotFoundError`` so the caller knows the blob is
        genuinely missing.
        """
        # Same hash + same kind of bytes the production bug exposed:
        # a JSON tree payload from the pre-Git protocol that happens
        # to live under what the current code reads as a loose-object
        # key.
        h = "520885e2ece1037b" + "0" * 24  # 40-char hex sha1
        stale_bytes = b'{".trash": ["T", "garbage"], "Note.md": ["B", "..."]}'
        stub_s3.bytes_by_key[_stale_deferred_key(project_id, h)] = stale_bytes

        with pytest.raises(ObjectNotFoundError):
            backend.get(h)

    def test_stale_deferred_bytes_auto_delete_on_first_read(
        self, backend: S3StorageBackend, stub_s3: _StubS3, project_id: str,
    ) -> None:
        """The stale entry must be best-effort deleted so subsequent
        reads short-circuit on 404 rather than re-paying the GET +
        verify dance.
        """
        h = "5" + "a" * 39
        stale_key = _stale_deferred_key(project_id, h)
        stub_s3.bytes_by_key[stale_key] = b"not zlib"

        # First read self-heals.
        with pytest.raises(ObjectNotFoundError):
            backend.get(h)
        assert stale_key in stub_s3.delete_calls, (
            f"expected auto-delete of {stale_key}; saw deletes={stub_s3.delete_calls}"
        )
        # And the stub really applied the delete.
        assert stale_key not in stub_s3.bytes_by_key

    def test_valid_loose_in_primary_namespace_is_preferred(
        self, backend: S3StorageBackend, stub_s3: _StubS3, project_id: str,
    ) -> None:
        """Even if a stale entry exists in the deferred namespace, a
        valid loose object in the PRIMARY namespace must be returned
        without ever touching the stale key (production order:
        primary loose → deferred loose → packed)."""
        import hashlib
        import zlib

        content = b"hello world"
        framed = b"blob " + str(len(content)).encode() + b"\0" + content
        h = hashlib.sha1(framed).hexdigest()
        loose_bytes = zlib.compress(framed)

        # Stale entry sits in deferred namespace, valid bytes in primary.
        stub_s3.bytes_by_key[_stale_deferred_key(project_id, h)] = b"junk"
        stub_s3.bytes_by_key[_primary_loose_key(backend, h)] = loose_bytes

        # Primary read wins; the stale key is never fetched.
        out = backend.get(h)
        assert out == loose_bytes
        assert _stale_deferred_key(project_id, h) not in stub_s3.download_calls

    def test_valid_bytes_in_deferred_still_returned(
        self, backend: S3StorageBackend, stub_s3: _StubS3, project_id: str,
    ) -> None:
        """The fallback path is still functional for the LEGITIMATE
        case it was designed for — valid loose bytes in the deferred
        namespace (a project pre-migration) should be returned, not
        rejected as stale."""
        import hashlib
        import zlib

        content = b"legacy but valid content"
        framed = b"blob " + str(len(content)).encode() + b"\0" + content
        h = hashlib.sha1(framed).hexdigest()
        loose_bytes = zlib.compress(framed)

        # Only in deferred — no primary copy.
        stub_s3.bytes_by_key[_stale_deferred_key(project_id, h)] = loose_bytes

        out = backend.get(h)
        assert out == loose_bytes
        # And no delete — these bytes are valid.
        assert stub_s3.delete_calls == []


class TestDeferredLooseSelfHealAsync:
    """Async path mirror — same contract, same regressions."""

    @pytest.mark.asyncio
    async def test_async_stale_deferred_bytes_do_not_propagate_zlib_error(
        self, backend: S3StorageBackend, stub_s3: _StubS3, project_id: str,
    ) -> None:
        h = "520885e2ece1037b" + "1" * 24
        stub_s3.bytes_by_key[_stale_deferred_key(project_id, h)] = b'{"not": "loose"}'

        with pytest.raises(ObjectNotFoundError):
            await backend.async_get(h)

    @pytest.mark.asyncio
    async def test_async_stale_deferred_bytes_auto_delete(
        self, backend: S3StorageBackend, stub_s3: _StubS3, project_id: str,
    ) -> None:
        h = "5" + "b" * 39
        stale_key = _stale_deferred_key(project_id, h)
        stub_s3.bytes_by_key[stale_key] = b"not zlib"

        with pytest.raises(ObjectNotFoundError):
            await backend.async_get(h)
        assert stale_key in stub_s3.delete_calls
