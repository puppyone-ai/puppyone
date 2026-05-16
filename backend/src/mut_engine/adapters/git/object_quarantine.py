"""Temporary Git object materialization and quarantine helpers."""

from __future__ import annotations

import tempfile
from contextlib import contextmanager
from pathlib import Path

from src.mut_engine.adapters.git.protocol import (
    ZERO_ID,
    is_object_id,
    run_git,
)
from src.mut_engine.adapters.git.view_projection import git_view_head_commit
from src.mut_engine.application.git_object_format import MODE_DIR, decode_commit, decode_tree


@contextmanager
def temporary_bare_repo(repo, scope_path: str, scope_excludes: list[str] | None = None):
    with tempfile.TemporaryDirectory(prefix="puppyone-git-") as tmp:
        bare_dir = Path(tmp) / "repo.git"
        run_git(["init", "--bare", str(bare_dir)])
        (bare_dir / "HEAD").write_text("ref: refs/heads/main\n", encoding="utf-8")
        head = git_view_head_commit(repo, scope_path, scope_excludes)
        copy_reachable_objects_to_bare(repo, bare_dir, [head])
        if head:
            ref_path = bare_dir / "refs" / "heads" / "main"
            ref_path.parent.mkdir(parents=True, exist_ok=True)
            ref_path.write_text(f"{head}\n", encoding="ascii")
        yield bare_dir


class GitObjectQuarantine:
    """Validated temporary Git object database for one receive-pack request."""

    def __init__(self, *, repo, bare_dir: Path, roots: list[str]):
        self.repo = repo
        self.bare_dir = bare_dir
        self.roots = roots
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

    def flatten_tree_to_bytes(self, tree_id: str) -> dict[str, bytes]:
        out: dict[str, bytes] = {}
        self._flatten_tree(tree_id, "", out)
        return out

    def promote_reachable(self) -> None:
        """Promote accepted reachable objects into PuppyOne's canonical store."""

        if self._promoted:
            return
        objects_dir = self.bare_dir / "objects"
        for object_id in _reachable_object_ids_from_bare(self.bare_dir, self.roots):
            loose = objects_dir / object_id[:2] / object_id[2:]
            if not loose.exists():
                continue
            self.repo.store.put_loose(object_id, loose.read_bytes())
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
) -> GitObjectQuarantine:
    if not pack:
        raise ValueError("receive-pack request has no pack data")
    root_ids = roots or []
    with temporary_bare_repo(repo, scope_path) as bare_dir:
        try:
            _unpack_and_validate(bare_dir, pack, root_ids)
        except Exception:
            # Some Git clients send thin packs delta-compressed against objects
            # that are no longer reachable from the advertised scope head. The
            # real production shape should use a permanent object database /
            # alternates; until then, fall back to whole-store materialization
            # only for this recovery path.
            copy_store_objects_to_bare(repo, bare_dir)
            _unpack_and_validate(bare_dir, pack, root_ids)
        yield GitObjectQuarantine(repo=repo, bare_dir=bare_dir, roots=root_ids)


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
    for object_id in _reachable_object_ids(repo, roots):
        try:
            loose = repo.store.get_loose(object_id)
        except Exception:
            continue
        target = objects_dir / object_id[:2] / object_id[2:]
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            target.write_bytes(loose)


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


def _reachable_object_ids_from_bare(bare_dir: Path, roots: list[str]) -> set[str]:
    reachable: set[str] = set()
    stack = [root for root in roots if is_object_id(root) and root != ZERO_ID]
    while stack:
        object_id = stack.pop()
        if object_id in reachable:
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


def copy_store_objects_to_bare(repo, bare_dir: Path) -> None:
    objects_dir = bare_dir / "objects"
    for object_id in repo.store.all_hashes():
        if not is_object_id(object_id) or object_id == ZERO_ID:
            continue
        try:
            loose = repo.store.get_loose(object_id)
        except Exception:
            continue
        target = objects_dir / object_id[:2] / object_id[2:]
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            target.write_bytes(loose)


def copy_bare_objects_to_store(repo, bare_dir: Path) -> None:
    objects_dir = bare_dir / "objects"
    for shard in objects_dir.iterdir():
        if not shard.is_dir() or len(shard.name) != 2:
            continue
        for obj in shard.iterdir():
            object_id = shard.name + obj.name
            if is_object_id(object_id):
                repo.store.put_loose(object_id, obj.read_bytes())
