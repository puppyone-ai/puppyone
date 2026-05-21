"""Three-way merge strategies owned by PuppyOne's Git kernel."""

from __future__ import annotations

import abc
import json
from dataclasses import dataclass, field

from src.version_engine.write_engine.git_object_format import hash_object


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


class ImportMergeStrategy(MergeStrategy):
    """Sort-and-dedupe merge for language import blocks at the top of a file.

    Recognises Python (``^import …`` / ``^from … import …``) and Go
    (``import (`` … ``)``). When both writers added imports in the
    leading import block and the rest of the file is unchanged from
    the base, produce a sorted-and-deduped union of the import block.
    """

    name = "import_merge"

    _PY_GO_EXT = (".py", ".go")

    def try_merge(
        self,
        base: bytes,
        ours: bytes,
        theirs: bytes,
        path: str,
    ) -> MergeResult | None:
        if not path.endswith(self._PY_GO_EXT):
            return None
        try:
            base_lines = base.decode().splitlines()
            ours_lines = ours.decode().splitlines()
            theirs_lines = theirs.decode().splitlines()
        except UnicodeDecodeError:
            return None
        recognise = _python_import_block if path.endswith(".py") else _go_import_block
        _base_imports, base_tail = recognise(base_lines)
        ours_imports, ours_tail = recognise(ours_lines)
        theirs_imports, theirs_tail = recognise(theirs_lines)
        # Only fire when the non-import body is unchanged on both sides.
        if ours_tail != base_tail or theirs_tail != base_tail:
            return None
        merged_imports = sorted({*ours_imports, *theirs_imports})
        if path.endswith(".py"):
            content_lines = merged_imports + base_tail
        else:
            # Go: re-emit the canonical ``import ( ... )`` block.
            content_lines = (
                ["import ("]
                + [f"\t{imp}" for imp in merged_imports]
                + [")"]
                + base_tail
            )
        content = ("\n".join(content_lines) + "\n").encode("utf-8")
        return MergeResult(
            content=content,
            strategy="import_merge",
            conflicts=[
                ConflictRecord(
                    path=path,
                    strategy="import_merge",
                    detail=(
                        f"sort+dedupe-merged {len(merged_imports)} imports "
                        f"({len(ours_imports)} from ours, "
                        f"{len(theirs_imports)} from theirs)"
                    ),
                    kept="merged",
                )
            ] if merged_imports else [],
        )


class AppendOnlyMergeStrategy(MergeStrategy):
    """Union of trailing-line appends when both sides extend the file.

    Catches the common shape "two writers each added a different line at
    the end" — SQL migrations adding sequential ALTERs, CSV rows, shell
    script exports, Dockerfile directives, YAML config keys. Both sides
    must share the base as a strict prefix; only the new tail differs.
    """

    name = "append_only_merge"

    def try_merge(
        self,
        base: bytes,
        ours: bytes,
        theirs: bytes,
        path: str,
    ) -> MergeResult | None:
        if not ours.startswith(base) or not theirs.startswith(base):
            return None
        # Both sides are pure append. Concatenate the two tails after
        # the shared prefix, preserving order (ours first, theirs second).
        ours_tail = ours[len(base):]
        theirs_tail = theirs[len(base):]
        if not ours_tail and not theirs_tail:
            return None
        # Avoid double-counting identical tail content.
        if ours_tail == theirs_tail:
            content = ours
        else:
            content = base + ours_tail
            if not content.endswith(b"\n"):
                content += b"\n"
            content += theirs_tail
        return MergeResult(
            content=content,
            strategy="append_only_merge",
            conflicts=[
                ConflictRecord(
                    path=path,
                    strategy="append_only_merge",
                    detail=(
                        f"both sides appended; {len(ours_tail)}B from ours "
                        f"+ {len(theirs_tail)}B from theirs unioned"
                    ),
                    kept="merged",
                )
            ],
        )


class LWWStrategy(MergeStrategy):
    """Terminal policy: incoming content wins and the loss is audit-visible."""

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
    ImportMergeStrategy(),
    AppendOnlyMergeStrategy(),
    LineMergeStrategy(),
    LWWStrategy(),
]


def _python_import_block(lines: list[str]) -> tuple[list[str], list[str]]:
    """Split ``lines`` into ``(imports, tail)`` for a Python module.

    Imports are the leading run of ``import …`` / ``from … import …``
    statements (allowing blank lines between them). Everything from the
    first non-import, non-blank line onward is the tail.
    """

    imports: list[str] = []
    body_start = 0
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            body_start = i + 1
            continue
        if stripped.startswith("import ") or stripped.startswith("from "):
            imports.append(stripped)
            body_start = i + 1
            continue
        body_start = i
        break
    tail = lines[body_start:]
    # Normalise: drop any leading blank lines in the tail so unrelated
    # whitespace changes don't suppress merge.
    while tail and not tail[0].strip():
        tail.pop(0)
    return imports, tail


def _go_import_block(lines: list[str]) -> tuple[list[str], list[str]]:
    """Split ``lines`` into ``(imports, tail)`` for a Go file.

    Recognises a ``import (`` block at the start of the file (after an
    optional ``package`` line + blanks). Returns the inner import strings
    (each stripped of leading tab + quotes intact) and the body that
    follows the closing ``)``.
    """

    imports: list[str] = []
    i = 0
    # Skip the package declaration + blanks
    while i < len(lines):
        stripped = lines[i].strip()
        if stripped.startswith("package "):
            i += 1
            continue
        if not stripped:
            i += 1
            continue
        break
    if i >= len(lines) or lines[i].strip() != "import (":
        return imports, lines
    i += 1
    while i < len(lines) and lines[i].strip() != ")":
        s = lines[i].strip()
        if s:
            imports.append(s)
        i += 1
    if i >= len(lines):
        # malformed: no closing paren
        return imports, lines
    tail = lines[i + 1:]
    while tail and not tail[0].strip():
        tail.pop(0)
    # Preserve the package + leading whitespace block as part of "the
    # canonical file shell"; we strip it from tail so we can re-emit a
    # fresh import block. Find the package line again to prepend it.
    pkg_lines: list[str] = []
    for line in lines:
        if line.strip().startswith("package "):
            pkg_lines.append(line.strip())
            break
    if pkg_lines:
        tail = pkg_lines + [""] + tail
    return imports, tail


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
    # When ours and theirs both insert at the same ``(start, end)``
    # position, the iteration order under ``reverse=True`` decides
    # which side's lines end up appearing first in the merged output.
    # Without a tie-breaker the order depended on insertion order in
    # ``hunks_a + hunks_b`` plus Python's stable-sort behavior, which
    # is consistent within a single Python run but can be confusing
    # to readers. Pin it explicitly: ours (hunks_a) end up BEFORE
    # theirs (hunks_b) at the same position. We mark each hunk with
    # an origin tag (0=ours, 1=theirs) BEFORE sorting and use that
    # as a secondary sort key. We sort by (start, end) descending
    # so positions are applied right-to-left (avoids index shift),
    # then by origin DESCENDING so that — when we walk through the
    # iterator and apply each hunk's ``result[start:end] = new`` —
    # the LAST one to splice at a tied position is the lowest-origin
    # one (i.e. ours). The lowest-origin splice happens last, which
    # under list.__setitem__ semantics means its lines land BEFORE
    # any previously-inserted lines at the same index.
    tagged = [(*h, 0) for h in hunks_a] + [(*h, 1) for h in hunks_b]
    result = list(base)
    for old_start, old_end, new_lines, _origin in sorted(
        tagged,
        key=lambda h: (h[0], h[1], h[3]),
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
