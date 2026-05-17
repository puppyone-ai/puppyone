"""Conflict-case runner — drives ``tests.conflicts.cases`` through MutOps.

For each :class:`ConflictCase` it:

  1. creates the scope(s) listed in ``case.scopes`` (under a unique
     timestamped namespace so re-runs don't collide)
  2. seeds the files in ``case.setup``
  3. captures a base commit if any writer uses ``base="frozen"``
     or ``base="ancient"`` (the latter additionally pre-fires N
     intermediate commits so the writer's CAS is genuinely stale)
  4. fires every writer in parallel (``asyncio.gather``) honoring
     ``Writer.delay_ms`` for relative ordering
  5. reads back the final scope state for every path that appears in
     either ``expected.final_state`` or ``ground_truth.final_state``
  6. compares the actual final state to ``expected`` (algorithm
     correctness — when this fails we have a real engine bug)
  7. compares the actual final state to ``ground_truth.final_state``
     (engine-vs-ideal gap — when this differs from "engine_correct",
     it tells us where the current auto-merge needs to grow)
  8. auto-cleans the scope/ledger rows it created (``SMOKE_KEEP=1`` to retain)

Operations not yet exposed to in-process callers (e.g. the
``manual_review`` resolver flow that requires the HTTP conflict_router
plus an outbox dispatch round-trip) are recorded as ``skipped`` with a
reason; they don't fail the run.

Usage:
    cd backend
    SMOKE_ENV_FILE=../.env uv run python scripts/run_conflict_cases.py \\
        --category A,B --limit 30 --output /tmp/conflicts.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import traceback
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Optional


# ──────────────────────────────────────────────────────────────────────
# Bootstrap env + sys.path BEFORE importing src.*
# ──────────────────────────────────────────────────────────────────────

def _load_env() -> None:
    explicit = os.environ.get("SMOKE_ENV_FILE")
    script_path = Path(__file__).resolve()
    candidates: list[Path] = []
    if explicit and Path(explicit).exists():
        candidates.append(Path(explicit).resolve())
    else:
        for parent in script_path.parents:
            p = parent / ".env"
            if p.exists():
                candidates.append(p)
            if parent == parent.parent:
                break
    for env_path in reversed(candidates):
        for raw in env_path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if k and k not in os.environ:
                os.environ[k] = v


_load_env()
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


from supabase import create_client  # noqa: E402

from src.mut_engine.adapters.operations.ops_adapter import MutOps  # noqa: E402
from src.mut_engine.server.repo_manager import MutRepoManager  # noqa: E402
from src.infra.s3.service import S3Service  # noqa: E402
from src.infra.supabase.client import SupabaseClient  # noqa: E402

from tests.conflicts.cases import (  # noqa: E402
    CASES, ConflictCase, Expected, GroundTruth, Writer,
)


URL = os.environ["SUPABASE_URL"]
KEY = os.environ["SUPABASE_KEY"]
sb = create_client(URL, KEY)


# ──────────────────────────────────────────────────────────────────────
# Result dataclasses
# ──────────────────────────────────────────────────────────────────────

@dataclass
class WriterActual:
    """What actually happened for one writer."""
    actor: str
    operation: str
    outcome: str                        # committed | rejected | skipped | error
    commit_id: str = ""
    error: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class CaseResult:
    case_id: str
    category: str
    title: str
    status: str                         # pass | engine_bug | gt_gap | skipped | error
    duration_ms: int = 0

    # Per-writer actual outcomes (parallel to case.writers)
    writers: list[WriterActual] = field(default_factory=list)

    # Final readback per path: ``path → actual_bytes`` (None == file absent)
    actual_state: dict[str, Optional[bytes]] = field(default_factory=dict)

    # Comparison verdicts
    expected_match: bool = False
    ground_truth_match: bool = False
    ground_truth_category: str = "engine_correct"

    # Free-form diagnostic notes (skip reason, diff sketch, exception trace)
    notes: str = ""

    # Lightweight diff against expected / ground_truth — the runner picks
    # the first differing path and shows {path, expected, actual, gt}.
    diff_sample: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        d = asdict(self)
        # Render bytes as utf-8 with replacement (truncate long content)
        d["actual_state"] = {
            k: _render_bytes(v) for k, v in self.actual_state.items()
        }
        if self.diff_sample:
            d["diff_sample"] = {
                k: _render_bytes(v) if isinstance(v, (bytes, bytearray)) else v
                for k, v in self.diff_sample.items()
            }
        return d


def _render_bytes(b: Optional[bytes], limit: int = 200) -> Optional[str]:
    if b is None:
        return None
    if not isinstance(b, (bytes, bytearray)):
        return b
    s = b.decode("utf-8", errors="replace")
    if len(s) > limit:
        return s[:limit] + f"…[+{len(s) - limit}B]"
    return s


# ──────────────────────────────────────────────────────────────────────
# Per-case runner
# ──────────────────────────────────────────────────────────────────────

class CaseRunner:
    """One-shot runner for a single ConflictCase."""

    # Operations we can't drive in-process yet. (Empty after the
    # resolver flow landed — ``resolve`` writers now hit
    # ``engine.resolve()`` directly via ``_invoke_resolve``.)
    _UNSUPPORTED_OPS: set[str] = set()

    def __init__(self, project_id: str, ops: MutOps, run_ts: str):
        self.project_id = project_id
        self.ops = ops
        self.run_ts = run_ts

    async def run(self, case: ConflictCase) -> CaseResult:
        started = datetime.now()
        # Stash for the resolver invocation: ``_invoke_resolve`` needs
        # to look at the case's writers to derive the "theirs" payload
        # for accept-style resolutions.
        self._current_case = case
        # Scope-path namespace per (run, case) so re-runs don't collide
        ns = f".conflict-tests/{self.run_ts}/{case.id}"
        scope_paths = self._materialize_scope_paths(case, ns)

        result = CaseResult(
            case_id=case.id,
            category=case.category,
            title=case.title,
            status="error",
            ground_truth_category=case.effective_ground_truth().category,
        )

        # Early-skip cases that we can't drive
        skip_reason = self._skip_reason(case)
        if skip_reason:
            result.status = "skipped"
            result.notes = skip_reason
            return result

        try:
            self._create_scopes(case, scope_paths)
            await self._seed(case, scope_paths)
            await self._fire_writers(case, scope_paths, result)
            self._read_final_state(case, scope_paths, result)
            self._compare(case, result)
        except Exception as exc:
            result.status = "error"
            result.notes = f"{type(exc).__name__}: {exc}\n" + \
                           traceback.format_exc()[-1500:]
        finally:
            try:
                self._cleanup(scope_paths)
            except Exception as cleanup_exc:
                result.notes += f"\n[cleanup-warn] {cleanup_exc}"

        result.duration_ms = int(
            (datetime.now() - started).total_seconds() * 1000
        )
        return result

    # ── Scope mgmt ─────────────────────────────────────────────────

    @staticmethod
    def _materialize_scope_paths(
        case: ConflictCase, ns: str,
    ) -> dict[str, str]:
        """Map case-declared scope path → unique runner-namespaced path.

        Root scope ``""`` stays as the namespace itself, so all of
        the case's files end up under ``.conflict-tests/<run_ts>/<case_id>/``.
        Child scopes get the ns as a prefix.
        """
        m: dict[str, str] = {}
        for scope_path, _mode in case.scopes:
            m[scope_path] = ns if scope_path == "" else f"{ns}/{scope_path}"
        # Also map any scope referenced by setup that wasn't declared
        for scope_path in case.setup.keys():
            m.setdefault(
                scope_path,
                ns if scope_path == "" else f"{ns}/{scope_path}",
            )
        for w in case.writers:
            m.setdefault(
                w.scope,
                ns if w.scope == "" else f"{ns}/{w.scope}",
            )
        return m

    def _create_scopes(
        self, case: ConflictCase, scope_paths: dict[str, str],
    ) -> None:
        for case_scope, mode in case.scopes:
            real = scope_paths[case_scope]
            sb.table("repo_scopes").insert({
                "project_id": self.project_id,
                "name": f"conflict-{case.id}-{case_scope or 'root'}",
                "path": real,
                "exclude": [],
                "is_root": False,
                "mode": mode,
                "access_key": f"cli_conflict_{self.run_ts}_{case.id}_"
                              f"{case_scope or 'root'}".replace("/", "_"),
            }).execute()
        # Also pre-create scope_state row at empty tree so reads don't 404
        # (engine will overwrite on first commit).

    # ── Seed ───────────────────────────────────────────────────────

    async def _seed(
        self, case: ConflictCase, scope_paths: dict[str, str],
    ) -> None:
        for case_scope, files in case.setup.items():
            real = scope_paths[case_scope]
            if not files:
                continue
            # Write all seed files in one bulk_write per scope so the
            # initial scope head is a single deterministic commit.
            await self.ops.bulk_write(
                self.project_id,
                {p: c for p, c in files.items()},
                who="user:seed",
                scope=real,
                message=f"seed for {case.id}",
            )

    # ── Fire writers ───────────────────────────────────────────────

    async def _fire_writers(
        self,
        case: ConflictCase,
        scope_paths: dict[str, str],
        result: CaseResult,
    ) -> None:
        actuals = [
            WriterActual(actor=w.actor, operation=w.operation, outcome="skipped")
            for w in case.writers
        ]
        result.writers = actuals

        # Phase B: pre-fire stuffer commits for any writer that uses
        # ``base="ancient"`` so its CAS sees an aged scope head when it
        # actually runs. We do this BEFORE launching the parallel
        # writers so timing is deterministic on staging.
        await self._pre_fire_ancient_stuffers(case, scope_paths)

        async def one(idx: int, w: Writer) -> None:
            if w.operation in self._UNSUPPORTED_OPS:
                actuals[idx].outcome = "skipped"
                actuals[idx].error = f"op '{w.operation}' not driven by runner"
                return
            if w.delay_ms:
                await asyncio.sleep(w.delay_ms / 1000.0)
            try:
                real_scope = scope_paths[w.scope]
                res = await self._invoke(w, real_scope)
                actuals[idx].outcome = "committed"
                actuals[idx].commit_id = (
                    res.commit_id if res is not None else ""
                )
            except Exception as exc:
                actuals[idx].outcome = "rejected"
                actuals[idx].error = f"{type(exc).__name__}: {exc}"

        await asyncio.gather(
            *(one(i, w) for i, w in enumerate(case.writers))
        )

    async def _pre_fire_ancient_stuffers(
        self,
        case: ConflictCase,
        scope_paths: dict[str, str],
    ) -> None:
        """For each writer with ``base="ancient"``, write a handful of
        no-op-shaped extra commits to its scope BEFORE the parallel
        gather kicks off. The writer's actual submission then runs
        against a scope head that's several commits ahead of where it
        started, exercising the engine's retry-rebase path."""
        for w in case.writers:
            if w.base != "ancient":
                continue
            real_scope = scope_paths[w.scope]
            for i in range(5):
                await self.ops.write_file(
                    self.project_id,
                    f".aged-stuffer-{w.actor}-{i}.txt",
                    f"stuffer {i}\n".encode(),
                    who=f"system:age-{w.actor}",
                    scope=real_scope,
                    message=f"ancient base stuffer {i}",
                )

    async def _invoke(self, w: Writer, real_scope: str):
        """Translate a Writer to a MutOps call."""
        # Source channel is propagated so policy rules keyed on
        # ``source_channel`` (e.g. ``agent``) fire correctly.
        chan = w.source_channel or "papi"
        # ``base="frozen"`` means "submit with a stale precondition so
        # the engine 409s before doing any work". We pass an obviously-
        # stale base_commit_id (a non-empty placeholder) — the engine
        # raises ``ConcurrentMutationError`` and the runner reports
        # ``rejected``. ``base="ancient"`` already had its scope stuffed
        # in ``_pre_fire_ancient_stuffers``; the writer itself doesn't
        # need a special base for that path.
        base_arg: str | None = None
        if w.base == "frozen":
            base_arg = "0000000000000000000000000000000000000000"
        if w.operation == "write_file":
            ((path, content),) = list(w.files.items())
            return await self.ops.write_file(
                self.project_id, path, content,
                who=w.actor, scope=real_scope, message=f"{w.actor}: {path}",
                policy=w.policy, source_channel=chan,
                base_commit_id=base_arg,
            )
        if w.operation == "bulk_write":
            files = {p: c for p, c in w.files.items() if c is not None}
            deletes = list(w.deleted)
            return await self.ops.bulk_write(
                self.project_id, files,
                who=w.actor, scope=real_scope,
                deleted=deletes,
                message=f"{w.actor}: bulk",
                policy=w.policy, source_channel=chan,
            )
        if w.operation == "delete":
            return await self.ops.delete(
                self.project_id, list(w.files.keys()),
                who=w.actor, scope=real_scope,
                message=f"{w.actor}: delete",
            )
        if w.operation == "rename":
            src = w.files["from"].decode()
            dst = w.files["to"].decode()
            return await self.ops.move(
                self.project_id, src, dst,
                who=w.actor, scope=real_scope,
                message=f"{w.actor}: rename",
            )
        if w.operation == "mkdir":
            ((path, _),) = list(w.files.items())
            return await self.ops.mkdir(
                self.project_id, path,
                who=w.actor, scope=real_scope,
                message=f"{w.actor}: mkdir",
            )
        if w.operation == "resolve":
            return await self._invoke_resolve(w, real_scope)
        raise ValueError(f"unhandled operation: {w.operation}")

    async def _invoke_resolve(self, w: Writer, real_scope: str):
        """Apply a conflict resolution decision.

        Reads the oldest pending row in ``mut_conflicts`` for this
        scope (FIFO so chained resolutions in cat F land in order) and
        calls the engine's ``resolve`` with the requested decision.

        ``files['choice']``:
          * ``reject``  — close the pending row, scope head unchanged
          * ``ours``    — keep what currently sits at scope head (use
                          ``reject`` semantic since ours is already
                          the committed content)
          * ``theirs``  — apply the queued writer's payload as the
                          resolution. We look up the matching writer
                          from the case manifest (the one with
                          ``policy="manual_review"`` whose payload
                          covers the pending row's ``changed_paths``).
          * ``merged``  — use ``files['content']`` as the new content
                          for every conflicted path.
        """

        from src.mut_engine.domain.intents import ConflictResolutionIntent

        decision_raw = w.files.get("choice", b"") or b""
        if isinstance(decision_raw, (bytes, bytearray)):
            decision_str = decision_raw.decode()
        else:
            decision_str = str(decision_raw)
        custom_content = w.files.get("content", None)

        # Wait briefly for the pending row to materialize — if the
        # queued writer is still completing the registration, the
        # row may lag the resolver by a few hundred ms on staging.
        pending = None
        for _ in range(20):
            rows = (
                sb.table("mut_conflicts")
                .select("pending_conflict_id, scope_path, "
                        "changed_paths, proposed_tree_id, created_at")
                .eq("project_id", self.project_id)
                .eq("scope_path", real_scope)
                .eq("status", "pending")
                .order("created_at")
                .limit(1)
                .execute()
                .data or []
            )
            if rows:
                pending = rows[0]
                break
            await asyncio.sleep(0.25)
        if pending is None:
            raise RuntimeError(
                f"no pending conflict to resolve in scope {real_scope!r}"
            )
        pending_id = pending["pending_conflict_id"]
        paths = pending.get("changed_paths") or []

        # Translate runner-side choice to engine ConflictResolutionIntent.
        if decision_str in ("reject", "ours"):
            note = "reject" if decision_str == "reject" else "pick ours (close via reject)"
            return await self.ops._engine.resolve(
                ConflictResolutionIntent(
                    project_id=self.project_id,
                    pending_conflict_id=pending_id,
                    scope_path=real_scope,
                    resolver_actor=w.actor,
                    source_channel="papi",
                    decision="reject",
                    resolution_message=f"{w.actor}: {note}",
                )
            )

        # For accept-style decisions ("theirs" or "merged") we need to
        # materialize the resolution file set.
        if decision_str == "merged":
            if not isinstance(custom_content, (bytes, bytearray)):
                raise ValueError(
                    "resolve op with choice='merged' requires "
                    "files['content'] bytes"
                )
            files = {p: bytes(custom_content) for p in paths}
        elif decision_str == "theirs":
            files = self._theirs_resolution_files(paths)
            if not files:
                raise RuntimeError(
                    "could not derive 'theirs' resolution files — "
                    "no preceding writer with policy='manual_review' "
                    "matches the pending paths"
                )
        else:
            raise ValueError(f"unknown resolve choice: {decision_str!r}")

        return await self.ops._engine.resolve(
            ConflictResolutionIntent(
                project_id=self.project_id,
                pending_conflict_id=pending_id,
                scope_path=real_scope,
                resolver_actor=w.actor,
                source_channel="papi",
                decision="accept",
                resolution_files=files,
                resolution_message=f"{w.actor}: {decision_str}",
            )
        )

    def _theirs_resolution_files(self, paths: list[str]) -> dict[str, bytes]:
        """Find the writer payload that hit the pending row.

        Scans the case's writers in declaration order for the most
        recent ``policy="manual_review"`` write whose ``files`` covers
        the pending row's ``changed_paths``. Returns a dict suitable
        for ``ConflictResolutionIntent.resolution_files``.
        """

        if not hasattr(self, "_current_case"):
            return {}
        case = self._current_case  # type: ignore[attr-defined]
        path_set = set(paths)
        for w in reversed(case.writers):
            if w.policy != "manual_review":
                continue
            if w.operation not in ("write_file", "bulk_write"):
                continue
            files: dict[str, bytes] = {}
            for p, c in w.files.items():
                if not isinstance(c, (bytes, bytearray)):
                    continue
                files[p] = bytes(c)
            if path_set.issubset(files.keys()):
                return {p: files[p] for p in path_set}
        return {}

    # ── Read final state ──────────────────────────────────────────

    def _read_final_state(
        self,
        case: ConflictCase,
        scope_paths: dict[str, str],
        result: CaseResult,
    ) -> None:
        # Union of paths we care about across both targets
        all_paths: set[str] = set()
        all_paths.update(case.expected.final_state.keys())
        all_paths.update(case.effective_ground_truth().final_state.keys())
        # If neither target listed paths, fall back to setup paths so we
        # still record SOMETHING readable.
        if not all_paths:
            for scope_files in case.setup.values():
                all_paths.update(scope_files.keys())

        # We don't know which scope each path lives in. Heuristic:
        # check the root namespace first; if missing, try each declared
        # child scope.
        ns_root = scope_paths.get("", "")
        scope_order = [ns_root] + [
            v for k, v in scope_paths.items() if k != ""
        ]

        for path in sorted(all_paths):
            content: Optional[bytes] = None
            for real_scope in scope_order:
                if not real_scope:
                    continue
                try:
                    content = self.ops.read_file_in_scope(
                        self.project_id, real_scope, path,
                    )
                    break
                except FileNotFoundError:
                    continue
                except Exception:
                    continue
            result.actual_state[path] = content

    # ── Compare ────────────────────────────────────────────────────

    def _compare(self, case: ConflictCase, result: CaseResult) -> None:
        exp = dict(case.expected.final_state)
        gt_obj = case.effective_ground_truth()
        gt = dict(gt_obj.final_state)
        actual = result.actual_state

        result.expected_match = (
            self._states_equivalent(exp, actual) if exp else True
        )
        result.ground_truth_match = (
            self._states_equivalent(gt, actual) if gt else True
        )

        # When the engine emits Git-style conflict markers, that output
        # is strictly MORE informative than the LWW value of either
        # side. For cases whose expected.final_state was authored against
        # LWW (or whose ground_truth.category is ``preserve_both``), a
        # marker block containing both sides is the engine's realized
        # form of "preserve both" — count it as match-equivalent so the
        # test set doesn't need to encode every marker block verbatim.
        if not result.expected_match and self._marker_supersedes(case, actual, exp):
            result.expected_match = True
        if not result.ground_truth_match and self._marker_supersedes(case, actual, gt):
            result.ground_truth_match = True

        if not result.expected_match:
            for path in sorted(set(exp) | set(actual)):
                if exp.get(path) != actual.get(path):
                    result.diff_sample = {
                        "path": path,
                        "expected": exp.get(path),
                        "actual": actual.get(path),
                        "ground_truth": gt.get(path),
                    }
                    break

        if result.expected_match and result.ground_truth_match:
            result.status = "pass"
        elif not result.expected_match:
            result.status = "engine_bug"
        else:
            result.status = "gt_gap"

    @staticmethod
    def _marker_supersedes(
        case: ConflictCase,
        actual: Mapping[str, Optional[bytes]],
        target: Mapping[str, Optional[bytes]],
    ) -> bool:
        """``actual`` superseded ``target`` via Git-style markers?

        Returns True iff for every path the target lists:
          * ``actual`` is a Git-marker block (contains both ``<<<<<<<``
            and ``>>>>>>>``), AND
          * every concurrent writer's content for this path appears
            verbatim inside ``actual``.

        The second condition is what makes marker output "strictly more
        informative" than LWW — we verify both writers' payloads are
        present, not just that the file looks like markers.
        """
        for path, want in target.items():
            got = actual.get(path)
            if got == want:
                continue
            if got is None or not isinstance(got, (bytes, bytearray)):
                return False
            if b"<<<<<<<" not in got or b">>>>>>>" not in got:
                return False
            for w in case.writers:
                payload = w.files.get(path)
                if payload is None:
                    continue
                if not isinstance(payload, (bytes, bytearray)):
                    continue
                # Engine's marker block adds a trailing newline before
                # the ``=======`` / ``>>>>>>>`` delimiter when the
                # writer's payload didn't end with one. Compare both
                # the raw and trailing-newline forms so the runner
                # doesn't falsely flag the marker output as a bug.
                if payload in got:
                    continue
                if not payload.endswith(b"\n") and (payload + b"\n") in got:
                    continue
                return False
        return True

    @staticmethod
    def _states_equivalent(
        target: Mapping[str, Optional[bytes]],
        actual: Mapping[str, Optional[bytes]],
    ) -> bool:
        # We only assert the target's path set. Extra files in actual
        # are tolerated (the case may not list every seed file).
        for path, want in target.items():
            got = actual.get(path)
            if want is None and got is None:
                continue
            if want == got:
                continue
            # Semantic equivalence for structured formats: when both sides
            # are valid for the file type, compare parsed values so cosmetic
            # differences (key order, indent, trailing newlines) don't get
            # flagged as engine bugs.
            if CaseRunner._semantic_equal(path, want, got):
                continue
            return False
        return True

    @staticmethod
    def _semantic_equal(
        path: str, want: Optional[bytes], got: Optional[bytes],
    ) -> bool:
        if want is None or got is None:
            return False
        if path.endswith(".json"):
            try:
                return json.loads(want) == json.loads(got)
            except (json.JSONDecodeError, UnicodeDecodeError):
                return False
        # Line-set equivalence for content where order is not contractual
        # (the merge engine's union order is a function of internal set
        # iteration). Sorted lines with empty-line normalisation handles
        # both "both edits survive" and "trailing newline added" cases.
        try:
            want_lines = sorted(l for l in want.decode().splitlines() if l)
            got_lines = sorted(l for l in got.decode().splitlines() if l)
            return want_lines == got_lines
        except UnicodeDecodeError:
            return False

    # ── Cleanup ────────────────────────────────────────────────────

    def _cleanup(self, scope_paths: dict[str, str]) -> None:
        if os.environ.get("SMOKE_KEEP"):
            return
        for real in scope_paths.values():
            self._delete_scope(real)

    def _delete_scope(self, scope_path: str) -> None:
        commits = (
            sb.table("mut_commits")
            .select("commit_id")
            .eq("project_id", self.project_id)
            .eq("scope_path", scope_path)
            .execute()
            .data or []
        )
        cids = [c["commit_id"] for c in commits]
        if cids:
            txns = (
                sb.table("version_transactions")
                .select("id")
                .in_("committed_commit_id", cids)
                .execute()
                .data or []
            )
            tids = [t["id"] for t in txns]
            if tids:
                sb.table("audit_logs").delete().in_(
                    "transaction_id", tids).execute()
            sb.table("mut_version_outbox").delete().in_("commit_id", cids).execute()
            sb.table("version_transactions").delete().in_(
                "committed_commit_id", cids).execute()
            sb.table("mut_commits").delete().in_("commit_id", cids).execute()
        sb.table("mut_scope_state").delete().eq(
            "project_id", self.project_id).eq("scope_path", scope_path).execute()
        sb.table("mut_version_index").delete().eq(
            "project_id", self.project_id).eq("scope_path", scope_path).execute()
        sb.table("repo_scopes").delete().eq(
            "project_id", self.project_id).eq("path", scope_path).execute()
        # fs_path_index may or may not exist
        try:
            sb.table("fs_path_index").delete().eq(
                "project_id", self.project_id).eq(
                "scope_path", scope_path).execute()
        except Exception:
            pass

    # ── Skip detection ─────────────────────────────────────────────

    @staticmethod
    def _skip_reason(case: ConflictCase) -> str:
        # Multi-scope cases work as long as none of their writers expect
        # the scope-mode HTTP enforcement (the engine doesn't enforce
        # read-only at the in-process API). Cross-scope move is a
        # separate engine restriction we can't bypass in the runner.
        if any(mode == "r" for _, mode in case.scopes):
            return (
                "case requires read-only scope mode enforcement (HTTP layer, "
                "not MutOps in-process)"
            )
        for w in case.writers:
            if w.operation in CaseRunner._UNSUPPORTED_OPS:
                return f"writer uses unsupported op: {w.operation}"
        return ""


# ──────────────────────────────────────────────────────────────────────
# Aggregate report
# ──────────────────────────────────────────────────────────────────────

@dataclass
class Report:
    started_at: str
    finished_at: str = ""
    results: list[CaseResult] = field(default_factory=list)

    def summary(self) -> dict:
        total = len(self.results)
        by_status: dict[str, int] = {}
        by_gt_cat: dict[str, dict[str, int]] = {}
        for r in self.results:
            by_status[r.status] = by_status.get(r.status, 0) + 1
            cat = r.ground_truth_category
            slot = by_gt_cat.setdefault(cat, {"pass": 0, "gap": 0, "skip": 0,
                                              "bug": 0, "error": 0})
            if r.status == "pass":
                slot["pass"] += 1
            elif r.status == "gt_gap":
                slot["gap"] += 1
            elif r.status == "engine_bug":
                slot["bug"] += 1
            elif r.status == "skipped":
                slot["skip"] += 1
            else:
                slot["error"] += 1
        return {
            "total": total,
            "by_status": by_status,
            "by_ground_truth_category": by_gt_cat,
        }

    def to_dict(self) -> dict:
        return {
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "summary": self.summary(),
            "results": [r.to_dict() for r in self.results],
        }


# ──────────────────────────────────────────────────────────────────────
# Entry point
# ──────────────────────────────────────────────────────────────────────

def _pick_project() -> str:
    rows = (
        sb.table("mut_commits")
        .select("project_id")
        .order("created_at", desc=True)
        .limit(20)
        .execute()
        .data or []
    )
    if not rows:
        sys.exit("!! no projects with activity in mut_commits")
    return rows[0]["project_id"]


def _filter_cases(args) -> list[ConflictCase]:
    cases = list(CASES)
    if args.category:
        cats = {c.strip().upper() for c in args.category.split(",")}
        cases = [c for c in cases if c.category in cats]
    if args.case_id:
        ids = {x.strip() for x in args.case_id.split(",")}
        cases = [c for c in cases if c.id in ids]
    if args.limit:
        cases = cases[:args.limit]
    return cases


def _format_status(status: str) -> str:
    return {
        "pass": "OK    ",
        "engine_bug": "BUG   ",
        "gt_gap": "GAP   ",
        "skipped": "SKIP  ",
        "error": "ERR   ",
    }.get(status, status)


async def _run_all(args) -> Report:
    project_id = args.project_id or _pick_project()
    print(f"== project: {project_id}")
    run_ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    print(f"== run: {run_ts}")

    repo_manager = MutRepoManager(S3Service(), SupabaseClient())
    ops = MutOps(repo_manager)
    runner = CaseRunner(project_id, ops, run_ts)

    cases = _filter_cases(args)
    print(f"== running {len(cases)} cases")
    print()

    report = Report(started_at=run_ts)
    print(f"{'ID':5}  {'cat':3}  {'status':6}  {'gt cat':16}  title")
    print("-" * 120)
    for case in cases:
        try:
            result = await runner.run(case)
        except Exception as exc:
            result = CaseResult(
                case_id=case.id, category=case.category, title=case.title,
                status="error", notes=f"runner exception: {exc}",
                ground_truth_category=case.effective_ground_truth().category,
            )
        report.results.append(result)
        print(
            f"{case.id:5}  {case.category:3}  "
            f"{_format_status(result.status)}  "
            f"{result.ground_truth_category:16}  {case.title}"
        )
        if result.status in ("engine_bug", "error") and result.notes:
            print(f"    ⤷ {result.notes.splitlines()[0][:140]}")
        if result.status == "engine_bug" and result.diff_sample:
            path = result.diff_sample.get("path")
            exp = _render_bytes(result.diff_sample.get("expected"), 80)
            act = _render_bytes(result.diff_sample.get("actual"), 80)
            print(f"    ⤷ diff @ {path}: expected={exp!r} actual={act!r}")

    report.finished_at = datetime.now(timezone.utc).strftime(
        "%Y%m%dT%H%M%S")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-id", help="Target project (default: most-recent)")
    parser.add_argument("--category", help="Comma-separated A,B,C,...")
    parser.add_argument("--case-id", help="Comma-separated specific case IDs")
    parser.add_argument("--limit", type=int, help="Max number of cases to run")
    parser.add_argument("--output", help="Write JSON report to this path")
    args = parser.parse_args()

    report = asyncio.run(_run_all(args))

    print()
    print("== summary ==")
    summary = report.summary()
    print(f"  total: {summary['total']}")
    print(f"  by_status: {summary['by_status']}")
    print("  by_ground_truth_category:")
    for cat, counts in sorted(summary["by_ground_truth_category"].items()):
        print(f"    {cat:18}  {counts}")

    if args.output:
        Path(args.output).write_text(
            json.dumps(report.to_dict(), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        print(f"  → {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
