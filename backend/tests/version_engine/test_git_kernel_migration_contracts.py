"""Migration guardrails for the Git-kernel refactor."""

from __future__ import annotations

import ast
import re
import subprocess
from contextlib import contextmanager
from types import SimpleNamespace
from pathlib import Path

import pytest

from src.ingest.file.jobs.jobs import stage_blob_from_s3
from src.version_engine.domain.errors import ObjectNotFoundError
from src.version_engine.write_engine.git_object_format import (
    EMPTY_TREE_LOOSE_BYTES,
    EMPTY_TREE_SHA1,
    MODE_DIR,
    MODE_FILE,
    TreeEntry,
    decode_commit,
    decode_object,
    decode_tree,
    encode_commit,
    encode_object,
    encode_tree,
    hash_object,
)
from src.version_engine.write_engine.object_store import ObjectStore, StorageBackend
from src.version_engine.write_engine.path_utils import normalize_path
from src.version_engine.adapters.git.object_quarantine import GitObjectQuarantine
from src.version_engine.admission.repo_facade import repo_facade_from_auth
from src.version_engine.infrastructure.s3.object_storage import S3StorageBackend
from src.version_engine.infrastructure.supabase.db_names import OBJECT_LOCATIONS_TABLE


BACKEND_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_ROOT.parent

PRODUCT_WRITE_MODULES = (
    "src/version_engine/adapters/product/operation_adapter.py",
    "src/version_engine/write_engine/engine.py",
    "src/version_engine/derived/projection.py",
    "src/version_engine/derived/parent_scope_promote.py",
    "src/version_engine/derived/hooks.py",
    "src/version_engine/entrypoints/http/content_write.py",
)

ACTIVE_RUNTIME_SCAN_ROOTS = (
    "AGENTS.md",
    "backend/AGENTS.md",
    "backend/CLAUDE.md",
    "backend/mcp_service",
    "backend/scripts",
    "backend/src/connectors/filesystem",
    "backend/src/repo",
    "backend/src/version_engine",
    "backend/tests/conflicts",
    "backend/tests/mcp_service",
    "backend/tests/version_engine",
    "cli/src",
    "docs/README.md",
    "docs/architecture",
    "docs/cli",
    "frontend/lib",
    "frontend/app/(main)/projects/[projectId]",
    "frontend/components",
    "scripts",
    "tests/e2e",
)

ALLOWED_DEFERRED_DB_NAME_FILES = {
    "backend/src/version_engine/infrastructure/supabase/db_names.py",
}


def test_git_object_helpers_match_git_hash_object() -> None:
    content = b"hello from puppyone\n"

    object_id, loose = encode_object("blob", content)
    expected = subprocess.run(
        ["git", "hash-object", "--stdin"],
        input=content,
        stdout=subprocess.PIPE,
        check=True,
    ).stdout.decode("ascii").strip()

    assert object_id == expected
    assert hash_object("blob", content) == expected
    assert decode_object(loose) == ("blob", content)


def test_git_tree_and_commit_helpers_round_trip() -> None:
    blob_id, _loose = encode_object("blob", b"data\n")
    tree_body = encode_tree([
        TreeEntry(name="src", mode=MODE_DIR, sha1_hex="1" * 40),
        TreeEntry(name="README.md", mode=MODE_FILE, sha1_hex=blob_id),
    ])

    entries = decode_tree(tree_body)
    assert [entry.name for entry in entries] == ["README.md", "src"]
    assert entries[0].sha1_hex == blob_id
    assert entries[1].is_dir

    commit_body = encode_commit(
        tree_sha1="2" * 40,
        parent_sha1="3" * 40,
        author="A <a@example.com>",
        author_time="1767225600 +0000",
        committer="C <c@example.com>",
        committer_time="1767225601 +0000",
        message="hello\n",
    )
    commit = decode_commit(commit_body)
    assert commit["tree"] == "2" * 40
    assert commit["parents"] == ["3" * 40]
    assert commit["message"] == "hello"


def test_git_tree_encoder_rejects_legacy_short_object_ids() -> None:
    with pytest.raises(ValueError, match="40 hex"):
        encode_tree([
            TreeEntry(name="legacy", mode=MODE_DIR, sha1_hex="28a44dbeee08f49e"),
        ])


def test_empty_git_tree_is_virtual_builtin_object(tmp_path) -> None:
    class _NoStorageBackend(StorageBackend):
        def get(self, h: str) -> bytes:
            raise AssertionError("empty tree should not hit object storage")

        def put(self, h: str, loose_bytes: bytes) -> None:
            raise AssertionError("empty tree should not be persisted as loose data")

        def exists(self, h: str) -> bool:
            raise AssertionError("empty tree should not need an existence probe")

        def all_hashes(self) -> list[str]:
            return []

        def count(self) -> tuple[int, int]:
            return 0, 0

        def delete(self, h: str) -> bool:
            return False

    store = ObjectStore(tmp_path / "objects", backend=_NoStorageBackend())

    assert EMPTY_TREE_SHA1 == hash_object("tree", b"")
    assert decode_object(EMPTY_TREE_LOOSE_BYTES) == ("tree", b"")
    assert store.exists(EMPTY_TREE_SHA1) is True
    assert store.get_object(EMPTY_TREE_SHA1) == ("tree", b"")
    assert store.get_loose(EMPTY_TREE_SHA1) == EMPTY_TREE_LOOSE_BYTES
    assert store.put_tree(b"") == EMPTY_TREE_SHA1


def test_git_quarantine_promotion_batches_new_objects_only(tmp_path, monkeypatch) -> None:
    work = tmp_path / "work"
    work.mkdir()
    _run_git_cmd(["init"], work)
    _run_git_cmd(["config", "user.name", "Git User"], work)
    _run_git_cmd(["config", "user.email", "git@example.com"], work)

    (work / "a.txt").write_text("a\n", encoding="utf-8")
    _run_git_cmd(["add", "a.txt"], work)
    _run_git_cmd(["commit", "-m", "initial"], work)
    first = _run_git_cmd(["rev-parse", "HEAD"], work).decode("ascii").strip()

    (work / "b.txt").write_text("b\n", encoding="utf-8")
    _run_git_cmd(["add", "b.txt"], work)
    _run_git_cmd(["commit", "-m", "second"], work)
    second = _run_git_cmd(["rev-parse", "HEAD"], work).decode("ascii").strip()

    expected_new = _git_rev_list_objects(work / ".git", second, exclude=first)
    assert expected_new
    assert first not in expected_new

    class _FakeStore:
        def __init__(self):
            self.exists_many_calls: list[list[str]] = []
            self.puts: dict[str, bytes] = {}

        def exists_many(self, hashes: list[str]) -> set[str]:
            self.exists_many_calls.append(list(hashes))
            return set()

        def put_loose(self, object_id: str, loose: bytes) -> None:
            self.puts[object_id] = loose

    class _FakeRepo:
        def __init__(self):
            self.store = _FakeStore()

    flushes: list[int] = []

    @contextmanager
    def _fake_stage_object_writes(_store):
        yield SimpleNamespace(flush=lambda: flushes.append(1))

    monkeypatch.setattr(
        "src.version_engine.adapters.git.object_quarantine.stage_object_writes",
        _fake_stage_object_writes,
    )
    repo = _FakeRepo()
    quarantine = GitObjectQuarantine(
        repo=repo,
        bare_dir=work / ".git",
        roots=[second],
        exclude_roots=[first],
    )

    quarantine.promote_reachable()

    assert repo.store.exists_many_calls == [sorted(expected_new)]
    assert set(repo.store.puts) == expected_new
    assert flushes == [1]


def _run_git_cmd(args: list[str], cwd: Path) -> bytes:
    return subprocess.run(
        ["git", *args],
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=True,
    ).stdout


def _git_rev_list_objects(git_dir: Path, root: str, *, exclude: str = "") -> set[str]:
    args = ["git", "--git-dir", str(git_dir), "rev-list", "--objects", root]
    if exclude:
        args.extend(["--not", exclude])
    out = subprocess.run(
        args,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=True,
    ).stdout
    return {
        line.split(maxsplit=1)[0].decode("ascii")
        for line in out.splitlines()
        if line
    }


@pytest.mark.asyncio
async def test_object_batch_writes_one_bundle_with_location_index() -> None:
    blob_id, blob_loose = encode_object("blob", b"hello\n")
    tree_id, tree_loose = encode_object("tree", encode_tree([]))
    commit_id, commit_loose = encode_object(
        "commit",
        f"tree {tree_id}\n\nbundle test\n".encode("ascii"),
    )

    class _FakeS3:
        def __init__(self):
            self.bucket_name = "bucket"
            self.uploads: dict[str, bytes] = {}
            self.download_file_keys: list[str] = []
            self.download_range_keys: list[str] = []
            self.file_exists_keys: list[str] = []

        async def upload_file(self, key, content, content_type=None, metadata=None):
            self.uploads[key] = content
            return SimpleNamespace(key=key)

        async def download_file(self, key):
            self.download_file_keys.append(key)
            if key not in self.uploads:
                raise FileNotFoundError("not found")
            return self.uploads[key]

        async def download_file_range(self, key, start=0, limit=None):
            self.download_range_keys.append(key)
            if key not in self.uploads:
                raise FileNotFoundError("not found")
            content = self.uploads[key]
            end = len(content) if limit is None else min(len(content), start + limit)
            return content[start:end], len(content)

        async def file_exists(self, key):
            self.file_exists_keys.append(key)
            return key in self.uploads

    class _FakeTable:
        def __init__(self, db):
            self.db = db
            self.filters = {}
            self._upsert_rows = None

        def upsert(self, rows, on_conflict=None):
            self._upsert_rows = rows
            return self

        def select(self, *_args):
            return self

        def eq(self, key, value):
            self.filters[key] = value
            return self

        def in_(self, key, values):
            self.filters[key] = list(values)
            return self

        def limit(self, _value):
            return self

        def execute(self):
            if self._upsert_rows is not None:
                for row in self._upsert_rows:
                    self.db.rows[(row["project_id"], row["object_id"])] = row
                return SimpleNamespace(data=self._upsert_rows)
            self.db.select_calls += 1
            project_id = self.filters.get("project_id")
            object_ids = self.filters.get("object_id")
            if isinstance(object_ids, list):
                data = [
                    row
                    for oid in object_ids
                    if (row := self.db.rows.get((project_id, oid))) is not None
                ]
                return SimpleNamespace(data=data)
            row = self.db.rows.get((project_id, object_ids))
            return SimpleNamespace(data=[row] if row else [])

    class _FakeSupabase:
        def __init__(self):
            self.client = self
            self.rows = {}
            self.select_calls = 0

        def table(self, name):
            assert name == OBJECT_LOCATIONS_TABLE
            return _FakeTable(self)

    s3 = _FakeS3()
    supabase = _FakeSupabase()
    backend = S3StorageBackend(s3, "proj", supabase=supabase)

    await backend.async_put_many({
        blob_id: blob_loose,
        tree_id: tree_loose,
        commit_id: commit_loose,
    }, skip_exists=True)

    assert len(s3.uploads) == 1
    [pack_key] = list(s3.uploads)
    assert "/object-bundles/" in pack_key
    assert all("/objects/" not in key for key in s3.uploads)
    assert len(supabase.rows) == 3

    # Simulate a fresh backend instance: lookup must work through the durable
    # location index, not through the writer's in-memory cache.
    cold_backend = S3StorageBackend(s3, "proj", supabase=supabase)
    assert cold_backend.exists(blob_id) is True
    assert cold_backend.get(blob_id) == blob_loose
    assert cold_backend.get(tree_id) == tree_loose
    assert cold_backend.get(commit_id) == commit_loose
    blob_slice, blob_total = await cold_backend.async_get_range(blob_id, start=1, limit=6)
    assert blob_total == len(blob_loose)
    assert blob_slice == blob_loose[1:7]
    assert s3.download_file_keys == []
    assert s3.file_exists_keys == []
    assert s3.download_range_keys
    assert all("/object-bundles/" in key for key in s3.download_range_keys)

    bulk_backend = S3StorageBackend(s3, "proj", supabase=supabase)
    s3.file_exists_keys.clear()
    supabase.select_calls = 0
    assert bulk_backend.exists_many([blob_id, tree_id, commit_id]) == {
        blob_id,
        tree_id,
        commit_id,
    }
    assert supabase.select_calls == 1
    assert s3.file_exists_keys == []


def test_s3_backend_reads_deferred_namespace_but_writes_final_namespace() -> None:
    object_id, loose = encode_object("blob", b"from deferred storage\n")
    deferred_namespace = "".join(("m", "ut"))
    deferred_key = (
        f"{deferred_namespace}/proj/objects/{object_id[:2]}/{object_id[2:]}"
    )

    class _FakeS3:
        def __init__(self):
            self.uploads: dict[str, bytes] = {deferred_key: loose}
            self.uploaded_keys: list[str] = []

        async def upload_file(self, key, content, content_type=None, metadata=None):
            self.uploads[key] = content
            self.uploaded_keys.append(key)
            return SimpleNamespace(key=key)

        async def download_file(self, key):
            if key not in self.uploads:
                raise FileNotFoundError("not found")
            return self.uploads[key]

        async def download_file_range(self, key, start=0, limit=None):
            if key not in self.uploads:
                raise FileNotFoundError("not found")
            content = self.uploads[key]
            end = len(content) if limit is None else min(len(content), start + limit)
            return content[start:end], len(content)

        async def file_exists(self, key):
            return key in self.uploads

    s3 = _FakeS3()
    backend = S3StorageBackend(s3, "proj", allow_deferred_namespace_reads=True)

    assert backend.get(object_id) == loose
    assert backend.exists(object_id) is True

    new_id, new_loose = encode_object("blob", b"new canonical write\n")
    backend.put(new_id, new_loose)

    expected_new_key = f"version/proj/objects/{new_id[:2]}/{new_id[2:]}"
    assert s3.uploaded_keys == [expected_new_key]
    assert s3.uploads[expected_new_key] == new_loose

    strict_backend = S3StorageBackend(s3, "proj", allow_deferred_namespace_reads=False)
    with pytest.raises(ObjectNotFoundError):
        strict_backend.get(object_id)


def test_path_normalization_is_owned_by_puppyone() -> None:
    assert normalize_path("/docs/readme.md/") == "docs/readme.md"
    assert normalize_path("") == ""
    with pytest.raises(ValueError, match="path traversal"):
        normalize_path("docs/../secret.md")


def test_access_point_auth_maps_to_repo_facade_not_physical_repo() -> None:
    auth = {
        "agent": "scope:scope-123",
        "_project_id": "proj-1",
        "_scope": {
            "id": "scope-123",
            "path": "/docs/",
            "exclude": ["tmp", "/cache/"],
            "mode": "rw",
        },
        "_repo_facade": {
            "id": "scope-123",
            "kind": "access_point",
            "ref": "refs/heads/main",
            "object_store_scope": "project-shared",
        },
    }

    facade = repo_facade_from_auth("proj-1", auth, kind="access_point")

    assert facade.project_id == "proj-1"
    assert facade.repo_id == "scope-123"
    assert facade.kind == "access_point"
    assert facade.scope_path == "docs"
    assert facade.excludes == ("tmp", "cache")
    assert facade.ref == "refs/heads/main"
    assert facade.object_store_scope == "project-shared"
    assert facade.read_only is False


@pytest.mark.asyncio
async def test_upload_staging_writes_git_loose_blob_bytes() -> None:
    raw = b"raw upload bytes"
    source_key = "uploads/file.bin"

    class _Client:
        def head_object(self, *, Bucket, Key):
            assert Bucket == "bucket"
            assert Key == source_key
            return {"ContentLength": len(raw)}

    class _FakeS3:
        bucket_name = "bucket"

        def __init__(self):
            self.client = _Client()
            self.uploads: dict[str, bytes] = {}

        async def download_file_stream(self, key: str, chunk_size: int):
            assert key == source_key
            yield raw[:4]
            yield raw[4:]

        async def object_exists(self, key: str) -> bool:
            return key in self.uploads

        async def upload_file(self, key: str, content: bytes, content_type: str | None = None):
            assert content_type == "application/octet-stream"
            self.uploads[key] = content

    s3 = _FakeS3()
    ref = await stage_blob_from_s3(s3, project_id="project-1", src_key=source_key)

    expected_hash = hash_object("blob", raw)
    expected_key = f"version/project-1/objects/{expected_hash[:2]}/{expected_hash[2:]}"
    assert ref.hash == expected_hash
    assert ref.size == len(raw)
    assert set(s3.uploads) == {expected_key}
    assert decode_object(s3.uploads[expected_key]) == ("blob", raw)


def test_backend_python_no_longer_imports_external_legacy_version_package() -> None:
    offenders: list[str] = []
    legacy_prefix = "".join(("m", "ut."))

    for root in (BACKEND_ROOT / "src", BACKEND_ROOT / "tests"):
        paths = root.rglob("*.py")
        for path in paths:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom):
                    module = node.module or ""
                    if module == "legacy" or module.startswith(legacy_prefix):
                        offenders.append(f"{path.relative_to(BACKEND_ROOT)}:{node.lineno}")
                elif isinstance(node, ast.Import):
                    for alias in node.names:
                        if alias.name == "legacy" or alias.name.startswith(legacy_prefix):
                            offenders.append(f"{path.relative_to(BACKEND_ROOT)}:{node.lineno}")

    assert offenders == []


def test_active_runtime_surfaces_do_not_reintroduce_removed_protocol_names() -> None:
    """Keep product code, CLI, frontend, and agent instructions on final names.

    Deferred physical database names are allowed only in db_names.py. That file
    is the explicit storage-boundary exception documented in 01-version-engine.
    """

    old_protocol_upper = "".join(("M", "UT"))
    old_protocol_title = "".join(("M", "ut"))
    old_protocol_lower = "".join(("m", "ut"))
    banned_patterns = (
        (old_protocol_upper, re.compile(rf"\b{old_protocol_upper}\b")),
        (old_protocol_title, re.compile(rf"\b{old_protocol_title}\b")),
        (old_protocol_lower, re.compile(rf"\b{old_protocol_lower}\b")),
        (
            f"{old_protocol_lower}_engine",
            re.compile(re.escape(f"{old_protocol_lower}_engine")),
        ),
        (f"/{old_protocol_lower}/ap", re.compile(re.escape(f"/{old_protocol_lower}/ap"))),
        (f"X-{old_protocol_title}-User", re.compile(re.escape(f"X-{old_protocol_title}-User"))),
        (
            "_".join(("permanent", "delete")),
            re.compile(re.escape("_".join(("permanent", "delete")))),
        ),
        (
            "_".join(("active", "access", "point")),
            re.compile(re.escape("_".join(("active", "access", "point")))),
        ),
        (
            "_".join(("legacy", "access", "point")),
            re.compile(re.escape("_".join(("legacy", "access", "point")))),
        ),
    )
    suffixes = {".md", ".py", ".js", ".jsx", ".ts", ".tsx"}
    offenders: list[str] = []

    for rel_root in ACTIVE_RUNTIME_SCAN_ROOTS:
        root = REPO_ROOT / rel_root
        paths = [root] if root.is_file() else root.rglob("*")
        for path in paths:
            if not path.is_file() or path.suffix not in suffixes:
                continue
            rel = str(path.relative_to(REPO_ROOT))
            if rel in ALLOWED_DEFERRED_DB_NAME_FILES:
                continue
            text = path.read_text(encoding="utf-8")
            for line_no, line in enumerate(text.splitlines(), start=1):
                for label, pattern in banned_patterns:
                    if pattern.search(line):
                        offenders.append(f"{rel}:{line_no}:{label}")

    assert offenders == []


def test_core_no_longer_imports_removed_protocol_normalize_path() -> None:
    offenders: list[str] = []
    removed_protocol_module = "".join(("m", "ut.core.protocol"))

    for path in (BACKEND_ROOT / "src").rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.ImportFrom)
                and node.module == removed_protocol_module
                and any(alias.name == "normalize_path" for alias in node.names)
            ):
                offenders.append(f"{path.relative_to(BACKEND_ROOT)}:{node.lineno}")

    assert offenders == []


def test_access_point_auth_uses_repo_scopes_without_legacy_fallback() -> None:
    checked = (
        BACKEND_ROOT / "src/version_engine/entrypoints/http/access_point.py",
        BACKEND_ROOT / "src/version_engine/admission/identity.py",
    )

    offenders = [
        str(path.relative_to(BACKEND_ROOT))
        for path in checked
        if '.table("access_points")' in path.read_text(encoding="utf-8")
    ]

    assert offenders == []


def test_product_write_path_does_not_import_git_transport_materialization() -> None:
    offenders: list[str] = []
    banned_modules = {
        "src.version_engine.adapters.git.object_quarantine",
        "src.version_engine.adapters.git.upload_pack",
        "src.version_engine.adapters.git.receive_pack",
    }
    banned_names = {
        "temporary_bare_repo",
        "temporary_transport_bare_repo",
        "copy_reachable_objects_to_bare",
        "copy_store_objects_to_bare",
        "quarantine_pack",
    }

    for rel in PRODUCT_WRITE_MODULES:
        path = BACKEND_ROOT / rel
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                module = node.module or ""
                imported = {alias.name for alias in node.names}
                if module in banned_modules:
                    offenders.append(f"{rel}:{node.lineno}:{module}")
                if imported & banned_names:
                    offenders.append(
                        f"{rel}:{node.lineno}:{','.join(sorted(imported & banned_names))}"
                    )
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name in banned_modules:
                        offenders.append(f"{rel}:{node.lineno}:{alias.name}")

    assert offenders == []


def test_product_write_path_does_not_depend_on_git_view_projection() -> None:
    offenders: list[str] = []
    banned_names = {
        "git_compatible_head_commit",
        "git_view_head_commit",
    }

    for rel in PRODUCT_WRITE_MODULES:
        path = BACKEND_ROOT / rel
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                module = node.module or ""
                imported = {alias.name for alias in node.names}
                if module == "src.version_engine.adapters.git.view_projection":
                    offenders.append(f"{rel}:{node.lineno}:{module}")
                if imported & banned_names:
                    offenders.append(
                        f"{rel}:{node.lineno}:{','.join(sorted(imported & banned_names))}"
                    )

    assert offenders == []
