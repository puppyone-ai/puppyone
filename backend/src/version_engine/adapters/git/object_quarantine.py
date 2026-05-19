"""Git transport-only object materialization and quarantine helpers.

These helpers are intentionally scoped to smart-HTTP clone/fetch/push.
They may walk reachable Git objects to satisfy Git protocol expectations,
but product Save/Product API writes must never import them. Product writes
operate on content hashes, Merkle tree splices, shallow parent validation,
and DB CAS only.
"""

from __future__ import annotations

import fcntl
import hashlib
import json
import tempfile
from contextlib import contextmanager
from pathlib import Path

from src.version_engine.adapters.git.protocol import (
    ZERO_ID,
    is_object_id,
    run_git,
)
from src.version_engine.adapters.git.view_projection import git_view_head_commit
from src.version_engine.write_engine.git_object_format import (
    MODE_DIR,
    decode_commit,
    decode_tree,
    encode_object,
)
from src.version_engine.write_engine.object_store import stage_object_writes

_TRANSPORT_CACHE_ROOT = Path(tempfile.gettempdir()) / "puppyone-git-transport-cache-v1"


@contextmanager
def transport_bare_repo(
    repo,
    scope_path: str,
    scope_excludes: list[str] | None = None,
):
    """Yield an incrementally maintained bare repo for one Git view.

    The cache is keyed by project + canonical object-store namespace + scope +
    excludes. It is a transport cache, not an authority: PuppyOne's object
    store and DB ref state remain canonical. Each request advances the cache
    only by copying objects that are reachable from the current scope view head
    and missing locally. Once an object is already in the cache we treat its
    reachable closure as cached too, so a one-file commit only copies the new
    commit plus the changed tree chain/blob instead of re-copying the whole
    scope graph.
    """

    cache_dir = _transport_cache_dir(repo, scope_path, scope_excludes)
    cache_dir.mkdir(parents=True, exist_ok=True)
    lock_path = cache_dir / "cache.lock"
    with lock_path.open("a+b") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            bare_dir = cache_dir / "repo.git"
            _ensure_bare_repo(bare_dir)
            head = git_view_head_commit(repo, scope_path, scope_excludes)
            copy_reachable_objects_to_bare(repo, bare_dir, [head])
            _write_main_ref(bare_dir, head)
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)
    yield bare_dir


@contextmanager
def quarantine_bare_repo(
    repo,
    scope_path: str,
    scope_excludes: list[str] | None = None,
) -> Path:
    """Yield an isolated receive-pack object DB with cache alternates."""

    with transport_bare_repo(repo, scope_path, scope_excludes) as cache_bare:
        with tempfile.TemporaryDirectory(prefix="puppyone-git-quarantine-") as tmp:
            bare_dir = Path(tmp) / "repo.git"
            _ensure_bare_repo(bare_dir)
            alternates = bare_dir / "objects" / "info" / "alternates"
            alternates.parent.mkdir(parents=True, exist_ok=True)
            alternates.write_text(
                f"{(cache_bare / 'objects').resolve()}\n",
                encoding="utf-8",
            )
            cache_ref = cache_bare / "refs" / "heads" / "main"
            if cache_ref.exists():
                _write_main_ref(bare_dir, cache_ref.read_text(encoding="ascii").strip())
            yield bare_dir


class GitObjectQuarantine:
    """Validated temporary Git object database for one receive-pack request."""

    def __init__(
        self,
        *,
        repo,
        bare_dir: Path,
        roots: list[str],
        exclude_roots: list[str] | None = None,
    ):
        self.repo = repo
        self.bare_dir = bare_dir
        self.roots = roots
        self.exclude_roots = exclude_roots or []
        self._promoted = False

    def get_object(self, object_id: str) -> tuple[str, bytes]:
        obj_type = run_git([
            "--git-dir",
            str(self.bare_dir),
            "cat-file",
            "-t",
            object_id,
        ]).decode("ascii", errors="replace").strip()
        body = run_git([
            "--git-dir",
            str(self.bare_dir),
            "cat-file",
            obj_type,
            object_id,
        ])
        return obj_type, body

    def object_size(self, object_id: str) -> int:
        raw = run_git([
            "--git-dir",
            str(self.bare_dir),
            "cat-file",
            "-s",
            object_id,
        ])
        return int(raw.decode("ascii", errors="replace").strip() or "0")

    def changed_paths(self, old_commit_id: str, new_commit_id: str) -> list[str]:
        if is_object_id(old_commit_id) and old_commit_id != ZERO_ID:
            out = run_git([
                "--git-dir",
                str(self.bare_dir),
                "diff-tree",
                "-r",
                "--no-commit-id",
                "--name-only",
                "-z",
                old_commit_id,
                new_commit_id,
            ])
        else:
            out = run_git([
                "--git-dir",
                str(self.bare_dir),
                "ls-tree",
                "-r",
                "-z",
                "--name-only",
                new_commit_id,
            ])
        return [
            item.decode("utf-8", errors="replace")
            for item in out.split(b"\x00")
            if item
        ]

    def commit_is_ancestor_or_same(self, ancestor_id: str, descendant_id: str) -> bool:
        if not (
            is_object_id(ancestor_id)
            and ancestor_id != ZERO_ID
            and is_object_id(descendant_id)
            and descendant_id != ZERO_ID
        ):
            return False
        if ancestor_id == descendant_id:
            return True
        try:
            run_git([
                "--git-dir",
                str(self.bare_dir),
                "merge-base",
                "--is-ancestor",
                ancestor_id,
                descendant_id,
            ])
            return True
        except Exception:
            return False

    def blob_id_for_path(self, tree_id: str, path: str) -> str:
        current = tree_id
        parts = [part for part in path.split("/") if part]
        for index, part in enumerate(parts):
            obj_type, body = self.get_object(current)
            if obj_type != "tree":
                return ""
            for entry in decode_tree(body):
                if entry.name != part:
                    continue
                if index == len(parts) - 1:
                    return "" if entry.mode == MODE_DIR else entry.sha1_hex
                if entry.mode != MODE_DIR:
                    return ""
                current = entry.sha1_hex
                break
            else:
                return ""
        return ""

    def flatten_tree_to_bytes(self, tree_id: str) -> dict[str, bytes]:
        out: dict[str, bytes] = {}
        self._flatten_tree(tree_id, "", out)
        return out

    def promote_reachable(self) -> None:
        """Promote accepted reachable objects into PuppyOne's canonical store."""

        if self._promoted:
            return
        objects_dir = self.bare_dir / "objects"
        object_ids = sorted(
            _reachable_object_ids_from_bare(
                self.bare_dir,
                self.roots,
                exclude_roots=self.exclude_roots,
            )
        )
        if not object_ids:
            self._promoted = True
            return

        existing = self.repo.store.exists_many(object_ids)
        missing = [object_id for object_id in object_ids if object_id not in existing]
        if not missing:
            self._promoted = True
            return

        with stage_object_writes(self.repo.store) as object_batch:
            for object_id in missing:
                loose_bytes = None
                loose = objects_dir / object_id[:2] / object_id[2:]
                if loose.exists():
                    loose_bytes = loose.read_bytes()
                else:
                    obj_type, body = self.get_object(object_id)
                    encoded_id, loose_bytes = encode_object(obj_type, body)
                    if encoded_id != object_id:
                        raise ValueError(
                            f"quarantine object hash mismatch: {object_id} != {encoded_id}"
                        )
                self.repo.store.put_loose(object_id, loose_bytes)
            if object_batch is not None:
                object_batch.flush()
        self._promoted = True

    def _flatten_tree(self, tree_id: str, prefix: str, out: dict[str, bytes]) -> None:
        obj_type, body = self.get_object(tree_id)
        if obj_type != "tree":
            raise ValueError(f"object {tree_id} is not a tree")
        for entry in decode_tree(body):
            path = f"{prefix}/{entry.name}" if prefix else entry.name
            if entry.mode == MODE_DIR:
                self._flatten_tree(entry.sha1_hex, path, out)
            else:
                blob_type, blob = self.get_object(entry.sha1_hex)
                if blob_type != "blob":
                    raise ValueError(f"object {entry.sha1_hex} is not a blob")
                out[path] = blob


@contextmanager
def quarantine_pack(
    repo,
    scope_path: str,
    pack: bytes,
    roots: list[str] | None = None,
    exclude_roots: list[str] | None = None,
    scope_excludes: list[str] | None = None,
) -> GitObjectQuarantine:
    if not pack:
        raise ValueError("receive-pack request has no pack data")
    root_ids = roots or []
    with quarantine_bare_repo(repo, scope_path, scope_excludes) as bare_dir:
        _unpack_and_validate(bare_dir, pack, root_ids)
        yield GitObjectQuarantine(
            repo=repo,
            bare_dir=bare_dir,
            roots=root_ids,
            exclude_roots=exclude_roots or [],
        )


def _unpack_and_validate(bare_dir: Path, pack: bytes, roots: list[str]) -> None:
    run_git(
        ["--git-dir", str(bare_dir), "unpack-objects", "-q"],
        input_data=pack,
    )
    _write_quarantine_refs(bare_dir, roots)
    run_git([
        "--git-dir",
        str(bare_dir),
        "fsck",
        "--connectivity-only",
        "--strict",
        "--no-dangling",
    ])


def _write_quarantine_refs(bare_dir: Path, roots: list[str]) -> None:
    refs_dir = bare_dir / "refs" / "puppyone" / "quarantine"
    for index, object_id in enumerate(roots):
        if not is_object_id(object_id) or object_id == ZERO_ID:
            continue
        refs_dir.mkdir(parents=True, exist_ok=True)
        (refs_dir / str(index)).write_text(f"{object_id}\n", encoding="ascii")


def copy_reachable_objects_to_bare(repo, bare_dir: Path, roots: list[str]) -> None:
    objects_dir = bare_dir / "objects"
    for object_id in _missing_reachable_object_ids(repo, bare_dir, roots):
        try:
            loose = repo.store.get_loose(object_id)
        except Exception:
            continue
        target = objects_dir / object_id[:2] / object_id[2:]
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            target.write_bytes(loose)


def _transport_cache_dir(
    repo,
    scope_path: str,
    scope_excludes: list[str] | None,
) -> Path:
    project_id = str(getattr(repo, "_project_id", "") or "unknown-project")
    payload = {
        "project_id": project_id,
        "object_store": _object_store_namespace(repo),
        "scope_path": scope_path or "",
        "scope_excludes": sorted(scope_excludes or []),
    }
    digest = hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    safe_project = "".join(
        ch if ch.isalnum() or ch in {"-", "_"} else "_"
        for ch in project_id
    )[:80] or "unknown-project"
    return _TRANSPORT_CACHE_ROOT / safe_project / digest


def _object_store_namespace(repo) -> str:
    store = getattr(repo, "store", None)
    store_dir = getattr(store, "dir", None)
    backend = getattr(store, "_backend", None)
    backend_namespace = _backend_namespace(backend)
    if backend_namespace:
        return backend_namespace
    if store_dir:
        return f"store-dir:{Path(store_dir).expanduser().resolve()}"
    project_id = str(getattr(repo, "_project_id", "") or "unknown-project")
    return f"project:{project_id}"


def _backend_namespace(backend) -> str:
    if backend is None:
        return ""
    inner = getattr(backend, "_inner", None)
    if inner is not None:
        inner_namespace = _backend_namespace(inner)
        if inner_namespace:
            return f"{backend.__class__.__name__}:{inner_namespace}"
    backend_dir = getattr(backend, "dir", None)
    if backend_dir:
        return f"{backend.__class__.__name__}:{Path(backend_dir).expanduser().resolve()}"
    prefix = getattr(backend, "_prefix", "")
    s3 = getattr(backend, "_s3", None)
    if prefix:
        bucket = getattr(s3, "bucket_name", "")
        endpoint = getattr(s3, "endpoint_url", "")
        region = getattr(s3, "region", "")
        return (
            f"{backend.__class__.__name__}:"
            f"{endpoint or region}:{bucket}:{prefix}"
        )
    return ""


def _ensure_bare_repo(bare_dir: Path) -> None:
    if not (bare_dir / "objects").exists():
        run_git(["init", "--bare", str(bare_dir)])
    (bare_dir / "HEAD").write_text("ref: refs/heads/main\n", encoding="utf-8")


def _write_main_ref(bare_dir: Path, head: str) -> None:
    ref_path = bare_dir / "refs" / "heads" / "main"
    if head:
        ref_path.parent.mkdir(parents=True, exist_ok=True)
        ref_path.write_text(f"{head}\n", encoding="ascii")
    elif ref_path.exists():
        ref_path.unlink()


def _bare_has_object(bare_dir: Path, object_id: str) -> bool:
    loose = bare_dir / "objects" / object_id[:2] / object_id[2:]
    return loose.exists()


def _missing_reachable_object_ids(repo, bare_dir: Path, roots: list[str]) -> set[str]:
    missing: set[str] = set()
    stack = [root for root in roots if is_object_id(root) and root != ZERO_ID]
    while stack:
        object_id = stack.pop()
        if object_id in missing:
            continue
        if _bare_has_object(bare_dir, object_id):
            continue
        missing.add(object_id)
        try:
            obj_type, body = repo.store.get_object(object_id)
        except Exception:
            continue
        if obj_type == "commit":
            commit = decode_commit(body)
            tree = commit.get("tree", "")
            if is_object_id(tree):
                stack.append(tree)
            for parent in commit.get("parents") or []:
                if is_object_id(parent):
                    stack.append(parent)
        elif obj_type == "tree":
            for entry in decode_tree(body):
                if is_object_id(entry.sha1_hex):
                    stack.append(entry.sha1_hex)
    return missing


def _reachable_object_ids(repo, roots: list[str]) -> set[str]:
    reachable: set[str] = set()
    stack = [root for root in roots if is_object_id(root) and root != ZERO_ID]
    while stack:
        object_id = stack.pop()
        if object_id in reachable:
            continue
        reachable.add(object_id)
        try:
            obj_type, body = repo.store.get_object(object_id)
        except Exception:
            continue
        if obj_type == "commit":
            commit = decode_commit(body)
            tree = commit.get("tree", "")
            if is_object_id(tree):
                stack.append(tree)
            for parent in commit.get("parents") or []:
                if is_object_id(parent):
                    stack.append(parent)
        elif obj_type == "tree":
            for entry in decode_tree(body):
                if is_object_id(entry.sha1_hex):
                    stack.append(entry.sha1_hex)
    return reachable


def _reachable_object_ids_from_bare(
    bare_dir: Path,
    roots: list[str],
    *,
    exclude_roots: list[str] | None = None,
) -> set[str]:
    fast = _rev_list_object_ids_from_bare(
        bare_dir,
        roots,
        exclude_roots=exclude_roots or [],
    )
    if fast is not None:
        return fast

    reachable: set[str] = set()
    stack = [root for root in roots if is_object_id(root) and root != ZERO_ID]
    excluded = set(
        _reachable_object_ids_from_bare(bare_dir, exclude_roots or [])
        if exclude_roots else set()
    )
    while stack:
        object_id = stack.pop()
        if object_id in reachable or object_id in excluded:
            continue
        reachable.add(object_id)
        try:
            obj_type = run_git([
                "--git-dir",
                str(bare_dir),
                "cat-file",
                "-t",
                object_id,
            ]).decode("ascii", errors="replace").strip()
            body = run_git([
                "--git-dir",
                str(bare_dir),
                "cat-file",
                obj_type,
                object_id,
            ])
        except Exception:
            continue
        if obj_type == "commit":
            commit = decode_commit(body)
            tree = commit.get("tree", "")
            if is_object_id(tree):
                stack.append(tree)
            for parent in commit.get("parents") or []:
                if is_object_id(parent):
                    stack.append(parent)
        elif obj_type == "tree":
            for entry in decode_tree(body):
                if is_object_id(entry.sha1_hex):
                    stack.append(entry.sha1_hex)
    return reachable


def _rev_list_object_ids_from_bare(
    bare_dir: Path,
    roots: list[str],
    *,
    exclude_roots: list[str],
) -> set[str] | None:
    include = [root for root in roots if is_object_id(root) and root != ZERO_ID]
    if not include:
        return set()
    exclude = [
        root for root in exclude_roots
        if is_object_id(root) and root != ZERO_ID
    ]
    args = [
        "--git-dir",
        str(bare_dir),
        "rev-list",
        "--objects",
        *include,
    ]
    if exclude:
        args.extend(["--not", *exclude])
    try:
        out = run_git(args)
    except Exception:
        return None

    object_ids: set[str] = set()
    for raw_line in out.splitlines():
        token = raw_line.split(maxsplit=1)[0].decode("ascii", errors="ignore")
        if is_object_id(token) and token != ZERO_ID:
            object_ids.add(token)
    return object_ids


def copy_bare_objects_to_store(repo, bare_dir: Path) -> None:
    objects_dir = bare_dir / "objects"
    for shard in objects_dir.iterdir():
        if not shard.is_dir() or len(shard.name) != 2:
            continue
        for obj in shard.iterdir():
            object_id = shard.name + obj.name
            if is_object_id(object_id):
                repo.store.put_loose(object_id, obj.read_bytes())
