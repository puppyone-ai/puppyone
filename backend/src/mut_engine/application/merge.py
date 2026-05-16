"""Three-way merge strategies owned by PuppyOne's Git kernel."""

from __future__ import annotations

import abc
import json
from dataclasses import dataclass, field

from src.mut_engine.application.git_object_format import hash_object


@dataclass
class ConflictRecord:
    path: str
    strategy: str
    detail: str = ""
    kept: str = ""
    lost_content: str = ""
    lost_hash: str = ""


@dataclass
class MergeResult:
    content: bytes
    conflicts: list[ConflictRecord] = field(default_factory=list)
    strategy: str = "identical"


class MergeStrategy(abc.ABC):
    name: str = "base"

    @abc.abstractmethod
    def try_merge(
        self,
        base: bytes,
        ours: bytes,
        theirs: bytes,
        path: str,
    ) -> MergeResult | None:
        """Attempt to merge; return None to pass to the next strategy."""


class IdenticalStrategy(MergeStrategy):
    name = "identical"

    def try_merge(
        self,
        base: bytes,
        ours: bytes,
        theirs: bytes,
        path: str,
    ) -> MergeResult | None:
        _ = (base, path)
        if ours == theirs:
            return MergeResult(content=ours, strategy="identical")
        return None


class OneSideOnlyStrategy(MergeStrategy):
    name = "one_side_only"

    def try_merge(
        self,
        base: bytes,
        ours: bytes,
        theirs: bytes,
        path: str,
    ) -> MergeResult | None:
        _ = path
        if base == ours:
            return MergeResult(content=theirs, strategy="theirs_only")
        if base == theirs:
            return MergeResult(content=ours, strategy="ours_only")
        return None


class LineMergeStrategy(MergeStrategy):
    name = "line_merge"

    def try_merge(
        self,
        base: bytes,
        ours: bytes,
        theirs: bytes,
        path: str,
    ) -> MergeResult | None:
        return _try_line_merge(base, ours, theirs, path)


class JsonMergeStrategy(MergeStrategy):
    name = "json_merge"

    def try_merge(
        self,
        base: bytes,
        ours: bytes,
        theirs: bytes,
        path: str,
    ) -> MergeResult | None:
        if path.endswith(".json"):
            return _try_json_merge(base, ours, theirs, path)
        return None


class LWWStrategy(MergeStrategy):
    """Legacy fallback: incoming content wins and the loss is audit-visible."""

    name = "lww"

    def try_merge(
        self,
        base: bytes,
        ours: bytes,
        theirs: bytes,
        path: str,
    ) -> MergeResult | None:
        _ = base
        return MergeResult(
            content=theirs,
            strategy="lww",
            conflicts=[
                ConflictRecord(
                    path=path,
                    strategy="lww",
                    detail="both sides modified, theirs (incoming push) wins",
                    kept="theirs",
                    lost_content=ours.decode(errors="replace")[:500],
                    lost_hash=hash_object("blob", ours),
                )
            ],
        )


DEFAULT_STRATEGIES: list[MergeStrategy] = [
    IdenticalStrategy(),
    OneSideOnlyStrategy(),
    JsonMergeStrategy(),
    LineMergeStrategy(),
    LWWStrategy(),
]


class ConflictResolver:
    def __init__(self, strategies: list[MergeStrategy] | None = None):
        self.strategies = strategies if strategies is not None else list(DEFAULT_STRATEGIES)

    def resolve(
        self,
        base: bytes,
        ours: bytes,
        theirs: bytes,
        path: str = "",
    ) -> MergeResult:
        for strategy in self.strategies:
            result = strategy.try_merge(base, ours, theirs, path)
            if result is not None:
                return result
        fallback = LWWStrategy().try_merge(base, ours, theirs, path)
        assert fallback is not None
        return fallback


_default_resolver = ConflictResolver()


def three_way_merge(
    base: bytes,
    ours: bytes,
    theirs: bytes,
    path: str = "",
    resolver: ConflictResolver | None = None,
) -> MergeResult:
    return (resolver or _default_resolver).resolve(base, ours, theirs, path)


def merge_file_sets(
    base_files: dict,
    our_files: dict,
    their_files: dict,
    resolver: ConflictResolver | None = None,
) -> tuple[dict[str, bytes], list[ConflictRecord]]:
    merged: dict[str, bytes] = {}
    all_conflicts: list[ConflictRecord] = []

    for path in sorted(set(base_files) | set(our_files) | set(their_files)):
        base = base_files.get(path, b"")
        ours = our_files.get(path)
        theirs = their_files.get(path)

        if ours is None and theirs is None:
            continue

        if ours is None:
            if theirs != base:
                merged[path] = theirs
                all_conflicts.append(
                    ConflictRecord(
                        path=path,
                        strategy="delete_modify",
                        detail="ours deleted, theirs modified -> keep theirs",
                        kept="theirs",
                    )
                )
            continue

        if theirs is None:
            if ours != base:
                merged[path] = ours
                all_conflicts.append(
                    ConflictRecord(
                        path=path,
                        strategy="modify_delete",
                        detail="theirs deleted, ours modified -> keep ours",
                        kept="ours",
                    )
                )
            continue

        result = three_way_merge(base, ours, theirs, path, resolver)
        merged[path] = result.content
        all_conflicts.extend(result.conflicts)

    return merged, all_conflicts


def _try_line_merge(base: bytes, ours: bytes, theirs: bytes, path: str) -> MergeResult | None:
    try:
        base_lines = base.decode().splitlines(keepends=True)
        ours_lines = ours.decode().splitlines(keepends=True)
        theirs_lines = theirs.decode().splitlines(keepends=True)
    except UnicodeDecodeError:
        return None

    our_hunks = _diff_hunks(base_lines, ours_lines)
    their_hunks = _diff_hunks(base_lines, theirs_lines)
    if _hunks_overlap(our_hunks, their_hunks):
        return None

    total_changes = len(our_hunks) + len(their_hunks)
    content = "".join(_apply_hunks(base_lines, our_hunks, their_hunks)).encode()
    return MergeResult(
        content=content,
        strategy="line_merge",
        conflicts=[
            ConflictRecord(
                path=path,
                strategy="line_merge",
                detail=f"auto-merged {total_changes} hunk(s)",
                kept="merged",
            )
        ]
        if total_changes
        else [],
    )


def _diff_hunks(old: list, new: list) -> list:
    from difflib import SequenceMatcher

    matcher = SequenceMatcher(None, old, new, autojunk=False)
    hunks = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag != "equal":
            hunks.append((i1, i2, new[j1:j2]))
    return hunks


def _hunks_overlap(hunks_a: list, hunks_b: list) -> bool:
    for a_start, a_end, _ in hunks_a:
        for b_start, b_end, _ in hunks_b:
            if a_start < b_end and b_start < a_end:
                return True
    return False


def _apply_hunks(base: list, hunks_a: list, hunks_b: list) -> list:
    result = list(base)
    for old_start, old_end, new_lines in sorted(
        hunks_a + hunks_b,
        key=lambda h: (h[0], h[1]),
        reverse=True,
    ):
        result[old_start:old_end] = new_lines
    return result


def _try_json_merge(base: bytes, ours: bytes, theirs: bytes, path: str) -> MergeResult | None:
    try:
        base_obj = json.loads(base)
        ours_obj = json.loads(ours)
        theirs_obj = json.loads(theirs)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None

    if not all(isinstance(obj, dict) for obj in (base_obj, ours_obj, theirs_obj)):
        return None

    merged, conflicts = _merge_dicts(base_obj, ours_obj, theirs_obj, path)
    return MergeResult(
        content=json.dumps(merged, indent=2, ensure_ascii=False).encode(),
        strategy="json_merge",
        conflicts=conflicts,
    )


def _merge_dicts(base: dict, ours: dict, theirs: dict, path: str) -> tuple[dict, list]:
    merged = dict(base)
    conflicts: list[ConflictRecord] = []

    for key in set(base) | set(ours) | set(theirs):
        value, conflict = _merge_key(base.get(key), ours.get(key), theirs.get(key), key, path)
        if value == "delete":
            merged.pop(key, None)
        elif value is not None:
            merged[key] = value
        if conflict is not None:
            if isinstance(conflict, list):
                conflicts.extend(conflict)
            else:
                conflicts.append(conflict)

    return merged, conflicts


def _merge_key(base_value, our_value, their_value, key: str, path: str):
    if our_value == their_value:
        return ("delete" if our_value is None else our_value), None

    if base_value == our_value:
        return ("delete" if their_value is None else their_value), None

    if base_value == their_value:
        return ("delete" if our_value is None else our_value), None

    if all(isinstance(value, dict) for value in (base_value, our_value, their_value)):
        return _merge_dicts(base_value, our_value, their_value, f"{path}/{key}")

    winner = their_value if their_value is not None else our_value
    lost_value = json.dumps(our_value)
    return winner, ConflictRecord(
        path=f"{path}#{key}",
        strategy="json_lww",
        detail=f"both modified key '{key}'",
        kept="theirs",
        lost_content=lost_value[:500],
        lost_hash=hash_object("blob", lost_value.encode()) if our_value != their_value else "",
    )
