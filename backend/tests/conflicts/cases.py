"""Conflict / auto-merge test case inventory (V1 version engine).

WHY THIS FILE EXISTS
====================
The V1 conflict policy stack has three live merge strategies that fire
*before* the configured policy (LWW / manual_review / future agent
policies) gets a vote:

  1. identical        — both writers sent the same bytes
  2. one_side_only    — exactly one side moved off the base
  3. json_merge       — ``.json`` files where dict keys can be unioned
  4. line_merge       — non-overlapping line diffs against the base
  5. (parent_scope_wins applies above all of the above for cross-scope
     same-path overlaps; child loses to parent regardless of content)
  6. configured policy (default LWW, opt-in manual_review)

Modify/delete and delete/modify shapes skip safe merge and go straight
to the policy. JSON-aware merge only runs for ``.json`` extension.

The cases below are designed so:
  * Every (file-merge strategy × shape) cell has at least one positive
    test (it should auto-merge cleanly) AND at least one negative test
    (it must fall through to LWW / manual_review).
  * Concurrency scales from 2-way CAS races up to a 20-way storm.
  * Scope-hierarchy cases cover parent-scope-wins, scope mode, and
    pending-scope-change races.
  * Edge cases include unicode paths, very large files, BOM/CRLF, and
    path traversal.

Each :class:`ConflictCase` is self-contained: it declares the seed
state, the writers, and the expected final state + per-writer outcome.
A live runner (separate file) seeds the project, fires the writers
through ``MutOps``, then asserts against ``expected``.

CATEGORY OVERVIEW
=================
  A  (12)  Content-merge strategy paths (identical / one-side / json / line / lww)
  B  (12)  Multi-file batch conflicts (5..100 files)
  C  (12)  Delete / rename / type-shape conflicts
  D  (14)  Scope-hierarchy: parent-wins, cross-scope, scope mode, scope geometry
  E  (10)  Concurrency + CAS storms (2..20 writers, ancient bases, exact-retry-budget)
  F  (12)  Policy-driven outcomes (manual_review queueing, policy rules, resolver decisions)
  G  (10)  Edge / adversarial (binary, unicode, CRLF, deep nesting, path traversal)
                                                              Total: 82
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Mapping, Optional, Tuple


# ──────────────────────────────────────────────────────────────────────
# Dataclasses
# ──────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Writer:
    """One write submitted in a test case.

    ``operation`` is one of:
      * ``write_file``   — files = {rel_path: content_bytes} (single entry)
      * ``bulk_write``   — files = {rel_path: content_bytes} (multiple entries)
                            plus ``deleted`` for paths to remove in the same commit
      * ``delete``       — files = {rel_path: None, ...} (content ignored)
      * ``rename``       — files = {"from": <old>, "to": <new>}
      * ``mkdir``        — files = {rel_path: None}  (directory marker)

    ``base`` controls the optimistic-CAS precondition:
      * ``"head"``       — no explicit base; engine uses current scope head
      * ``"frozen"``     — capture the scope head BEFORE any writer in this
                           case starts, and pass that as base. Forces a CAS
                           conflict if another writer commits first.
      * ``"ancient"``    — capture the head from before the seed commits;
                           every intervening commit is rebased over.
      * explicit 40-hex  — pass this commit_id verbatim.

    ``policy`` is the per-write conflict policy override (matches the
    request-header / outbox-event surface). ``""`` = engine default.

    ``delay_ms`` lets cases impose a partial order. The runner sleeps
    that long before submitting this writer, so e.g. a "winner" writer
    can be guaranteed to land last in a 3-way race.
    """

    actor: str = "user:test"
    scope: str = ""                                           # "" = root scope
    operation: str = "write_file"
    files: Mapping[str, Optional[bytes]] = field(default_factory=dict)
    deleted: Tuple[str, ...] = ()                              # only for bulk_write
    base: str = "head"
    policy: str = ""
    source_channel: str = "papi"
    delay_ms: int = 0
    expected_outcome: str = "committed"                        # see Expected.writer_outcomes


@dataclass(frozen=True)
class Expected:
    """Predicted post-conditions for a case.

    ``writer_outcomes`` is keyed by writer index. Each value is one of:
      * ``committed``           — the writer's commit lands as scope head
      * ``merged``              — the writer's content survives as part of
                                   a merge commit (not necessarily as head)
      * ``superseded_by_parent`` — parent_scope_wins consumed this content
      * ``pending_resolution``  — landed in mut_conflicts queue
      * ``rejected``            — engine refused (CAS exhausted / 409 / 422)
      * ``superseded_by_lww``   — LWW dropped this side's content
    """

    writer_outcomes: Tuple[str, ...] = ()
    # path → expected final bytes (None means file should be absent)
    final_state: Mapping[str, Optional[bytes]] = field(default_factory=dict)
    # How many ``mut_conflicts`` rows the case should leave pending.
    pending_conflicts: int = 0
    # Active strategy: identical | one_side_only | json_merge | line_merge |
    #                  lww | manual_review | parent_scope_wins | modify_delete |
    #                  delete_modify | rejected | mixed
    strategy: str = ""
    notes: str = ""


@dataclass(frozen=True)
class ConflictCase:
    id: str
    category: str                                              # "A" .. "G"
    title: str
    description: str
    setup: Mapping[str, Mapping[str, bytes]] = field(default_factory=dict)
    """``{scope_path: {rel_path: content}}`` seeded before writers fire."""
    scopes: Tuple[Tuple[str, str], ...] = (("", "rw"),)
    """``((path, mode), ...)``. Scopes the case needs. ``""`` = root scope."""
    writers: Tuple[Writer, ...] = ()
    expected: Expected = field(default_factory=Expected)


# ──────────────────────────────────────────────────────────────────────
# Helpers — keep case declarations short
# ──────────────────────────────────────────────────────────────────────

def _w(actor: str, content: bytes, path: str = "f.txt", **kw) -> Writer:
    """Shortcut: a write_file writer with one file."""
    return Writer(actor=actor, operation="write_file",
                  files={path: content}, **kw)


def _bw(actor: str, files: Mapping[str, bytes], **kw) -> Writer:
    return Writer(actor=actor, operation="bulk_write", files=files, **kw)


def _del(actor: str, *paths: str, **kw) -> Writer:
    return Writer(actor=actor, operation="delete",
                  files={p: None for p in paths}, **kw)


def _ren(actor: str, src: str, dst: str, **kw) -> Writer:
    return Writer(actor=actor, operation="rename",
                  files={"from": src.encode(), "to": dst.encode()}, **kw)


# ──────────────────────────────────────────────────────────────────────
# Category A — Content-merge strategy paths
# ──────────────────────────────────────────────────────────────────────

A_CASES = [
    ConflictCase(
        id="A01",
        category="A",
        title="identical: both writers send the same bytes",
        description=(
            "Two writers concurrently submit identical content for the same "
            "file. The IdenticalStrategy should fire — no real conflict, "
            "no LWW record, only one commit becomes head (the other races "
            "for CAS and may either retry-as-no-op or rebase to identical)."
        ),
        setup={"": {"f.txt": b"hello\n"}},
        writers=(
            _w("user:A", b"hello world\n"),
            _w("user:B", b"hello world\n", delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            final_state={"f.txt": b"hello world\n"},
            strategy="identical",
        ),
    ),
    ConflictCase(
        id="A02",
        category="A",
        title="one_side_only: B reverts to base, A modifies",
        description=(
            "A modifies the file; B submits the seed content unchanged. "
            "The OneSideOnlyStrategy should take A's content (the side "
            "that actually moved off base)."
        ),
        setup={"": {"f.txt": b"v1\n"}},
        writers=(
            _w("user:A", b"v1-modified\n"),
            _w("user:B", b"v1\n", delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            final_state={"f.txt": b"v1-modified\n"},
            strategy="one_side_only",
            notes="B's commit lands but the merged content is A's modification.",
        ),
    ),
    ConflictCase(
        id="A03",
        category="A",
        title="json_merge: two writers add different top-level keys",
        description=(
            "A adds ``feature_x``; B adds ``feature_y`` to the same JSON "
            "file. The dict-merge strategy should produce a union with both "
            "keys plus the original ``version``."
        ),
        setup={"": {"config.json": b'{"version": 1}'}},
        writers=(
            _w("user:A", b'{"version": 1, "feature_x": true}',
               path="config.json"),
            _w("user:B", b'{"version": 1, "feature_y": true}',
               path="config.json", delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            final_state={
                "config.json": b'{"feature_x": true, "feature_y": true, "version": 1}',
            },
            strategy="json_merge",
            notes="Final dict has both keys; key ordering is canonical (sorted).",
        ),
    ),
    ConflictCase(
        id="A04",
        category="A",
        title="json_merge fails: same key, different values → LWW",
        description=(
            "Both writers change the same key to different scalar values. "
            "JSON merge has no way to resolve a scalar collision, so the "
            "policy stack falls through to LWW (default policy)."
        ),
        setup={"": {"config.json": b'{"version": 1}'}},
        writers=(
            _w("user:A", b'{"version": 2}', path="config.json"),
            _w("user:B", b'{"version": 3}', path="config.json", delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            final_state={"config.json": b'{"version": 3}'},
            strategy="lww",
            notes="B is the later writer (delay_ms=5); under LWW theirs wins.",
        ),
    ),
    ConflictCase(
        id="A05",
        category="A",
        title="json_merge: nested object key union",
        description=(
            "A adds a key inside ``settings``; B adds a different key under "
            "the same ``settings`` object. The dict-merge should recurse "
            "into the nested object and union both adds."
        ),
        setup={"": {"config.json": b'{"settings": {"theme": "dark"}}'}},
        writers=(
            _w("user:A", b'{"settings": {"theme": "dark", "lang": "zh"}}',
               path="config.json"),
            _w("user:B", b'{"settings": {"theme": "dark", "fontSize": 14}}',
               path="config.json", delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            final_state={
                "config.json":
                    b'{"settings": {"fontSize": 14, "lang": "zh", "theme": "dark"}}',
            },
            strategy="json_merge",
        ),
    ),
    ConflictCase(
        id="A06",
        category="A",
        title="line_merge: both append at different positions",
        description=(
            "Markdown file with multiple paragraphs. A inserts a new line "
            "near the top; B appends at the bottom. Hunks are disjoint so "
            "LineMergeStrategy unions both edits."
        ),
        setup={"": {
            "notes.md": b"# Notes\n\nfirst\n\nsecond\n",
        }},
        writers=(
            _w("user:A", b"# Notes\n\nfirst\nA-added\n\nsecond\n",
               path="notes.md"),
            _w("user:B", b"# Notes\n\nfirst\n\nsecond\nB-appended\n",
               path="notes.md", delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            final_state={
                "notes.md":
                    b"# Notes\n\nfirst\nA-added\n\nsecond\nB-appended\n",
            },
            strategy="line_merge",
        ),
    ),
    ConflictCase(
        id="A07",
        category="A",
        title="line_merge fails: both rewrite the same line → LWW",
        description=(
            "Both writers replace the same source line with different text. "
            "Hunks overlap, line merge bails out, and the default LWW "
            "policy keeps the incoming (later) writer's content."
        ),
        setup={"": {"app.py": b"x = 1\ny = 2\nz = 3\n"}},
        writers=(
            _w("user:A", b"x = 1\ny = 20\nz = 3\n", path="app.py"),
            _w("user:B", b"x = 1\ny = 200\nz = 3\n", path="app.py", delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            final_state={"app.py": b"x = 1\ny = 200\nz = 3\n"},
            strategy="lww",
        ),
    ),
    ConflictCase(
        id="A08",
        category="A",
        title="line_merge fails: both prepend (overlap at line 0)",
        description=(
            "Both writers insert content at the very top. Even though the "
            "lines are different, both hunks claim position [0:0], so the "
            "overlap check rejects safe merge."
        ),
        setup={"": {"notes.md": b"body\n"}},
        writers=(
            _w("user:A", b"A-top\nbody\n", path="notes.md"),
            _w("user:B", b"B-top\nbody\n", path="notes.md", delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            final_state={"notes.md": b"B-top\nbody\n"},
            strategy="lww",
        ),
    ),
    ConflictCase(
        id="A09",
        category="A",
        title="empty file vs non-empty",
        description=(
            "A turns the file into empty bytes; B writes new content. "
            "Both moved off base, hunks overlap (the whole file). LWW "
            "fires; theirs wins."
        ),
        setup={"": {"f.txt": b"original\n"}},
        writers=(
            _w("user:A", b""),
            _w("user:B", b"replaced\n", delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            final_state={"f.txt": b"replaced\n"},
            strategy="lww",
        ),
    ),
    ConflictCase(
        id="A10",
        category="A",
        title="large text file, non-overlapping hunks at far-apart lines",
        description=(
            "1000-line generated file. A edits line 100; B edits line 900. "
            "Hunks are far apart, line merge unions cleanly."
        ),
        setup={"": {"big.txt": b"\n".join(
            f"line {i}".encode() for i in range(1000)) + b"\n"}},
        writers=(
            _w("user:A",
               b"\n".join(
                   (f"line {i}".encode() if i != 100 else b"line 100 [A]")
                   for i in range(1000)) + b"\n",
               path="big.txt"),
            _w("user:B",
               b"\n".join(
                   (f"line {i}".encode() if i != 900 else b"line 900 [B]")
                   for i in range(1000)) + b"\n",
               path="big.txt", delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            strategy="line_merge",
            notes="Final file has both [A] at line 100 and [B] at line 900.",
        ),
    ),
    ConflictCase(
        id="A11",
        category="A",
        title="invalid JSON: parser fails → fallback to line_merge",
        description=(
            "File has ``.json`` extension but the seed bytes are not valid "
            "JSON. JsonMergeStrategy bails out (UnicodeDecodeError / "
            "JSONDecodeError), falling through to LineMergeStrategy."
        ),
        setup={"": {"data.json": b"not really json\n"}},
        writers=(
            _w("user:A", b"not really json\nline-A\n", path="data.json"),
            _w("user:B", b"not really json\n\nline-B\n",
               path="data.json", delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            final_state={
                "data.json": b"not really json\nline-A\n\nline-B\n",
            },
            strategy="line_merge",
        ),
    ),
    ConflictCase(
        id="A12",
        category="A",
        title="both writers CREATE the same fresh file (no base)",
        description=(
            "Neither writer's commit has the file at base. Add/add shape: "
            "both content differs, line_merge falls back to LWW."
        ),
        setup={"": {}},
        writers=(
            _w("user:A", b"A-init\n"),
            _w("user:B", b"B-init\n", delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            final_state={"f.txt": b"B-init\n"},
            strategy="lww",
        ),
    ),
]


# ──────────────────────────────────────────────────────────────────────
# Category B — Multi-file batch conflicts
# ──────────────────────────────────────────────────────────────────────

B_CASES = [
    ConflictCase(
        id="B01",
        category="B",
        title="5 files, every one conflicts (all LWW)",
        description=(
            "Both writers bulk-write the same 5 paths with different "
            "content. Each path falls to LWW; both commits land but the "
            "final tree shows the incoming side."
        ),
        setup={"": {f"f{i}.txt": f"v0-{i}\n".encode() for i in range(5)}},
        writers=(
            _bw("user:A", {f"f{i}.txt": f"A-{i}\n".encode() for i in range(5)}),
            _bw("user:B", {f"f{i}.txt": f"B-{i}\n".encode() for i in range(5)},
                delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            final_state={f"f{i}.txt": f"B-{i}\n".encode() for i in range(5)},
            strategy="lww",
        ),
    ),
    ConflictCase(
        id="B02",
        category="B",
        title="5 files, mix: 3 safe-merge + 2 LWW",
        description=(
            "Writer A touches files 0-2 only; Writer B touches files 2-4 "
            "only. Files 0/1 are A-only, files 3/4 are B-only "
            "(one_side_only), file 2 collides (LWW)."
        ),
        setup={"": {f"f{i}.txt": f"v0-{i}\n".encode() for i in range(5)}},
        writers=(
            _bw("user:A",
                {f"f{i}.txt": f"A-{i}\n".encode() for i in range(3)}),
            _bw("user:B",
                {f"f{i}.txt": f"B-{i}\n".encode() for i in range(2, 5)},
                delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            final_state={
                "f0.txt": b"A-0\n",
                "f1.txt": b"A-1\n",
                "f2.txt": b"B-2\n",
                "f3.txt": b"B-3\n",
                "f4.txt": b"B-4\n",
            },
            strategy="mixed",
        ),
    ),
    ConflictCase(
        id="B03",
        category="B",
        title="10 files, fully disjoint paths (no overlap)",
        description=(
            "A writes 10 files under ``a/``; B writes 10 different files "
            "under ``b/``. No path overlap. Both succeed cleanly with "
            "one_side_only on every path."
        ),
        setup={"": {}},
        writers=(
            _bw("user:A", {f"a/file{i}.txt": f"A-{i}\n".encode() for i in range(10)}),
            _bw("user:B", {f"b/file{i}.txt": f"B-{i}\n".encode() for i in range(10)},
                delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            strategy="one_side_only",
            notes="20 files total in final state, all present.",
        ),
    ),
    ConflictCase(
        id="B04",
        category="B",
        title="20 files vs 20 files — no overlap, parallel",
        description=(
            "Stress test for batch performance: 20 paths per writer, "
            "disjoint. Verifies the engine doesn't serialize unnecessarily."
        ),
        setup={"": {}},
        writers=(
            _bw("user:A", {f"a/f{i}.txt": f"A{i}".encode() for i in range(20)}),
            _bw("user:B", {f"b/f{i}.txt": f"B{i}".encode() for i in range(20)}),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            strategy="one_side_only",
        ),
    ),
    ConflictCase(
        id="B05",
        category="B",
        title="20 files vs 20 files, half overlap",
        description=(
            "10 paths are shared (LWW each), 10 are A-only, 10 are B-only "
            "(one_side_only each). Verifies per-path strategy selection "
            "inside a batch."
        ),
        setup={"": {}},
        writers=(
            _bw("user:A", {f"f{i}.txt": f"A{i}".encode() for i in range(20)}),
            _bw("user:B", {f"f{i}.txt": f"B{i}".encode() for i in range(10, 30)},
                delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            strategy="mixed",
            notes="Files 0-9: A wins. Files 10-19: B wins (LWW). Files 20-29: B wins.",
        ),
    ),
    ConflictCase(
        id="B06",
        category="B",
        title="50 files, mostly auto-merge friendly",
        description=(
            "50 .md files seeded. Both writers prepend a different line at "
            "the top of 25 different files each. All 50 should line-merge "
            "or stay one_side_only — no LWW expected."
        ),
        setup={"": {f"docs/doc{i:02d}.md": f"# Doc {i}\nbody\n".encode()
                    for i in range(50)}},
        writers=(
            _bw("user:A",
                {f"docs/doc{i:02d}.md":
                 f"# Doc {i}\nA-edit\nbody\n".encode()
                 for i in range(0, 50, 2)}),                       # even indices
            _bw("user:B",
                {f"docs/doc{i:02d}.md":
                 f"# Doc {i}\nbody\nB-append\n".encode()
                 for i in range(1, 50, 2)},
                delay_ms=5),                                       # odd indices
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            strategy="mixed",
            notes="No path overlap → 25 one_side_only A + 25 one_side_only B.",
        ),
    ),
    ConflictCase(
        id="B07",
        category="B",
        title="nested directory conflict on every level",
        description=(
            "Both writers update files at root, in subfolder, and deeper. "
            "Every path overlaps with a different leaf, but all share an "
            "ancestor directory — exercises tree splice + LWW interaction."
        ),
        setup={"": {
            "a.txt": b"r0\n",
            "sub/a.txt": b"s0\n",
            "sub/deep/a.txt": b"d0\n",
        }},
        writers=(
            _bw("user:A", {
                "a.txt": b"r-A\n",
                "sub/a.txt": b"s-A\n",
                "sub/deep/a.txt": b"d-A\n",
            }),
            _bw("user:B", {
                "a.txt": b"r-B\n",
                "sub/a.txt": b"s-B\n",
                "sub/deep/a.txt": b"d-B\n",
            }, delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            final_state={
                "a.txt": b"r-B\n",
                "sub/a.txt": b"s-B\n",
                "sub/deep/a.txt": b"d-B\n",
            },
            strategy="lww",
        ),
    ),
    ConflictCase(
        id="B08",
        category="B",
        title="subdirectory fully overlapped",
        description=(
            "Both writers wholesale rewrite every file in ``shared/``. "
            "Every leaf conflicts. Final state should be B's version for "
            "all of them."
        ),
        setup={"": {
            f"shared/file{i}.json": b'{"x": 0}' for i in range(8)
        }},
        writers=(
            _bw("user:A",
                {f"shared/file{i}.json": f'{{"x": {i}, "side": "A"}}'.encode()
                 for i in range(8)}),
            _bw("user:B",
                {f"shared/file{i}.json": f'{{"x": {i}, "side": "B"}}'.encode()
                 for i in range(8)},
                delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            strategy="json_merge",
            notes="Each .json should auto-merge: 'x' identical, 'side' differs "
                  "but is A-only or B-only depending on direction. The merge "
                  "rule keeps the side that's not equal to base.",
        ),
    ),
    ConflictCase(
        id="B09",
        category="B",
        title="100 files written, only 1 overlaps",
        description=(
            "Worst-case sparse conflict: massive bulk on both sides, "
            "exactly one path collides. The engine should produce a clean "
            "merge for 99 files and LWW the one collision."
        ),
        setup={"": {}},
        writers=(
            _bw("user:A", {f"a/{i:03d}.txt": str(i).encode() for i in range(100)}),
            _bw("user:B", {f"a/{i:03d}.txt": f"B-{i}".encode() for i in (50,)} |
                          {f"b/{i:03d}.txt": str(i).encode() for i in range(99)},
                delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            strategy="mixed",
            notes="100 files in a/ from A, 99 files in b/ from B, and "
                  "a/050.txt is overwritten by B (LWW).",
        ),
    ),
    ConflictCase(
        id="B10",
        category="B",
        title="3-way batch: A, B, C all overlap a 4-file set",
        description=(
            "Three concurrent batches all target the same 4 files. The "
            "engine should serialize via CAS retry; the last-committed "
            "side's content wins each path."
        ),
        setup={"": {f"f{i}.txt": b"v0\n" for i in range(4)}},
        writers=(
            _bw("user:A", {f"f{i}.txt": f"A-{i}\n".encode() for i in range(4)}),
            _bw("user:B", {f"f{i}.txt": f"B-{i}\n".encode() for i in range(4)},
                delay_ms=5),
            _bw("user:C", {f"f{i}.txt": f"C-{i}\n".encode() for i in range(4)},
                delay_ms=10),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed", "committed"),
            final_state={f"f{i}.txt": f"C-{i}\n".encode() for i in range(4)},
            strategy="lww",
        ),
    ),
    ConflictCase(
        id="B11",
        category="B",
        title="batch where one path is modify/delete",
        description=(
            "A's bulk_write modifies 3 files; B's bulk includes a delete "
            "of one of those same paths. Two paths auto-merge as "
            "one_side_only; the modify/delete path falls to the policy "
            "(LWW keeps A's modification per the modify_delete contract)."
        ),
        setup={"": {f"f{i}.txt": b"v0\n" for i in range(3)}},
        writers=(
            _bw("user:A",
                {f"f{i}.txt": f"A-{i}\n".encode() for i in range(3)}),
            Writer(
                actor="user:B", operation="bulk_write",
                files={"f1.txt": b""}, deleted=("f0.txt",),
                delay_ms=5,
            ),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            final_state={
                "f0.txt": b"A-0\n",       # modify_delete → keep ours (A)
                "f1.txt": b"",            # B's write wins (later)
                "f2.txt": b"A-2\n",       # A only
            },
            strategy="modify_delete",
        ),
    ),
    ConflictCase(
        id="B12",
        category="B",
        title="bulk write collides with subdirectory existence",
        description=(
            "Seed has files under ``logs/``. A's bulk replaces them all. "
            "B's bulk tries to write ``logs`` as a file at the same path "
            "(type collision: directory vs file). Engine should reject or "
            "fall back to LWW on the path."
        ),
        setup={"": {f"logs/{i}.txt": b"x\n" for i in range(3)}},
        writers=(
            _bw("user:A", {f"logs/{i}.txt": b"a\n" for i in range(3)}),
            _w("user:B", b"i am a file now\n", path="logs", delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "rejected"),
            strategy="rejected",
            notes="Writing a file at a path that's currently a directory "
                  "should produce a 400/422 from the path-validator.",
        ),
    ),
]


# ──────────────────────────────────────────────────────────────────────
# Category C — Delete / rename / type-shape conflicts
# ──────────────────────────────────────────────────────────────────────

C_CASES = [
    ConflictCase(
        id="C01",
        category="C",
        title="modify vs delete: same file",
        description=(
            "A modifies the file; B deletes it. Per V1 contract "
            "(merge.py:212), the modify side wins — keep A's content."
        ),
        setup={"": {"f.txt": b"v0\n"}},
        writers=(
            _w("user:A", b"A-modified\n"),
            _del("user:B", "f.txt", delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            final_state={"f.txt": b"A-modified\n"},
            strategy="modify_delete",
        ),
    ),
    ConflictCase(
        id="C02",
        category="C",
        title="delete vs delete: idempotent",
        description=(
            "Both writers delete the same file. Both succeed; final tree "
            "lacks the file. No conflict record needed."
        ),
        setup={"": {"f.txt": b"v0\n"}},
        writers=(
            _del("user:A", "f.txt"),
            _del("user:B", "f.txt", delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            final_state={"f.txt": None},
            strategy="identical",
            notes="Both ended at no-file; identical-end-state, no conflict.",
        ),
    ),
    ConflictCase(
        id="C03",
        category="C",
        title="rename A→B vs modify A",
        description=(
            "A renames foo → bar (delete foo, add bar); B modifies foo "
            "in place. After both apply, ``foo`` no longer exists and "
            "``bar`` contains A's original copy. B's modify-on-deleted "
            "lands as ``bar`` per modify/delete or as ``foo`` survivor."
        ),
        setup={"": {"foo.txt": b"original\n"}},
        writers=(
            _ren("user:A", "foo.txt", "bar.txt"),
            _w("user:B", b"modified-by-B\n", path="foo.txt", delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            strategy="modify_delete",
            notes="Per merge.py modify_delete keeps the modify side: "
                  "expect ``foo.txt`` to survive with B's content AND "
                  "``bar.txt`` with A's content.",
        ),
    ),
    ConflictCase(
        id="C04",
        category="C",
        title="rename collision: A→B and A→C",
        description=(
            "Both writers rename the same source to different targets. "
            "After A: foo→bar. After B: foo→baz. They both started from "
            "the same base. Engine should produce TWO copies (bar and "
            "baz) and remove foo."
        ),
        setup={"": {"foo.txt": b"original\n"}},
        writers=(
            _ren("user:A", "foo.txt", "bar.txt"),
            _ren("user:B", "foo.txt", "baz.txt", delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            final_state={
                "foo.txt": None,
                "bar.txt": b"original\n",
                "baz.txt": b"original\n",
            },
            strategy="one_side_only",
        ),
    ),
    ConflictCase(
        id="C05",
        category="C",
        title="rename target collision",
        description=(
            "A renames foo → bar. B writes a new file at bar with "
            "different content. The rename's target collides with B's "
            "new write — LWW on bar."
        ),
        setup={"": {"foo.txt": b"original\n"}},
        writers=(
            _ren("user:A", "foo.txt", "bar.txt"),
            _w("user:B", b"B-content\n", path="bar.txt", delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            strategy="lww",
            notes="bar.txt: LWW (B is later). foo.txt: gone (A's delete-side stuck).",
        ),
    ),
    ConflictCase(
        id="C06",
        category="C",
        title="rename A→B vs delete A",
        description=(
            "A renames foo→bar; B deletes foo. Both want foo gone. "
            "B's delete is idempotent w.r.t. A's rename's delete-side. "
            "bar should still be created with A's copy of the content."
        ),
        setup={"": {"foo.txt": b"original\n"}},
        writers=(
            _ren("user:A", "foo.txt", "bar.txt"),
            _del("user:B", "foo.txt", delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            final_state={
                "foo.txt": None,
                "bar.txt": b"original\n",
            },
            strategy="identical",
            notes="delete-side coincides; one_side_only on bar.txt.",
        ),
    ),
    ConflictCase(
        id="C07",
        category="C",
        title="delete folder vs modify file inside",
        description=(
            "A deletes every file under ``logs/`` (bulk delete). B "
            "modifies one of those files. Per modify_delete, the modify "
            "side should keep that single file."
        ),
        setup={"": {f"logs/{i}.txt": f"l{i}\n".encode() for i in range(3)}},
        writers=(
            Writer(actor="user:A", operation="bulk_write",
                   files={}, deleted=tuple(f"logs/{i}.txt" for i in range(3))),
            _w("user:B", b"B-kept\n", path="logs/1.txt", delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            final_state={
                "logs/0.txt": None,
                "logs/1.txt": b"B-kept\n",
                "logs/2.txt": None,
            },
            strategy="modify_delete",
        ),
    ),
    ConflictCase(
        id="C08",
        category="C",
        title="write file at path occupied by directory",
        description=(
            "Seed has ``data/foo.txt``. A keeps ``data/`` as a directory; "
            "B tries to write a file at ``data`` (root level). Engine "
            "must reject the type collision."
        ),
        setup={"": {"data/foo.txt": b"hi\n"}},
        writers=(
            _w("user:A", b"x\n", path="data/foo.txt"),
            _w("user:B", b"i am data\n", path="data", delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "rejected"),
            strategy="rejected",
        ),
    ),
    ConflictCase(
        id="C09",
        category="C",
        title="write directory at path occupied by file",
        description=(
            "Reverse of C08: ``data`` exists as a file. B tries to write "
            "``data/foo.txt`` which would force ``data`` to become a "
            "directory. Engine rejects."
        ),
        setup={"": {"data": b"i am a file\n"}},
        writers=(
            _w("user:A", b"i am a file (still)\n", path="data"),
            _w("user:B", b"new file\n", path="data/foo.txt", delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "rejected"),
            strategy="rejected",
        ),
    ),
    ConflictCase(
        id="C10",
        category="C",
        title="move file across scope boundary",
        description=(
            "Seed: file under root scope. A renames root/foo.txt → "
            "docs/foo.txt. The destination is owned by the ``docs`` child "
            "scope. Engine should route the write to ``docs`` scope, NOT "
            "root, so graft preserves it."
        ),
        setup={
            "": {"foo.txt": b"hi\n"},
            "docs": {".keep": b""},
        },
        scopes=(("", "rw"), ("docs", "rw")),
        writers=(
            _ren("user:A", "foo.txt", "docs/foo.txt"),
        ),
        expected=Expected(
            writer_outcomes=("committed",),
            final_state={
                "foo.txt": None,
                "docs/foo.txt": b"hi\n",
            },
            notes="Engine must route the put-side to ``docs`` scope. The "
                  "delete-side stays in root. Two commits expected.",
        ),
    ),
    ConflictCase(
        id="C11",
        category="C",
        title="rename + concurrent rename of parent dir",
        description=(
            "A renames a/b/c.txt → a/b/d.txt (leaf rename). B renames "
            "a/b → a/x (parent rename). The two renames target the same "
            "subtree from different angles. Engine should produce one of: "
            "a/x/c.txt or a/x/d.txt or LWW between them."
        ),
        setup={"": {"a/b/c.txt": b"hi\n"}},
        writers=(
            _ren("user:A", "a/b/c.txt", "a/b/d.txt"),
            _ren("user:B", "a/b", "a/x", delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            strategy="lww",
            notes="Both touch a/b's tree — expect one combined state, "
                  "verify which path the leaf ends up at and whether the "
                  "other writer's delete-side gets a modify_delete record.",
        ),
    ),
    ConflictCase(
        id="C12",
        category="C",
        title="delete vs no-touch: B doesn't see the path at all",
        description=(
            "A deletes foo.txt. B's commit doesn't reference foo.txt — "
            "it just writes to bar.txt. Per delete/modify with theirs at "
            "base, foo stays deleted; both succeed without conflict."
        ),
        setup={"": {"foo.txt": b"v0\n", "bar.txt": b"x\n"}},
        writers=(
            _del("user:A", "foo.txt"),
            _w("user:B", b"B-bar\n", path="bar.txt", delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            final_state={
                "foo.txt": None,
                "bar.txt": b"B-bar\n",
            },
            strategy="one_side_only",
        ),
    ),
]


# ──────────────────────────────────────────────────────────────────────
# Category D — Scope-hierarchy conflicts
# ──────────────────────────────────────────────────────────────────────

D_CASES = [
    ConflictCase(
        id="D01",
        category="D",
        title="parent scope owns path that child writes",
        description=(
            "Root scope contains ``docs/important.md``. Child scope "
            "``docs`` is configured to claim the same path. When both "
            "writers update the file, parent-scope-wins drops the child's "
            "version per V1 §7."
        ),
        setup={
            "": {"docs/important.md": b"root-version\n"},
            "docs": {"important.md": b"root-version\n"},
        },
        scopes=(("", "rw"), ("docs", "rw")),
        writers=(
            _w("user:A", b"root-edit\n", path="docs/important.md"),
            _w("user:B", b"child-edit\n", scope="docs",
               path="important.md", delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "superseded_by_parent"),
            final_state={"docs/important.md": b"root-edit\n"},
            strategy="parent_scope_wins",
            notes="Child's commit may still appear in mut_commits for the "
                  "child scope, but the projected root view shows parent.",
        ),
    ),
    ConflictCase(
        id="D02",
        category="D",
        title="child scope writes inside its territory, parent doesn't touch",
        description=(
            "Child scope writes ``docs/notes.md`` (a path inside its own "
            "territory). Parent scope doesn't touch that path. No conflict; "
            "scope-promote produces a merge commit on the parent branch."
        ),
        setup={
            "": {},
            "docs": {".keep": b""},
        },
        scopes=(("", "rw"), ("docs", "rw")),
        writers=(
            _w("user:A", b"child-content\n", scope="docs", path="notes.md"),
        ),
        expected=Expected(
            writer_outcomes=("committed",),
            final_state={"docs/notes.md": b"child-content\n"},
            strategy="one_side_only",
            notes="Verify scope-promote commit lands on root scope.",
        ),
    ),
    ConflictCase(
        id="D03",
        category="D",
        title="3-level hierarchy: root, /docs, /docs/private — write at each",
        description=(
            "Three concurrent writers, one at each scope level, all "
            "targeting ``docs/private/secret.md``. Per parent-scope-wins, "
            "the root-scope writer should win; if root doesn't touch, "
            "docs wins; otherwise docs/private wins."
        ),
        setup={
            "": {},
            "docs": {".keep": b""},
            "docs/private": {".keep": b""},
        },
        scopes=(("", "rw"), ("docs", "rw"), ("docs/private", "rw")),
        writers=(
            _w("user:A", b"root-version\n",
               path="docs/private/secret.md"),
            _w("user:B", b"docs-version\n", scope="docs",
               path="private/secret.md", delay_ms=5),
            _w("user:C", b"private-version\n", scope="docs/private",
               path="secret.md", delay_ms=10),
        ),
        expected=Expected(
            writer_outcomes=(
                "committed", "superseded_by_parent", "superseded_by_parent",
            ),
            final_state={"docs/private/secret.md": b"root-version\n"},
            strategy="parent_scope_wins",
        ),
    ),
    ConflictCase(
        id="D04",
        category="D",
        title="root scope writes path inside child's territory (no overlap)",
        description=(
            "Root writes ``docs/foo.md``. Child scope ``docs`` does NOT "
            "have foo.md in its tree. With auto-routing on, the engine "
            "should route the write to ``docs`` scope (narrowest scope "
            "owning the path) per the MUT-write rule in the project memo."
        ),
        setup={
            "": {},
            "docs": {".keep": b""},
        },
        scopes=(("", "rw"), ("docs", "rw")),
        writers=(
            _w("user:A", b"hi\n", path="docs/foo.md"),  # no explicit scope
        ),
        expected=Expected(
            writer_outcomes=("committed",),
            final_state={"docs/foo.md": b"hi\n"},
            notes="Verify the commit lands on the ``docs`` scope, not root.",
        ),
    ),
    ConflictCase(
        id="D05",
        category="D",
        title="scope-promote vs concurrent parent write",
        description=(
            "Child scope writes ``docs/x.md`` (lands in child scope). "
            "Before scope-promote runs on root, root scope receives a "
            "concurrent write to a DIFFERENT path. Scope-promote rebases "
            "and produces a clean commit on root."
        ),
        setup={
            "": {"unrelated.txt": b"r0\n"},
            "docs": {".keep": b""},
        },
        scopes=(("", "rw"), ("docs", "rw")),
        writers=(
            _w("user:A", b"child-x\n", scope="docs", path="x.md"),
            _w("user:B", b"root-update\n", path="unrelated.txt", delay_ms=2),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            final_state={
                "docs/x.md": b"child-x\n",
                "unrelated.txt": b"root-update\n",
            },
            strategy="one_side_only",
        ),
    ),
    ConflictCase(
        id="D06",
        category="D",
        title="parent deletes folder; child has scope inside",
        description=(
            "Root scope deletes ``docs/`` wholesale. Child scope ``docs`` "
            "exists with files. The folder deletion at root should NOT "
            "blow away the child scope's tree (graft preserves it)."
        ),
        setup={
            "": {"docs/.keep": b""},
            "docs": {"private.md": b"secret\n"},
        },
        scopes=(("", "rw"), ("docs", "rw")),
        writers=(
            _del("user:A", "docs"),  # bulk delete of the docs/ prefix
        ),
        expected=Expected(
            writer_outcomes=("committed",),
            final_state={"docs/private.md": b"secret\n"},
            notes="Per scope-routing rule, root-scope write at sub-scope "
                  "path is graft-shadowed; child scope's content survives.",
        ),
    ),
    ConflictCase(
        id="D07",
        category="D",
        title="parent renames folder; child scope inside",
        description=(
            "Root renames ``docs`` → ``archived``. Child scope ``docs`` "
            "exists. The rename at root cannot move the child scope (the "
            "scope's path is a database fact). Hooks should surface the "
            "mismatch as an orphaned scope warning."
        ),
        setup={
            "": {"docs/.keep": b""},
            "docs": {"notes.md": b"hi\n"},
        },
        scopes=(("", "rw"), ("docs", "rw")),
        writers=(
            _ren("user:A", "docs", "archived"),
        ),
        expected=Expected(
            writer_outcomes=("committed",),
            final_state={
                "docs/notes.md": b"hi\n",  # child scope unmoved
            },
            notes="Engine logs an orphan-scope warning in PostCommit move hook.",
        ),
    ),
    ConflictCase(
        id="D08",
        category="D",
        title="sibling scopes target the same absolute path",
        description=(
            "Scopes ``a/x`` and ``a/y`` exist as siblings. Both have a "
            "file at ``shared.md`` (relative to their scope, so absolute "
            "paths differ). Verify they don't interfere with each other "
            "in scope state or path index."
        ),
        setup={
            "a/x": {"shared.md": b"x-side\n"},
            "a/y": {"shared.md": b"y-side\n"},
        },
        scopes=(("", "rw"), ("a/x", "rw"), ("a/y", "rw")),
        writers=(
            _w("user:A", b"x-edit\n", scope="a/x", path="shared.md"),
            _w("user:B", b"y-edit\n", scope="a/y", path="shared.md"),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            final_state={
                "a/x/shared.md": b"x-edit\n",
                "a/y/shared.md": b"y-edit\n",
            },
            strategy="one_side_only",
        ),
    ),
    ConflictCase(
        id="D09",
        category="D",
        title="root-scope write with paths spanning multiple child scopes",
        description=(
            "Root submits a bulk_write touching paths inside two child "
            "scopes. Engine should split the batch and route each path "
            "to the narrowest scope."
        ),
        setup={
            "": {},
            "a": {".keep": b""},
            "b": {".keep": b""},
        },
        scopes=(("", "rw"), ("a", "rw"), ("b", "rw")),
        writers=(
            _bw("user:A", {
                "a/file.txt": b"to a\n",
                "b/file.txt": b"to b\n",
                "top.txt": b"to root\n",
            }),
        ),
        expected=Expected(
            writer_outcomes=("committed",),
            final_state={
                "a/file.txt": b"to a\n",
                "b/file.txt": b"to b\n",
                "top.txt": b"to root\n",
            },
            notes="Verify 3 commits land — one per scope.",
        ),
    ),
    ConflictCase(
        id="D10",
        category="D",
        title="parent-scope-wins on overlapping bulk_write",
        description=(
            "Both root and child write the same 5 paths under the child "
            "scope's prefix. Every path triggers parent_scope_wins; "
            "child's 5 writes all get superseded."
        ),
        setup={
            "": {f"docs/file{i}.md": f"r{i}\n".encode() for i in range(5)},
            "docs": {f"file{i}.md": f"r{i}\n".encode() for i in range(5)},
        },
        scopes=(("", "rw"), ("docs", "rw")),
        writers=(
            _bw("user:A", {
                f"docs/file{i}.md": f"root-{i}\n".encode() for i in range(5)
            }),
            _bw("user:B", {
                f"file{i}.md": f"child-{i}\n".encode() for i in range(5)
            }, scope="docs", delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "superseded_by_parent"),
            final_state={
                f"docs/file{i}.md": f"root-{i}\n".encode() for i in range(5)
            },
            strategy="parent_scope_wins",
        ),
    ),
    ConflictCase(
        id="D11",
        category="D",
        title="child scope head is stale relative to root",
        description=(
            "Child scope's last commit is from 100 commits ago. Root has "
            "advanced many times. When child finally writes, the scope-"
            "promote step must rebase on top of the current root head."
        ),
        setup={"": {"f.txt": b"v0\n"}, "docs": {".keep": b""}},
        scopes=(("", "rw"), ("docs", "rw")),
        writers=(
            # Simulate the stale state by submitting child's write LAST,
            # AFTER many root writes (runner pre-fires N root commits).
            _w("user:A", b"child-late\n", scope="docs",
               path="notes.md", base="ancient", delay_ms=20),
        ),
        expected=Expected(
            writer_outcomes=("committed",),
            final_state={"docs/notes.md": b"child-late\n"},
            notes="Runner pre-fires 10+ root commits to make the child's "
                  "base ancient. Verify scope-promote succeeds.",
        ),
    ),
    ConflictCase(
        id="D12",
        category="D",
        title="read-only scope rejects write",
        description=(
            "Scope ``readonly`` has mode ``r``. A write into that scope "
            "via the HTTP access-point auth path must 403/401. (MutOps "
            "in-process call doesn't enforce — this case exercises the "
            "router layer.)"
        ),
        setup={"readonly": {"locked.md": b"don't touch\n"}},
        scopes=(("", "rw"), ("readonly", "r")),
        writers=(
            _w("user:A", b"trying\n", scope="readonly", path="locked.md"),
        ),
        expected=Expected(
            writer_outcomes=("rejected",),
            final_state={"readonly/locked.md": b"don't touch\n"},
            strategy="rejected",
            notes="Requires HTTP/AP-FS runner with mode enforcement. "
                  "MutOps in-process call lacks the check.",
        ),
    ),
    ConflictCase(
        id="D13",
        category="D",
        title="scope deleted while write pending",
        description=(
            "While a write is in flight to scope X, the scope's "
            "repo_scopes row is deleted. The publish RPC should detect "
            "the missing scope and abort cleanly, not silently land an "
            "orphan commit."
        ),
        setup={"to-delete": {"f.txt": b"x\n"}},
        scopes=(("", "rw"), ("to-delete", "rw")),
        writers=(
            _w("user:A", b"in-flight\n", scope="to-delete", path="f.txt"),
        ),
        expected=Expected(
            writer_outcomes=("rejected",),
            strategy="rejected",
            notes="Runner deletes the repo_scopes row BEFORE the writer's "
                  "publish RPC runs (timing-sensitive; may need an artificial "
                  "delay hook in the engine).",
        ),
    ),
    ConflictCase(
        id="D14",
        category="D",
        title="scope renamed while write pending",
        description=(
            "Scope X has path ``foo``. While a write is in flight, the "
            "scope's path is changed to ``bar``. The in-flight write's "
            "scope-path no longer matches the row. Outcome should be "
            "either reject or land at the new path with an audit warning."
        ),
        setup={"foo": {"f.txt": b"x\n"}},
        scopes=(("", "rw"), ("foo", "rw")),
        writers=(
            _w("user:A", b"in-flight\n", scope="foo", path="f.txt"),
        ),
        expected=Expected(
            writer_outcomes=("rejected",),
            strategy="rejected",
        ),
    ),
]


# ──────────────────────────────────────────────────────────────────────
# Category E — Concurrency + CAS storms
# ──────────────────────────────────────────────────────────────────────

E_CASES = [
    ConflictCase(
        id="E01",
        category="E",
        title="basic 2-way race, same file",
        description=(
            "Two writers, no delay between them, same path. One CAS-wins, "
            "the other sees CAS-lost and retries against the new head. "
            "Both commit; LWW final."
        ),
        setup={"": {"f.txt": b"v0\n"}},
        writers=(
            _w("user:A", b"A\n"),
            _w("user:B", b"B\n"),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            strategy="lww",
            notes="Final content is non-deterministic without delay_ms; "
                  "runner should accept either A or B as winner.",
        ),
    ),
    ConflictCase(
        id="E02",
        category="E",
        title="3-way race",
        description="Three concurrent writers on the same path.",
        setup={"": {"f.txt": b"v0\n"}},
        writers=(
            _w("user:A", b"A\n"),
            _w("user:B", b"B\n"),
            _w("user:C", b"C\n"),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed", "committed"),
            strategy="lww",
        ),
    ),
    ConflictCase(
        id="E03",
        category="E",
        title="5 concurrent writers",
        description="CAS retry should keep up; all 5 commit.",
        setup={"": {"f.txt": b"v0\n"}},
        writers=tuple(_w(f"user:W{i}", f"W{i}\n".encode()) for i in range(5)),
        expected=Expected(
            writer_outcomes=tuple(["committed"] * 5),
            strategy="lww",
        ),
    ),
    ConflictCase(
        id="E04",
        category="E",
        title="10 concurrent writers, same path",
        description=(
            "Engine's retry budget is 5. With 10 concurrent writers, "
            "any single writer may hit the budget if it loses 5 CAS in a "
            "row. Some writers may legitimately reject."
        ),
        setup={"": {"f.txt": b"v0\n"}},
        writers=tuple(_w(f"user:W{i}", f"W{i}\n".encode()) for i in range(10)),
        expected=Expected(
            strategy="lww",
            notes="Not all 10 are guaranteed to commit; the runner should "
                  "accept >=5 committed and report any rejected count.",
        ),
    ),
    ConflictCase(
        id="E05",
        category="E",
        title="20 concurrent writers (storm)",
        description=(
            "Verify the engine doesn't deadlock or corrupt scope state "
            "under high contention. Expect significant CAS retries and "
            "some rejections."
        ),
        setup={"": {"f.txt": b"v0\n"}},
        writers=tuple(_w(f"user:W{i}", f"W{i}\n".encode()) for i in range(20)),
        expected=Expected(
            strategy="lww",
            notes="Acceptance: at least 1 committed, no scope-state corruption, "
                  "no stale row in mut_scope_state after settle.",
        ),
    ),
    ConflictCase(
        id="E06",
        category="E",
        title="5 writers on different files (no real conflict)",
        description=(
            "All 5 writers target the same scope but disjoint paths. CAS "
            "should still serialize them (every push bumps scope_hash), "
            "but every commit eventually lands cleanly via retries."
        ),
        setup={"": {f"f{i}.txt": b"v0\n" for i in range(5)}},
        writers=tuple(
            _w(f"user:W{i}", f"W{i}\n".encode(), path=f"f{i}.txt")
            for i in range(5)
        ),
        expected=Expected(
            writer_outcomes=tuple(["committed"] * 5),
            strategy="one_side_only",
        ),
    ),
    ConflictCase(
        id="E07",
        category="E",
        title="explicit stale base_commit_id → 409",
        description=(
            "Single writer with ``base=\"frozen\"``: pass a base_commit_id "
            "captured BEFORE any seed commit. Engine should 409 (precondition "
            "failed); no retry."
        ),
        setup={"": {"f.txt": b"v0\n"}},
        writers=(
            _w("user:A", b"A\n", base="frozen"),
        ),
        expected=Expected(
            writer_outcomes=("rejected",),
            strategy="rejected",
            notes="Verify ConcurrentMutationError → 409 from content_write.",
        ),
    ),
    ConflictCase(
        id="E08",
        category="E",
        title="ancient base, many intervening commits",
        description=(
            "Runner pre-fires 10 commits to the scope after taking the "
            "writer's base. Writer submits with the original base; engine "
            "should rebase / retry / produce LWW result with all 10 prior "
            "writes preserved."
        ),
        setup={"": {"f.txt": b"v0\n"}},
        writers=(
            _w("user:A", b"A-late\n", base="ancient"),
        ),
        expected=Expected(
            writer_outcomes=("committed",),
            final_state={"f.txt": b"A-late\n"},
            strategy="lww",
            notes="Runner must pre-fire 10 root-scope commits between "
                  "capturing the base and submitting the writer.",
        ),
    ),
    ConflictCase(
        id="E09",
        category="E",
        title="rapid sequential writes by one actor",
        description=(
            "No concurrency, just 10 fast sequential writes. Every write "
            "should succeed on attempt 1/5 (no CAS contention)."
        ),
        setup={"": {"f.txt": b"v0\n"}},
        writers=tuple(
            _w("user:A", f"step-{i}\n".encode(), delay_ms=i * 10)
            for i in range(10)
        ),
        expected=Expected(
            writer_outcomes=tuple(["committed"] * 10),
            final_state={"f.txt": b"step-9\n"},
            strategy="one_side_only",
        ),
    ),
    ConflictCase(
        id="E10",
        category="E",
        title="exact retry budget exhaustion",
        description=(
            "Construct a scenario where one writer loses CAS exactly 5 "
            "times and fails on attempt 6. Requires a controlled race "
            "(6 concurrent writers; the slowest one will hit the budget)."
        ),
        setup={"": {"f.txt": b"v0\n"}},
        writers=tuple(
            _w(f"user:W{i}", f"W{i}\n".encode(),
               delay_ms=i)  # slight stagger so order is stable
            for i in range(6)
        ),
        expected=Expected(
            strategy="lww",
            notes="Acceptance: at least 1 writer reports CAS budget "
                  "exhausted; runner should detect via engine log marker "
                  "'[version_engine][...] CAS lost (attempt 5/5)'.",
        ),
    ),
]


# ──────────────────────────────────────────────────────────────────────
# Category F — Policy-driven outcomes
# ──────────────────────────────────────────────────────────────────────

F_CASES = [
    ConflictCase(
        id="F01",
        category="F",
        title="default policy: true conflict → LWW silent",
        description=(
            "Sanity check: with no policy override, an unresolvable "
            "conflict falls through to LWW. Default ConflictPolicyConfig "
            "applies."
        ),
        setup={"": {"f.txt": b"v0\n"}},
        writers=(
            _w("user:A", b"A\n"),
            _w("user:B", b"B\n", delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            final_state={"f.txt": b"B\n"},
            strategy="lww",
            pending_conflicts=0,
        ),
    ),
    ConflictCase(
        id="F02",
        category="F",
        title="manual_review policy → row in mut_conflicts",
        description=(
            "Writer B submits with ``policy=\"manual_review\"``. Conflict "
            "with A's commit cannot be auto-merged; engine queues it in "
            "``mut_conflicts`` with status=pending instead of LWW."
        ),
        setup={"": {"f.txt": b"v0\n"}},
        writers=(
            _w("user:A", b"A\n"),
            _w("user:B", b"B\n", policy="manual_review", delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "pending_resolution"),
            final_state={"f.txt": b"A\n"},
            pending_conflicts=1,
            strategy="manual_review",
        ),
    ),
    ConflictCase(
        id="F03",
        category="F",
        title="manual_review with auto-resolvable diff bypasses queue",
        description=(
            "Same as F02 but the diff is safely auto-mergeable (JSON, "
            "different keys). Even with manual_review, safe merge fires "
            "first and the conflict never reaches the queue."
        ),
        setup={"": {"config.json": b'{"x": 1}'}},
        writers=(
            _w("user:A", b'{"x": 1, "a": true}', path="config.json"),
            _w("user:B", b'{"x": 1, "b": true}', path="config.json",
               policy="manual_review", delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            final_state={"config.json": b'{"a": true, "b": true, "x": 1}'},
            pending_conflicts=0,
            strategy="json_merge",
        ),
    ),
    ConflictCase(
        id="F04",
        category="F",
        title="parent_scope_wins overrides manual_review",
        description=(
            "Even when child submits with manual_review, parent-scope-wins "
            "still triggers because it's a higher-priority rule (V1 §7 "
            "step 2 fires before configured policy)."
        ),
        setup={
            "": {"docs/x.md": b"root\n"},
            "docs": {"x.md": b"root\n"},
        },
        scopes=(("", "rw"), ("docs", "rw")),
        writers=(
            _w("user:A", b"root-edit\n", path="docs/x.md"),
            _w("user:B", b"child-edit\n", scope="docs", path="x.md",
               policy="manual_review", delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "superseded_by_parent"),
            final_state={"docs/x.md": b"root-edit\n"},
            pending_conflicts=0,
            strategy="parent_scope_wins",
        ),
    ),
    ConflictCase(
        id="F05",
        category="F",
        title="policy rule by source_channel: agent → manual_review",
        description=(
            "Config rule: when source_channel=agent, conflict policy is "
            "manual_review. Writer A (papi) wins normally; writer B "
            "(agent) gets queued."
        ),
        setup={"": {"f.txt": b"v0\n"}},
        writers=(
            Writer(actor="user:A", operation="write_file",
                   files={"f.txt": b"A\n"}, source_channel="papi"),
            Writer(actor="agent:B", operation="write_file",
                   files={"f.txt": b"B\n"}, source_channel="agent",
                   delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "pending_resolution"),
            final_state={"f.txt": b"A\n"},
            pending_conflicts=1,
            strategy="manual_review",
            notes="Requires ConflictPolicyConfig with a source_channel='agent' rule.",
        ),
    ),
    ConflictCase(
        id="F06",
        category="F",
        title="policy rule by path glob: *.lock → manual_review",
        description=(
            "Rule: paths matching ``*.lock`` are always manual_review. "
            "Both writers update package.lock; queues a pending conflict."
        ),
        setup={"": {"package.lock": b"v0\n"}},
        writers=(
            _w("user:A", b"A\n", path="package.lock"),
            _w("user:B", b"B\n", path="package.lock", delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "pending_resolution"),
            pending_conflicts=1,
            strategy="manual_review",
        ),
    ),
    ConflictCase(
        id="F07",
        category="F",
        title="multiple rules: first match wins",
        description=(
            "Config has rule A (source_channel=agent → manual_review) "
            "and rule B (path *.txt → lww). For an agent writing a .txt "
            "file, rule A wins."
        ),
        setup={"": {"f.txt": b"v0\n"}},
        writers=(
            Writer(actor="agent:A", operation="write_file",
                   files={"f.txt": b"A\n"}, source_channel="agent"),
            _w("user:B", b"B\n", delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("pending_resolution", "committed"),
            pending_conflicts=1,
            strategy="manual_review",
        ),
    ),
    ConflictCase(
        id="F08",
        category="F",
        title="resolver picks ours",
        description=(
            "After F02 queues a pending conflict, the resolver chooses "
            "``ours`` (keep A's content). Engine writes a resolution "
            "commit; mut_conflicts row goes to status=resolved."
        ),
        setup={"": {"f.txt": b"v0\n"}},
        writers=(
            _w("user:A", b"A\n"),
            _w("user:B", b"B\n", policy="manual_review", delay_ms=5),
            # Third "writer" is the resolver action:
            Writer(actor="user:resolver", operation="resolve",
                   files={"choice": b"ours"}, delay_ms=100),
        ),
        expected=Expected(
            writer_outcomes=("committed", "pending_resolution", "committed"),
            final_state={"f.txt": b"A\n"},
            pending_conflicts=0,
            strategy="manual_review",
            notes="Runner must invoke POST /conflicts/{id}/resolve with "
                  "choice='ours'.",
        ),
    ),
    ConflictCase(
        id="F09",
        category="F",
        title="resolver picks theirs",
        description="Same as F08 but resolver picks ``theirs``.",
        setup={"": {"f.txt": b"v0\n"}},
        writers=(
            _w("user:A", b"A\n"),
            _w("user:B", b"B\n", policy="manual_review", delay_ms=5),
            Writer(actor="user:resolver", operation="resolve",
                   files={"choice": b"theirs"}, delay_ms=100),
        ),
        expected=Expected(
            writer_outcomes=("committed", "pending_resolution", "committed"),
            final_state={"f.txt": b"B\n"},
            pending_conflicts=0,
            strategy="manual_review",
        ),
    ),
    ConflictCase(
        id="F10",
        category="F",
        title="resolver provides custom merged content",
        description=(
            "Resolver sends ``choice=merged`` with explicit content. "
            "Engine writes that exact content as the resolution commit, "
            "regardless of either side's text."
        ),
        setup={"": {"f.txt": b"v0\n"}},
        writers=(
            _w("user:A", b"A\n"),
            _w("user:B", b"B\n", policy="manual_review", delay_ms=5),
            Writer(actor="user:resolver", operation="resolve",
                   files={"choice": b"merged", "content": b"Z (custom)\n"},
                   delay_ms=100),
        ),
        expected=Expected(
            writer_outcomes=("committed", "pending_resolution", "committed"),
            final_state={"f.txt": b"Z (custom)\n"},
            pending_conflicts=0,
            strategy="manual_review",
        ),
    ),
    ConflictCase(
        id="F11",
        category="F",
        title="resolver rejects (cancels) the pending conflict",
        description=(
            "Resolver sends ``choice=reject``. The pending conflict gets "
            "status=rejected; no resolution commit is created; ours stays."
        ),
        setup={"": {"f.txt": b"v0\n"}},
        writers=(
            _w("user:A", b"A\n"),
            _w("user:B", b"B\n", policy="manual_review", delay_ms=5),
            Writer(actor="user:resolver", operation="resolve",
                   files={"choice": b"reject"}, delay_ms=100),
        ),
        expected=Expected(
            writer_outcomes=("committed", "pending_resolution", "committed"),
            final_state={"f.txt": b"A\n"},
            pending_conflicts=0,
            strategy="manual_review",
            notes="Verify mut_conflicts.status='rejected' (not 'resolved').",
        ),
    ),
    ConflictCase(
        id="F12",
        category="F",
        title="multiple pending conflicts on same path, resolved in order",
        description=(
            "Three writers all use manual_review on the same path. Two "
            "conflicts queue (B and C are both pending against A). "
            "Resolving them in order should produce the expected lineage."
        ),
        setup={"": {"f.txt": b"v0\n"}},
        writers=(
            _w("user:A", b"A\n"),
            _w("user:B", b"B\n", policy="manual_review", delay_ms=5),
            _w("user:C", b"C\n", policy="manual_review", delay_ms=10),
            Writer(actor="user:resolver", operation="resolve",
                   files={"choice": b"theirs"}, delay_ms=100),
            Writer(actor="user:resolver", operation="resolve",
                   files={"choice": b"theirs"}, delay_ms=150),
        ),
        expected=Expected(
            writer_outcomes=(
                "committed", "pending_resolution", "pending_resolution",
                "committed", "committed",
            ),
            final_state={"f.txt": b"C\n"},
            pending_conflicts=0,
            strategy="manual_review",
            notes="Each resolve call picks the NEXT pending conflict in "
                  "creation order. First → B wins over A. Second → C wins "
                  "over the post-B head.",
        ),
    ),
]


# ──────────────────────────────────────────────────────────────────────
# Category G — Edge / adversarial
# ──────────────────────────────────────────────────────────────────────

G_CASES = [
    ConflictCase(
        id="G01",
        category="G",
        title="zero-byte file conflict",
        description="Both writers submit zero bytes. Identical strategy.",
        setup={"": {"f.txt": b"v0\n"}},
        writers=(
            _w("user:A", b""),
            _w("user:B", b"", delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            final_state={"f.txt": b""},
            strategy="identical",
        ),
    ),
    ConflictCase(
        id="G02",
        category="G",
        title="binary file conflict (non-UTF-8)",
        description=(
            "File contains arbitrary bytes (PNG header). Line merge "
            "should bail on UnicodeDecodeError; JSON skipped (no .json "
            "extension); falls to LWW."
        ),
        setup={"": {"image.png": bytes([0x89, 0x50, 0x4E, 0x47, 0xFF, 0x00])}},
        writers=(
            _w("user:A", bytes([0x89, 0x50, 0x4E, 0x47, 0xAA, 0x11]),
               path="image.png"),
            _w("user:B", bytes([0x89, 0x50, 0x4E, 0x47, 0xBB, 0x22]),
               path="image.png", delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            strategy="lww",
        ),
    ),
    ConflictCase(
        id="G03",
        category="G",
        title="CRLF vs LF: same logical content",
        description=(
            "File seeded with LF endings. A submits CRLF; B submits LF "
            "with one extra line. Line splitter handles both. Verify "
            "merge produces consistent output without doubling line "
            "endings."
        ),
        setup={"": {"f.txt": b"line1\nline2\n"}},
        writers=(
            _w("user:A", b"line1\r\nline2\r\n"),
            _w("user:B", b"line1\nline2\nline3\n", delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            strategy="line_merge",
            notes="Engine treats CRLF and LF as different content. May "
                  "fall to LWW depending on diff hunk detection.",
        ),
    ),
    ConflictCase(
        id="G04",
        category="G",
        title="UTF-8 BOM at start",
        description=(
            "Base file has UTF-8 BOM. Both writers preserve it; B adds "
            "a line. line_merge should handle (BOM is a single byte "
            "prefix in the first line)."
        ),
        setup={"": {"notes.md": b"\xef\xbb\xbf# Title\n"}},
        writers=(
            _w("user:A", b"\xef\xbb\xbf# Title\nA-added\n", path="notes.md"),
            _w("user:B", b"\xef\xbb\xbf# Title\nB-added\n", path="notes.md",
               delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            strategy="lww",
            notes="Both prepended at line index 1 → overlap → LWW.",
        ),
    ),
    ConflictCase(
        id="G05",
        category="G",
        title="unicode path: 中文文件名.md",
        description=(
            "Path contains non-ASCII characters. Should be allowed (UTF-8 "
            "on disk + S3) and conflict as usual."
        ),
        setup={"": {"中文文件名.md": "原始内容\n".encode("utf-8")}},
        writers=(
            _w("user:A", "A 修改\n".encode("utf-8"), path="中文文件名.md"),
            _w("user:B", "B 修改\n".encode("utf-8"), path="中文文件名.md",
               delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            final_state={"中文文件名.md": "B 修改\n".encode("utf-8")},
            strategy="lww",
        ),
    ),
    ConflictCase(
        id="G06",
        category="G",
        title="very long single line (>1MB)",
        description=(
            "Single-line file 2MB long. Both writers append one byte at "
            "different positions in the middle. Line merge can't split "
            "(no newlines) → LWW."
        ),
        setup={"": {"giant.txt": b"x" * (2 * 1024 * 1024)}},
        writers=(
            _w("user:A", b"x" * (1024 * 1024) + b"A" + b"x" * (1024 * 1024),
               path="giant.txt"),
            _w("user:B", b"x" * (1024 * 1024 + 100) +
               b"B" + b"x" * (1024 * 1024 - 100 - 1),
               path="giant.txt", delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            strategy="lww",
        ),
    ),
    ConflictCase(
        id="G07",
        category="G",
        title="very deep nested path",
        description=(
            "10-level nested path. Both writers update the leaf. Tree "
            "splice must walk through every level."
        ),
        setup={"": {
            "a/b/c/d/e/f/g/h/i/j/leaf.txt": b"v0\n",
        }},
        writers=(
            _w("user:A", b"A\n", path="a/b/c/d/e/f/g/h/i/j/leaf.txt"),
            _w("user:B", b"B\n", path="a/b/c/d/e/f/g/h/i/j/leaf.txt",
               delay_ms=5),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            final_state={"a/b/c/d/e/f/g/h/i/j/leaf.txt": b"B\n"},
            strategy="lww",
        ),
    ),
    ConflictCase(
        id="G08",
        category="G",
        title="many small files (100 × 1 byte)",
        description=(
            "Performance under granularity: 100 single-byte files. "
            "Bulk_write should produce a single commit; CAS once."
        ),
        setup={"": {}},
        writers=(
            _bw("user:A", {f"tiny/{i:03d}.b": bytes([i % 256]) for i in range(100)}),
        ),
        expected=Expected(
            writer_outcomes=("committed",),
            strategy="one_side_only",
        ),
    ),
    ConflictCase(
        id="G09",
        category="G",
        title="case-sensitivity collision (Foo.txt vs foo.txt)",
        description=(
            "POSIX-style scope tree treats paths as case-sensitive. A "
            "creates Foo.txt; B creates foo.txt. No conflict — two "
            "distinct entries. Verify both survive."
        ),
        setup={"": {}},
        writers=(
            _w("user:A", b"upper\n", path="Foo.txt"),
            _w("user:B", b"lower\n", path="foo.txt"),
        ),
        expected=Expected(
            writer_outcomes=("committed", "committed"),
            final_state={
                "Foo.txt": b"upper\n",
                "foo.txt": b"lower\n",
            },
            strategy="one_side_only",
        ),
    ),
    ConflictCase(
        id="G10",
        category="G",
        title="path traversal attempt: ../escape",
        description=(
            "Writer tries to escape the scope via ``../outside.txt``. "
            "Path validator must reject before any tree splice runs."
        ),
        setup={"": {}},
        writers=(
            _w("user:A", b"escaped\n", path="../outside.txt"),
        ),
        expected=Expected(
            writer_outcomes=("rejected",),
            strategy="rejected",
            notes="Engine rejects with ValueError at validate_path.",
        ),
    ),
]


# ──────────────────────────────────────────────────────────────────────
# Aggregated registry
# ──────────────────────────────────────────────────────────────────────

CASES: list[ConflictCase] = [
    *A_CASES,
    *B_CASES,
    *C_CASES,
    *D_CASES,
    *E_CASES,
    *F_CASES,
    *G_CASES,
]


def by_category() -> dict[str, list[ConflictCase]]:
    out: dict[str, list[ConflictCase]] = {}
    for c in CASES:
        out.setdefault(c.category, []).append(c)
    return out


def print_index() -> None:
    """Pretty-print a one-line-per-case index to stdout."""
    print(f"{'ID':5}  {'cat':3}  {'strategy':18}  title")
    print("-" * 100)
    for c in CASES:
        strat = c.expected.strategy or "-"
        print(f"{c.id:5}  {c.category:3}  {strat:18}  {c.title}")


if __name__ == "__main__":
    print_index()
    print()
    print(f"Total: {len(CASES)} cases across "
          f"{len(by_category())} categories")
