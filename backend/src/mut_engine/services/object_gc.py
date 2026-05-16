"""Conservative mark-and-sweep GC for Git-native object storage.

Accepted Git pushes can promote immutable objects before the final SQL CAS
publish point. If another writer wins that CAS race, those promoted objects are
safe but unreachable. This module cleans that class of orphan without changing
the concurrency model: live writes still use optimistic CAS; GC runs later from
database-authoritative roots and only sweeps objects outside a retention window.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from src.mut_engine.infrastructure.git_format import decode_commit, decode_tree

from src.mut_engine.adapters.git.protocol import ZERO_ID, is_object_id
from src.mut_engine.services.object_compat import read_tree_compat
from src.utils.logger import log_warning


DEFAULT_RETENTION_SECONDS = 7 * 24 * 60 * 60
_SAMPLE_LIMIT = 20


@dataclass(frozen=True)
class GitObjectGcResult:
    project_id: str
    dry_run: bool
    total_objects: int
    root_count: int
    reachable_count: int
    unreachable_count: int
    eligible_count: int
    deleted_count: int
    kept_young_count: int
    kept_unknown_age_count: int
    kept_protected_descendant_count: int
    errors: list[str] = field(default_factory=list)
    deleted_sample: list[str] = field(default_factory=list)
    unreachable_sample: list[str] = field(default_factory=list)


def run_git_object_gc(
    repo,
    *,
    dry_run: bool = True,
    retention_seconds: int = DEFAULT_RETENTION_SECONDS,
    max_delete: int | None = None,
    now: datetime | None = None,
) -> GitObjectGcResult:
    """Collect unreachable objects for one repo and optionally delete them.

    ``retention_seconds`` is the safety valve. Pass ``0`` in tests or manual
    emergency cleanup when the caller deliberately wants immediate sweeping.
    With a positive retention window, objects whose age cannot be determined
    are kept rather than guessed.
    """

    project_id = getattr(repo, "_project_id", "") or ""
    errors: list[str] = []
    roots = collect_object_gc_roots(repo, errors=errors)
    reachable = mark_reachable_objects(repo, roots, errors=errors)
    all_objects = _all_object_ids(repo, errors=errors)
    metadata = _object_metadata(repo, errors=errors)
    now = _aware_now(now)

    unreachable = sorted(
        object_id for object_id in all_objects
        if object_id not in reachable
    )

    eligible: list[str] = []
    protected_roots: set[str] = set()
    kept_young = 0
    kept_unknown_age = 0
    for object_id in unreachable:
        if _object_is_old_enough(
            object_id,
            metadata,
            retention_seconds=retention_seconds,
            now=now,
        ):
            eligible.append(object_id)
        elif retention_seconds <= 0:
            eligible.append(object_id)
        elif object_id not in metadata:
            kept_unknown_age += 1
            protected_roots.add(object_id)
        else:
            kept_young += 1
            protected_roots.add(object_id)

    protected = mark_reachable_objects(repo, protected_roots, errors=errors)
    protected_descendants = set(eligible).intersection(protected)
    if protected_descendants:
        eligible = [
            object_id for object_id in eligible
            if object_id not in protected_descendants
        ]

    if max_delete is not None:
        eligible = eligible[:max(0, int(max_delete))]

    deleted: list[str] = []
    if not dry_run:
        for object_id in eligible:
            try:
                if _delete_object(repo, object_id):
                    deleted.append(object_id)
            except Exception as exc:  # noqa: BLE001 - GC must continue.
                errors.append(f"delete {object_id}: {exc}")

    return GitObjectGcResult(
        project_id=project_id,
        dry_run=dry_run,
        total_objects=len(all_objects),
        root_count=len(roots),
        reachable_count=len(reachable),
        unreachable_count=len(unreachable),
        eligible_count=len(eligible),
        deleted_count=len(deleted),
        kept_young_count=kept_young,
        kept_unknown_age_count=kept_unknown_age,
        kept_protected_descendant_count=len(protected_descendants),
        errors=errors,
        deleted_sample=deleted[:_SAMPLE_LIMIT],
        unreachable_sample=unreachable[:_SAMPLE_LIMIT],
    )


def collect_object_gc_roots(repo, *, errors: list[str] | None = None) -> set[str]:
    """Return DB-authoritative object roots for this repo."""

    out_errors = errors if errors is not None else []
    roots: set[str] = set()

    def add(value: Any) -> None:
        if isinstance(value, str) and is_object_id(value) and value != ZERO_ID:
            roots.add(value)

    for getter_name in (
        "get_head_commit_id",
        "get_root_hash",
    ):
        try:
            getter = getattr(repo, getter_name, None)
            if callable(getter):
                add(getter())
        except Exception as exc:  # noqa: BLE001
            out_errors.append(f"{getter_name}: {exc}")

    try:
        for scope_path, scope_hash in (repo.get_all_scope_hashes() or {}).items():
            add(scope_hash)
            try:
                add(repo.get_scope_head_commit_id(scope_path))
            except Exception as exc:  # noqa: BLE001
                out_errors.append(f"scope head {scope_path!r}: {exc}")
    except Exception as exc:  # noqa: BLE001
        out_errors.append(f"get_all_scope_hashes: {exc}")

    _add_history_roots(repo, add, out_errors)
    _add_version_index_roots(repo, add, out_errors)
    _add_outbox_roots(repo, add, out_errors)
    _add_pending_conflict_roots(repo, add, out_errors)
    return roots


def mark_reachable_objects(
    repo,
    roots: set[str] | list[str],
    *,
    errors: list[str] | None = None,
) -> set[str]:
    """Walk Git commit/tree/blob graphs plus legacy raw MUT trees."""

    out_errors = errors if errors is not None else []
    reachable: set[str] = set()
    stack = [
        object_id for object_id in roots
        if is_object_id(object_id) and object_id != ZERO_ID
    ]

    while stack:
        object_id = stack.pop()
        if object_id in reachable:
            continue
        reachable.add(object_id)

        try:
            obj_type, body = repo.store.get_object(object_id)
        except Exception:
            _push_legacy_tree_children(repo, object_id, stack, out_errors)
            continue

        try:
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
        except Exception as exc:  # noqa: BLE001
            out_errors.append(f"walk {object_id}: {exc}")

    return reachable


def _push_legacy_tree_children(
    repo,
    object_id: str,
    stack: list[str],
    errors: list[str],
) -> None:
    try:
        entries = read_tree_compat(repo.store, object_id)
    except Exception:
        return
    for typ, child_id in entries.values():
        if typ in ("T", "B") and is_object_id(child_id):
            stack.append(child_id)


def _add_history_roots(repo, add, errors: list[str]) -> None:
    listed = False
    history = getattr(repo, "history", None)
    list_roots = getattr(history, "list_object_gc_roots", None)
    if callable(list_roots):
        try:
            for value in list_roots():
                add(value)
            listed = True
        except Exception as exc:  # noqa: BLE001
            errors.append(f"list_object_gc_roots: {exc}")

    entries = getattr(history, "_entries", None)
    if entries is not None:
        listed = True
        for entry in list(entries):
            _add_entry_roots(entry, add)

    if listed:
        return

    get_since = getattr(repo, "get_history_since", None)
    if callable(get_since):
        try:
            for entry in get_since("", limit=0):
                _add_entry_roots(entry, add)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"get_history_since: {exc}")


def _add_entry_roots(entry: dict, add) -> None:
    for key in (
        "commit_id",
        "root",
        "root_hash",
        "scope_hash",
        "head_commit_id",
    ):
        add(entry.get(key))


def _add_version_index_roots(repo, add, errors: list[str]) -> None:
    history = getattr(repo, "history", None)
    rows = getattr(history, "_version_index", None)
    if rows is not None:
        for row in list(rows):
            _add_version_index_row(row, add)
        return

    list_rows = getattr(history, "list_version_index_roots", None)
    if callable(list_rows):
        try:
            for row in list_rows():
                if isinstance(row, dict):
                    _add_version_index_row(row, add)
                else:
                    add(row)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"list_version_index_roots: {exc}")


def _add_version_index_row(row: dict, add) -> None:
    for key in (
        "source_commit_id",
        "source_scope_hash",
        "project_root_hash",
        "project_view_commit_id",
    ):
        add(row.get(key))


def _add_outbox_roots(repo, add, errors: list[str]) -> None:
    history = getattr(repo, "history", None)
    list_rows = getattr(history, "list_pending_outbox_roots", None)
    if not callable(list_rows):
        return
    try:
        for row in list_rows():
            if isinstance(row, dict):
                add(row.get("commit_id"))
                payload = row.get("payload") or {}
                if isinstance(payload, dict):
                    _add_nested_roots(payload, add)
            else:
                add(row)
    except Exception as exc:  # noqa: BLE001
        errors.append(f"list_pending_outbox_roots: {exc}")


def _add_pending_conflict_roots(repo, add, errors: list[str]) -> None:
    audit = getattr(repo, "audit", None)
    events = getattr(audit, "events", None)
    if events is not None:
        for event in list(events):
            if "conflict_pending" not in str(event.get("type", "")):
                continue
            detail = event.get("detail") or {}
            if isinstance(detail, dict):
                _add_nested_roots(detail, add)
        return

    history = getattr(repo, "history", None)
    list_rows = getattr(history, "list_pending_conflict_roots", None)
    if callable(list_rows):
        try:
            for row in list_rows():
                if isinstance(row, dict):
                    _add_nested_roots(row, add)
                else:
                    add(row)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"list_pending_conflict_roots: {exc}")


def _add_nested_roots(value: Any, add) -> None:
    if isinstance(value, str):
        add(value)
    elif isinstance(value, dict):
        for child in value.values():
            _add_nested_roots(child, add)
    elif isinstance(value, list):
        for child in value:
            _add_nested_roots(child, add)


def _all_object_ids(repo, *, errors: list[str]) -> set[str]:
    try:
        return {
            object_id for object_id in repo.store.all_hashes()
            if is_object_id(object_id) and object_id != ZERO_ID
        }
    except Exception as exc:  # noqa: BLE001
        errors.append(f"all_hashes: {exc}")
        return set()


def _object_metadata(repo, *, errors: list[str]) -> dict[str, dict]:
    backend = getattr(repo.store, "_backend", None)
    getter = getattr(backend, "all_hashes_with_metadata", None)
    if not callable(getter):
        return {}
    try:
        return {
            object_id: meta
            for object_id, meta in getter().items()
            if is_object_id(object_id)
        }
    except Exception as exc:  # noqa: BLE001
        errors.append(f"all_hashes_with_metadata: {exc}")
        return {}


def _object_is_old_enough(
    object_id: str,
    metadata: dict[str, dict],
    *,
    retention_seconds: int,
    now: datetime,
) -> bool:
    if retention_seconds <= 0:
        return True
    meta = metadata.get(object_id) or {}
    last_modified = meta.get("last_modified")
    if last_modified is None:
        return False
    if isinstance(last_modified, str):
        try:
            last_modified = datetime.fromisoformat(
                last_modified.replace("Z", "+00:00"),
            )
        except ValueError:
            return False
    if not isinstance(last_modified, datetime):
        return False
    if last_modified.tzinfo is None:
        last_modified = last_modified.replace(tzinfo=timezone.utc)
    return (now - last_modified).total_seconds() >= retention_seconds


def _delete_object(repo, object_id: str) -> bool:
    backend = getattr(repo.store, "_backend", None)
    delete = getattr(backend, "delete", None)
    if not callable(delete):
        raise RuntimeError("object backend does not expose delete")
    return bool(delete(object_id))


def _aware_now(now: datetime | None) -> datetime:
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    return current
