import json
from types import SimpleNamespace

import pytest
from mut.core.object_store import ObjectStore, StorageBackend

from fastapi import HTTPException

from src.mut_engine.routers import access_point_fs as apfs
from src.mut_engine.routers.access_point_fs import _filter_entries
from src.mut_engine.services.tree_reader import MutTreeReader


def _entry(path: str, type_: str = "file", size_bytes: int | None = None):
    name = path.rsplit("/", 1)[-1]
    return SimpleNamespace(
        path=path,
        name=name,
        type=type_,
        content_hash=None,
        size_bytes=size_bytes,
        mime_type=None,
        children_count=None,
    )


class _RangeBackend(StorageBackend):
    def __init__(self):
        self.objects = {}
        self.ranges = []

    def get(self, h: str) -> bytes:
        return self.objects[h]

    def get_range(self, h: str, start: int = 0, limit: int | None = None):
        self.ranges.append({"hash": h, "start": start, "limit": limit})
        raw = self.objects[h]
        end = len(raw) if limit is None else min(len(raw), start + limit)
        return raw[start:end], len(raw)

    def put(self, h: str, data: bytes) -> None:
        self.objects[h] = data

    def exists(self, h: str) -> bool:
        return h in self.objects

    def all_hashes(self) -> list[str]:
        return list(self.objects)

    def count(self) -> tuple[int, int]:
        return len(self.objects), sum(len(v) for v in self.objects.values())

    def delete(self, h: str) -> bool:
        return self.objects.pop(h, None) is not None


def _patch_auth(monkeypatch, scope_path: str = ""):
    monkeypatch.setattr(
        apfs,
        "resolve_access_point",
        lambda _key: (
            "project-id",
            {
                "agent": "test-ap",
                "_scope": {
                    "id": "_root",
                    "path": scope_path,
                    "exclude": [],
                    "mode": "rw",
                },
            },
        ),
    )


class _FakeOps:
    def __init__(self, *, files=None, stats=None, listing=None, list_by_path=None, tree=None):
        self.files = files or {}
        self.stats = stats or {}
        self.listing = listing or []
        self.list_by_path = list_by_path or {}
        self.tree_entries = tree or []
        self.ranges = []
        self.mkdirs = []
        self.moves = []
        self.copies = []
        self.touches = []
        self.deletes = []
        self.writes = []

    def read_file(self, _project_id, path):
        if path not in self.files:
            raise FileNotFoundError(path)
        return self.files[path]

    def read_file_range(self, _project_id, path, *, start=0, limit=None):
        if path not in self.files:
            raise FileNotFoundError(path)
        raw = self.files[path]
        self.ranges.append({"path": path, "start": start, "limit": limit})
        end = len(raw) if limit is None else min(len(raw), start + limit)
        return SimpleNamespace(
            content=raw[start:end],
            total_size=len(raw),
            content_hash="blob-hash",
            ranged=bool(start or limit is not None),
        )

    def stat(self, _project_id, path, *, include_size=False):
        return self.stats.get(path)

    def list_dir(self, _project_id, _path, *, include_size=False):
        if _path in self.list_by_path:
            return self.list_by_path[_path]
        return self.listing

    def list_tree(
        self, _project_id, _path, max_depth=-1, *, include_size=False,
        max_entries=None,
    ):
        if max_entries is None:
            return self.tree_entries
        return self.tree_entries[:max_entries]

    def get_head_commit_id(self, _project_id):
        return "head"

    def get_scope_head_commit_id(self, _project_id, _scope_path):
        return "scope-head"

    def get_path_timestamps(self, _project_id, paths, *, limit=5000):
        return {
            p.strip("/"): {
                "created_at": "2026-01-01T00:00:00+00:00",
                "modified_at": "2026-01-02T00:00:00+00:00",
            }
            for p in paths
        }

    async def write_file(
        self, project_id, path, content, *, who, scope, message, base_commit_id=None
    ):
        self.writes.append({
            "project_id": project_id,
            "path": path,
            "content": content,
            "who": who,
            "scope": scope,
            "message": message,
            "base_commit_id": base_commit_id,
        })
        return SimpleNamespace(commit_id="write-commit")

    async def mkdir(
        self, project_id, path, *, who, scope, message, base_commit_id=None
    ):
        self.mkdirs.append({
            "project_id": project_id,
            "path": path,
            "who": who,
            "scope": scope,
            "message": message,
            "base_commit_id": base_commit_id,
        })
        return SimpleNamespace(commit_id="mkdir-commit")

    async def move(
        self, project_id, old_path, new_path, *, who, scope, message, base_commit_id=None
    ):
        self.moves.append({
            "project_id": project_id,
            "old_path": old_path,
            "new_path": new_path,
            "who": who,
            "scope": scope,
            "message": message,
            "base_commit_id": base_commit_id,
        })
        return SimpleNamespace(commit_id="move-commit")

    async def copy(
        self, project_id, old_path, new_path, *, who, scope, message, base_commit_id=None
    ):
        self.copies.append({
            "project_id": project_id,
            "old_path": old_path,
            "new_path": new_path,
            "who": who,
            "scope": scope,
            "message": message,
            "base_commit_id": base_commit_id,
        })
        return SimpleNamespace(commit_id="copy-commit")

    async def touch(
        self, project_id, paths, *, who, scope, message, base_commit_id=None
    ):
        self.touches.append({
            "project_id": project_id,
            "paths": paths,
            "who": who,
            "scope": scope,
            "message": message,
            "base_commit_id": base_commit_id,
        })
        return SimpleNamespace(commit_id="touch-commit")

    async def delete(
        self, project_id, paths, *, who, scope, message, base_commit_id=None
    ):
        self.deletes.append({
            "project_id": project_id,
            "paths": paths,
            "who": who,
            "scope": scope,
            "message": message,
            "base_commit_id": base_commit_id,
        })
        return SimpleNamespace(commit_id="delete-commit")


def test_filter_entries_hides_dot_entries_by_default():
    scope = {"path": "", "exclude": []}
    entries = [_entry("docs/readme.md"), _entry(".internal/readme_1.md")]

    visible = _filter_entries(entries, scope)

    assert [entry.path for entry in visible] == ["docs/readme.md"]


def test_filter_entries_can_include_dot_entries():
    scope = {"path": "", "exclude": []}
    entries = [_entry("docs/readme.md"), _entry(".internal/readme_1.md")]

    visible = _filter_entries(entries, scope, include_hidden=True)

    assert [entry.path for entry in visible] == [
        "docs/readme.md",
        ".internal/readme_1.md",
    ]


def test_tree_reader_includes_size_only_when_requested(tmp_path):
    store = ObjectStore(tmp_path / "objects")
    blob_hash = store.put(b"hello")
    root_hash = store.put(
        json.dumps({"hello.txt": ["B", blob_hash]}, sort_keys=True).encode()
    )

    class _History:
        def get_root_hash(self):
            return root_hash

    class _Repo:
        pass

    repo = _Repo()
    repo.history = _History()
    repo.store = store

    class _Repos:
        def get_repo(self, project_id):
            return repo

    reader = MutTreeReader(_Repos())

    default_entry = reader.list_dir("project-id")[0]
    sized_entry = reader.list_dir("project-id", include_size=True)[0]
    stat_entry = reader.stat("project-id", "hello.txt", include_size=True)

    assert default_entry.size_bytes is None
    assert sized_entry.size_bytes == 5
    assert stat_entry.size_bytes == 5


def test_tree_reader_uses_backend_range_read(tmp_path):
    backend = _RangeBackend()
    store = ObjectStore(tmp_path / "objects", backend=backend)
    blob_hash = store.put(b"abcdef")
    root_hash = store.put(
        json.dumps({"blob.bin": ["B", blob_hash]}, sort_keys=True).encode()
    )

    class _History:
        def get_root_hash(self):
            return root_hash

    class _Repo:
        pass

    repo = _Repo()
    repo.history = _History()
    repo.store = store

    class _Repos:
        def get_repo(self, project_id):
            return repo

    reader = MutTreeReader(_Repos())

    result = reader.read_file_range("project-id", "blob.bin", start=2, limit=3)

    assert result.content == b"cde"
    assert result.total_size == 6
    assert result.ranged is True
    assert backend.ranges == [{"hash": blob_hash, "start": 2, "limit": 3}]


@pytest.mark.asyncio
async def test_cat_defaults_to_raw_text_for_json(monkeypatch):
    _patch_auth(monkeypatch)
    raw = b'{\n  "b": 1,\n  "a": 2\n}\n'
    result = await apfs.read_file(
        path="data.json",
        structured=False,
        x_access_key="key",
        x_mut_user=None,
        x_puppy_client=None,
        ops=_FakeOps(files={"data.json": raw}),
    )

    assert result.data["content"] is None
    assert result.data["content_text"] == raw.decode("utf-8")


@pytest.mark.asyncio
async def test_cat_structured_mode_parses_json(monkeypatch):
    _patch_auth(monkeypatch)
    raw = b'{\n  "b": 1,\n  "a": 2\n}\n'
    result = await apfs.read_file(
        path="data.json",
        structured=True,
        x_access_key="key",
        x_mut_user=None,
        x_puppy_client=None,
        ops=_FakeOps(files={"data.json": raw}),
    )

    assert result.data["content"] == {"b": 1, "a": 2}
    assert result.data["content_text"] is None


@pytest.mark.asyncio
async def test_raw_file_returns_unmodified_bytes(monkeypatch):
    _patch_auth(monkeypatch)
    raw = b"\x00raw\nbytes"

    result = await apfs.raw_file(
        path="blob.bin",
        start=0,
        limit=None,
        x_access_key="key",
        x_mut_user=None,
        x_puppy_client=None,
        ops=_FakeOps(files={"blob.bin": raw}),
    )

    assert result.body == raw
    assert result.headers["content-length"] == str(len(raw))


@pytest.mark.asyncio
async def test_raw_file_can_return_byte_slice(monkeypatch):
    _patch_auth(monkeypatch)
    raw = b"abcdef"
    ops = _FakeOps(files={"blob.bin": raw})

    result = await apfs.raw_file(
        path="blob.bin",
        start=2,
        limit=3,
        x_access_key="key",
        x_mut_user=None,
        x_puppy_client=None,
        ops=ops,
    )

    assert result.body == b"cde"
    assert result.headers["x-puppyone-size"] == "6"
    assert ops.ranges == [{"path": "blob.bin", "start": 2, "limit": 3}]


@pytest.mark.asyncio
async def test_upload_writes_raw_bytes_through_mut_ops(monkeypatch):
    _patch_auth(monkeypatch)
    ops = _FakeOps()

    class _Request:
        async def body(self):
            return b"\x00bytes"

    result = await apfs.upload_file(
        request=_Request(),
        path="bin.dat",
        base_commit_id="base",
        message="upload",
        x_access_key="key",
        x_mut_user=None,
        x_puppy_client=None,
        ops=ops,
    )

    assert result.data["commit_id"] == "write-commit"
    assert result.data["size_bytes"] == 6
    assert ops.writes[0]["path"] == "bin.dat"
    assert ops.writes[0]["content"] == b"\x00bytes"


@pytest.mark.asyncio
async def test_ls_file_returns_the_file_itself(monkeypatch):
    _patch_auth(monkeypatch)
    file_entry = _entry("docs/readme.md", "markdown", size_bytes=12)
    result = await apfs.list_dir(
        path="docs/readme.md",
        include_size=True,
        x_access_key="key",
        x_mut_user=None,
        x_puppy_client=None,
        ops=_FakeOps(stats={"docs/readme.md": file_entry}),
    )

    assert result.data["target_type"] == "markdown"
    assert [entry["path"] for entry in result.data["entries"]] == ["docs/readme.md"]


@pytest.mark.asyncio
async def test_ls_missing_path_raises_not_found(monkeypatch):
    _patch_auth(monkeypatch)

    with pytest.raises(HTTPException) as exc:
        await apfs.list_dir(
            path="missing",
            x_access_key="key",
            x_mut_user=None,
            x_puppy_client=None,
            ops=_FakeOps(),
        )

    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_tree_directories_only_filters_files(monkeypatch):
    _patch_auth(monkeypatch)
    result = await apfs.tree(
        path="",
        directories_only=True,
        x_access_key="key",
        x_mut_user=None,
        x_puppy_client=None,
        ops=_FakeOps(
            stats={"": _entry("", "folder")},
            tree=[
                _entry("docs", "folder"),
                _entry("docs/readme.md", "markdown"),
                _entry("src", "folder"),
            ],
        ),
    )

    assert result.data["directories_only"] is True
    assert [entry["path"] for entry in result.data["entries"]] == ["docs", "src"]


@pytest.mark.asyncio
async def test_tree_limit_marks_truncated(monkeypatch):
    _patch_auth(monkeypatch)
    result = await apfs.tree(
        path="",
        limit=2,
        x_access_key="key",
        x_mut_user=None,
        x_puppy_client=None,
        ops=_FakeOps(
            stats={"": _entry("", "folder")},
            tree=[
                _entry("a.txt", "file"),
                _entry("b.txt", "file"),
                _entry("c.txt", "file"),
            ],
        ),
    )

    assert result.data["limit"] == 2
    assert result.data["truncated"] is True
    assert result.data["complete"] is False
    assert result.data["returned_count"] == 2
    assert result.data["truncation_reason"] == "entry_limit_exceeded"
    assert [entry["path"] for entry in result.data["entries"]] == ["a.txt", "b.txt"]


@pytest.mark.asyncio
async def test_tree_missing_path_raises_not_found(monkeypatch):
    _patch_auth(monkeypatch)

    with pytest.raises(HTTPException) as exc:
        await apfs.tree(
            path="missing",
            x_access_key="key",
            x_mut_user=None,
            x_puppy_client=None,
            ops=_FakeOps(),
        )

    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_mkdir_without_parents_requires_existing_parent(monkeypatch):
    _patch_auth(monkeypatch)
    ops = _FakeOps()

    with pytest.raises(HTTPException) as exc:
        await apfs.mkdir(
            apfs.MkdirRequest(path="a/b"),
            x_access_key="key",
            x_mut_user=None,
            x_puppy_client=None,
            ops=ops,
        )

    assert exc.value.status_code == 404
    assert ops.mkdirs == []


@pytest.mark.asyncio
async def test_mkdir_parents_allows_missing_parent(monkeypatch):
    _patch_auth(monkeypatch)
    ops = _FakeOps()

    result = await apfs.mkdir(
        apfs.MkdirRequest(path="a/b", parents=True, base_commit_id="base"),
        x_access_key="key",
        x_mut_user=None,
        x_puppy_client=None,
        ops=ops,
    )

    assert result.data["commit_id"] == "mkdir-commit"
    assert ops.mkdirs[0]["path"] == "a/b"
    assert ops.mkdirs[0]["base_commit_id"] == "base"


@pytest.mark.asyncio
async def test_mkdir_parents_existing_directory_is_noop(monkeypatch):
    _patch_auth(monkeypatch)
    ops = _FakeOps(stats={"dir": _entry("dir", "folder")})

    result = await apfs.mkdir(
        apfs.MkdirRequest(path="dir", parents=True),
        x_access_key="key",
        x_mut_user=None,
        x_puppy_client=None,
        ops=ops,
    )

    assert result.data["created"] is False
    assert result.data["commit_id"] == ""
    assert ops.mkdirs == []


@pytest.mark.asyncio
async def test_mkdir_existing_directory_without_parents_raises(monkeypatch):
    _patch_auth(monkeypatch)
    ops = _FakeOps(stats={"dir": _entry("dir", "folder")})

    with pytest.raises(HTTPException) as exc:
        await apfs.mkdir(
            apfs.MkdirRequest(path="dir"),
            x_access_key="key",
            x_mut_user=None,
            x_puppy_client=None,
            ops=ops,
        )

    assert exc.value.status_code == 400
    assert ops.mkdirs == []


@pytest.mark.asyncio
async def test_mv_existing_directory_target_moves_inside_it(monkeypatch):
    _patch_auth(monkeypatch)
    ops = _FakeOps(stats={
        "a.txt": _entry("a.txt", "file"),
        "dir": _entry("dir", "folder"),
    })

    result = await apfs.move(
        apfs.MoveRequest(old_path="a.txt", new_path="dir"),
        x_access_key="key",
        x_mut_user=None,
        x_puppy_client=None,
        ops=ops,
    )

    assert result.data["new_path"] == "dir/a.txt"
    assert ops.moves[0]["new_path"] == "dir/a.txt"


@pytest.mark.asyncio
async def test_mv_no_clobber_skips_existing_destination(monkeypatch):
    _patch_auth(monkeypatch)
    ops = _FakeOps(stats={
        "a.txt": _entry("a.txt", "file"),
        "b.txt": _entry("b.txt", "file"),
    })

    result = await apfs.move(
        apfs.MoveRequest(old_path="a.txt", new_path="b.txt", no_clobber=True),
        x_access_key="key",
        x_mut_user=None,
        x_puppy_client=None,
        ops=ops,
    )

    assert result.data["skipped"] is True
    assert result.data["commit_id"] == ""
    assert ops.moves == []


@pytest.mark.asyncio
async def test_touch_missing_file_writes_empty_file_through_mut_ops(monkeypatch):
    _patch_auth(monkeypatch)
    ops = _FakeOps()

    result = await apfs.touch(
        apfs.TouchRequest(path="new.txt", base_commit_id="base"),
        x_access_key="key",
        x_mut_user=None,
        x_puppy_client=None,
        ops=ops,
    )

    assert result.data["created"] is True
    assert result.data["commit_id"] == "write-commit"
    assert ops.writes == [{
        "project_id": "project-id",
        "path": "new.txt",
        "content": b"",
        "who": "access_point:test-ap",
        "scope": "",
        "message": "ap touch new.txt",
        "base_commit_id": "base",
    }]


@pytest.mark.asyncio
async def test_touch_existing_file_records_mtime_commit(monkeypatch):
    _patch_auth(monkeypatch)
    ops = _FakeOps(stats={"existing.txt": _entry("existing.txt", "file")})

    result = await apfs.touch(
        apfs.TouchRequest(path="existing.txt"),
        x_access_key="key",
        x_mut_user=None,
        x_puppy_client=None,
        ops=ops,
    )

    assert result.data["created"] is False
    assert result.data["commit_id"] == "touch-commit"
    assert ops.writes == []
    assert ops.touches[0]["paths"] == ["existing.txt"]


@pytest.mark.asyncio
async def test_cp_existing_directory_target_copies_inside_it(monkeypatch):
    _patch_auth(monkeypatch)
    ops = _FakeOps(stats={
        "a.txt": _entry("a.txt", "file"),
        "dir": _entry("dir", "folder"),
    })

    result = await apfs.copy(
        apfs.CopyRequest(old_path="a.txt", new_path="dir"),
        x_access_key="key",
        x_mut_user=None,
        x_puppy_client=None,
        ops=ops,
    )

    assert result.data["new_path"] == "dir/a.txt"
    assert result.data["commit_id"] == "copy-commit"
    assert ops.copies[0]["new_path"] == "dir/a.txt"


@pytest.mark.asyncio
async def test_cp_directory_requires_recursive(monkeypatch):
    _patch_auth(monkeypatch)
    ops = _FakeOps(stats={"docs": _entry("docs", "folder")})

    with pytest.raises(HTTPException) as exc:
        await apfs.copy(
            apfs.CopyRequest(old_path="docs", new_path="docs-copy"),
            x_access_key="key",
            x_mut_user=None,
            x_puppy_client=None,
            ops=ops,
        )

    assert exc.value.status_code == 400
    assert ops.copies == []


@pytest.mark.asyncio
async def test_cp_no_clobber_skips_existing_destination(monkeypatch):
    _patch_auth(monkeypatch)
    ops = _FakeOps(stats={
        "a.txt": _entry("a.txt", "file"),
        "b.txt": _entry("b.txt", "file"),
    })

    result = await apfs.copy(
        apfs.CopyRequest(old_path="a.txt", new_path="b.txt", no_clobber=True),
        x_access_key="key",
        x_mut_user=None,
        x_puppy_client=None,
        ops=ops,
    )

    assert result.data["skipped"] is True
    assert result.data["commit_id"] == ""
    assert ops.copies == []


@pytest.mark.asyncio
async def test_rmdir_removes_empty_directory_through_mut_ops(monkeypatch):
    _patch_auth(monkeypatch)
    ops = _FakeOps(
        stats={"empty": _entry("empty", "folder")},
        list_by_path={"empty": []},
    )

    result = await apfs.rmdir(
        apfs.RmdirRequest(path="empty", base_commit_id="base"),
        x_access_key="key",
        x_mut_user=None,
        x_puppy_client=None,
        ops=ops,
    )

    assert result.data["removed_paths"] == ["empty"]
    assert result.data["commit_id"] == "delete-commit"
    assert ops.deletes[0]["paths"] == ["empty"]
    assert ops.deletes[0]["base_commit_id"] == "base"


@pytest.mark.asyncio
async def test_rmdir_rejects_non_empty_directory(monkeypatch):
    _patch_auth(monkeypatch)
    ops = _FakeOps(
        stats={"dir": _entry("dir", "folder")},
        list_by_path={"dir": [_entry("dir/file.txt", "file")]},
    )

    with pytest.raises(HTTPException) as exc:
        await apfs.rmdir(
            apfs.RmdirRequest(path="dir"),
            x_access_key="key",
            x_mut_user=None,
            x_puppy_client=None,
            ops=ops,
        )

    assert exc.value.status_code == 400
    assert ops.deletes == []


@pytest.mark.asyncio
async def test_rmdir_parents_removes_empty_parent_chain(monkeypatch):
    _patch_auth(monkeypatch)
    ops = _FakeOps(
        stats={
            "a": _entry("a", "folder"),
            "a/b": _entry("a/b", "folder"),
            "a/b/c": _entry("a/b/c", "folder"),
        },
        list_by_path={
            "a/b/c": [],
            "a/b": [_entry("a/b/c", "folder")],
            "a": [_entry("a/b", "folder")],
        },
    )

    result = await apfs.rmdir(
        apfs.RmdirRequest(path="a/b/c", parents=True),
        x_access_key="key",
        x_mut_user=None,
        x_puppy_client=None,
        ops=ops,
    )

    assert result.data["removed_paths"] == ["a/b/c", "a/b", "a"]
    assert ops.deletes[0]["paths"] == ["a/b/c", "a/b", "a"]


@pytest.mark.asyncio
async def test_rm_accepts_multiple_paths(monkeypatch):
    _patch_auth(monkeypatch)
    ops = _FakeOps(stats={
        "a.txt": _entry("a.txt", "file"),
        "b.txt": _entry("b.txt", "file"),
    })

    result = await apfs.remove(
        apfs.RemoveRequest(paths=["a.txt", "b.txt"], recursive=False),
        x_access_key="key",
        x_mut_user=None,
        x_puppy_client=None,
        ops=ops,
    )

    assert result.data["paths"] == ["a.txt", "b.txt"]
    assert ops.deletes[0]["paths"] == ["a.txt", "b.txt"]
