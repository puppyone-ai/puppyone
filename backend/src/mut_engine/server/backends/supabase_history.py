"""
SupabaseHistoryManager — PostgreSQL implementation of Mut History

Storage layout
──────────────
* ``mut_commits`` — one row per commit, keyed by (project_id, commit_id).
  ``commit_id`` is the 40-hex SHA-1 of the git ``commit`` object body
  (built by :func:`mut.foundation.git_format.encode_commit` and stored
  in the project's ``ObjectStore``). PuppyOne and any standard git tool
  derive the same id from the same commit body byte-for-byte.

* ``mut_scope_state`` — per-scope pointer. Holds the latest
  ``scope_hash`` (content fingerprint, CAS target) and
  ``head_commit_id`` (commit pointer derived from the hash). The old
  per-scope integer ``version`` column no longer exists.

* ``projects`` — keeps ``mut_root_hash`` only. ``mut_version`` is gone.

Linear ordering
───────────────
Without an integer counter, history is ordered by
``(created_at ASC, commit_id ASC)``. ``commit_id`` acts as a
deterministic tie-breaker when two commits land in the same
microsecond (extremely rare but possible under heavy concurrency).

scope_path canonical form
─────────────────────────
Every public method that accepts a ``scope_path`` normalizes the
value on entry via :func:`_normalize`. The DB-level trigger in
``20260416100000_scope_path_canonical.sql`` enforces the same shape
as a second line of defense.

Interface compatibility
───────────────────────
This class matches the ``HistoryBackend`` surface expected by
``mut.server.repo.ServerRepo`` and by ``mut.server.handlers``.
"""

from __future__ import annotations

import json

from src.infra.supabase.client import SupabaseClient
from src.mut_engine.server.backends import safe_data as _safe_data
from src.utils.logger import log_error, log_info


class SupabaseHistoryManager:
    """Supabase/PostgreSQL history backend keyed by commit_id."""

    TABLE = "mut_commits"
    SCOPE_STATE_TABLE = "mut_scope_state"

    def __init__(self, supabase: SupabaseClient, project_id: str):
        self._client = supabase.client
        self._project_id = project_id

    # ── Global Head ──
    #
    # There is no dedicated "global head" column on the projects
    # table — head is always tracked per-scope on mut_scope_state.
    # For compatibility with ``ServerRepo`` (which still exposes a
    # project-level head), we return the commit_id of the most
    # recently recorded commit across all scopes.

    def get_head_commit_id(self) -> str:
        # 2-second cache: prevents repeated ORDER BY DESC scans within same request
        import time as _time
        now = _time.monotonic()
        if hasattr(self, "_head_cid_cache") and now - self._head_cid_ts < 2.0:
            return self._head_cid_val
        resp = (
            self._client.table(self.TABLE)
            .select("commit_id")
            .eq("project_id", self._project_id)
            .order("created_at", desc=True)
            .order("commit_id", desc=True)
            .limit(1)
            .execute()
        )
        rows = _safe_data(resp) or []
        val = rows[0]["commit_id"] if rows else ""
        self._head_cid_val = val
        self._head_cid_ts = now
        return val

    def set_head_commit_id(self, _cid: str) -> None:
        """No-op: project-level head is derived from mut_commits.

        Kept on the interface because ``ServerRepo`` calls it; but
        the source of truth is ``mut_scope_state.head_commit_id``
        (per-scope). Persisting a second copy on ``projects`` would
        create a global contention point we explicitly want to avoid.
        """

    # ── Global Root Hash (used by root-hash CAS path) ──

    def get_root_hash(self) -> str:
        import time as _time
        now = _time.monotonic()
        if hasattr(self, "_root_hash_cache") and now - self._root_hash_ts < 0.1:
            return self._root_hash_val
        resp = (
            self._client.table("projects")
            .select("mut_root_hash")
            .eq("id", self._project_id)
            .maybe_single()
            .execute()
        )
        data = _safe_data(resp)
        val = data.get("mut_root_hash", "") if data else ""
        self._root_hash_val = val
        self._root_hash_ts = now
        self._root_hash_cache = True
        return val

    def set_root_hash(self, h: str) -> None:
        self._client.table("projects").update(
            {"mut_root_hash": h}
        ).eq("id", self._project_id).execute()
        # Invalidate cache after write
        if hasattr(self, "_root_hash_cache"):
            del self._root_hash_cache

    # ── Per-Scope Head & Hash ──

    def get_scope_head_commit_id(self, scope_path: str) -> str:
        scope_path = _normalize(scope_path)
        resp = (
            self._client.table(self.SCOPE_STATE_TABLE)
            .select("head_commit_id")
            .eq("project_id", self._project_id)
            .eq("scope_path", scope_path)
            .maybe_single()
            .execute()
        )
        data = _safe_data(resp)
        return data.get("head_commit_id", "") if data else ""

    def set_scope_head_commit_id(self, scope_path: str, cid: str) -> None:
        scope_path = _normalize(scope_path)
        self._upsert_scope_state(scope_path, head_commit_id=cid)

    def get_scope_hash(self, scope_path: str) -> str:
        scope_path = _normalize(scope_path)
        resp = (
            self._client.table(self.SCOPE_STATE_TABLE)
            .select("scope_hash")
            .eq("project_id", self._project_id)
            .eq("scope_path", scope_path)
            .maybe_single()
            .execute()
        )
        data = _safe_data(resp)
        return data.get("scope_hash", "") if data else ""

    def get_scope_state(self, scope_path: str) -> tuple[str, str]:
        """Return ``(scope_hash, head_commit_id)`` with one DB round trip."""
        scope_path = _normalize(scope_path)
        resp = (
            self._client.table(self.SCOPE_STATE_TABLE)
            .select("scope_hash, head_commit_id")
            .eq("project_id", self._project_id)
            .eq("scope_path", scope_path)
            .maybe_single()
            .execute()
        )
        data = _safe_data(resp)
        if not data:
            return "", ""
        return data.get("scope_hash", "") or "", data.get("head_commit_id", "") or ""

    def set_scope_hash(self, scope_path: str, h: str) -> None:
        scope_path = _normalize(scope_path)
        self._upsert_scope_state(scope_path, scope_hash=h)

    def get_all_scope_hashes(self) -> dict[str, str]:
        """Return ``{scope_path: scope_hash}`` for every scope in this project.

        Used by the post-push graft path in ``services/hooks.py`` to rebuild
        ``projects.mut_root_hash`` from authoritative DB state instead of
        reading the previous root tree from S3 (which is itself a derived
        artifact and the silent-overwrite vector that motivated the
        DB-authoritative refactor — see ``mut-bug-checklist.md`` P0-5).

        Empty ``scope_hash`` rows are skipped: a scope that has never been
        pushed contributes nothing to the root tree. ``scope_path`` is the
        canonical (already-normalized) form stored in the table.
        """
        resp = (
            self._client.table(self.SCOPE_STATE_TABLE)
            .select("scope_path, scope_hash")
            .eq("project_id", self._project_id)
            .execute()
        )
        rows = _safe_data(resp) or []
        return {
            row["scope_path"]: row["scope_hash"]
            for row in rows
            if row.get("scope_hash")
        }

    def _upsert_scope_state(self, scope_path: str, *,
                            scope_hash: str | None = None,
                            head_commit_id: str | None = None) -> None:
        """Insert or update specific fields of the scope state row.

        ``scope_path`` is assumed to be already normalized by the caller.
        """
        data: dict = {
            "project_id": self._project_id,
            "scope_path": scope_path,
        }
        if scope_hash is not None:
            data["scope_hash"] = scope_hash
        if head_commit_id is not None:
            data["head_commit_id"] = head_commit_id

        self._client.table(self.SCOPE_STATE_TABLE).upsert(
            data, on_conflict="project_id,scope_path"
        ).execute()

    def cas_update_scope_hash(self, scope_path: str, old_hash: str,
                              new_hash: str, head_commit_id: str = "") -> bool:
        """Compare-and-swap on (scope_hash, head_commit_id).

        Calls the ``cas_update_scope_state`` PL/pgSQL function which
        atomically updates both fields when the pre-image
        ``scope_hash`` matches. Returns ``True`` on success,
        ``False`` on concurrent conflict.
        """
        scope_path = _normalize(scope_path)

        try:
            resp = self._client.rpc("cas_update_scope_state", {
                "p_project_id": self._project_id,
                "p_scope_path": scope_path,
                "p_old_hash": old_hash or "",
                "p_new_hash": new_hash,
                "p_head_commit_id": head_commit_id or "",
            }).execute()
            data = resp.data
            if isinstance(data, bool):
                return data
            if isinstance(data, list) and len(data) > 0:
                return bool(data[0])
            return False
        except Exception as e:
            log_error(
                f"[CAS] cas_update_scope_state RPC failed for "
                f"scope='{scope_path}': {e}. Deploy the SQL migration first."
            )
            raise RuntimeError(
                "CAS RPC not available — concurrency control requires "
                "the cas_update_scope_state function. Original error: "
                f"{e}"
            ) from e

    def cas_update_root_hash(self, old_hash: str, new_hash: str) -> bool:
        """CAS update the global root hash on the projects table."""
        try:
            resp = self._client.rpc("cas_update_root_hash", {
                "p_project_id": self._project_id,
                "p_old_hash": old_hash,
                "p_new_hash": new_hash,
            }).execute()
            data = resp.data
            success = False
            if isinstance(data, bool):
                success = data
            elif isinstance(data, list) and len(data) > 0:
                success = bool(data[0])
            if success and hasattr(self, "_root_hash_cache"):
                del self._root_hash_cache  # Invalidate cache after CAS write
            return success
        except Exception as e:
            log_error(
                f"[CAS] cas_update_root_hash RPC failed: {e}. "
                "Deploy the SQL migration first."
            )
            raise RuntimeError(
                "CAS RPC not available — concurrency control requires "
                "the cas_update_root_hash function. Original error: "
                f"{e}"
            ) from e

    def publish_scope_update(
        self,
        *,
        scope_path: str,
        old_scope_hash: str,
        new_scope_hash: str,
        commit_id: str,
        who: str,
        message: str,
        changes: list,
        conflicts: list | None,
        created_at_iso: str,
        audit_event_type: str,
        audit_agent_id: str,
        audit_detail: dict,
        source_channel: str = "",
        policy: str = "",
        base_commit_id: str = "",
        client_commit_id: str = "",
        proposed_tree_id: str = "",
        intent_type: str = "operation",
    ) -> tuple[bool, int | None]:
        """Atomically publish scope head, history, audit, transaction, outbox.

        Returns ``(published, transaction_id)`` where ``transaction_id`` is
        the newly-inserted ``version_transactions`` row id (or ``None`` if
        the older single-bool RPC shape is in use, which happens during the
        rolling migration window before the v2 RPC is deployed).
        """

        scope_path = _normalize(scope_path)
        try:
            resp = self._client.rpc("publish_mut_scope_update", {
                "p_project_id": self._project_id,
                "p_scope_path": scope_path,
                "p_old_hash": old_scope_hash or "",
                "p_new_hash": new_scope_hash,
                "p_head_commit_id": commit_id,
                "p_who": who,
                "p_message": message or "",
                "p_event_type": audit_event_type,
                "p_changes": changes or [],
                "p_conflicts": _serialize_conflicts(conflicts) if conflicts else None,
                "p_created_at": created_at_iso or "",
                "p_audit_agent_id": audit_agent_id,
                "p_audit_detail": audit_detail or {},
                "p_source_channel": source_channel or "",
                "p_policy": policy or "",
                "p_base_commit_id": base_commit_id or "",
                "p_client_commit_id": client_commit_id or "",
                "p_proposed_tree_id": proposed_tree_id or "",
                "p_intent_type": intent_type or "operation",
            }).execute()
            data = resp.data
            ok, txn_id = _decode_publish_result(data)
            if ok:
                for attr in ("_head_cid_cache", "_root_hash_cache"):
                    if hasattr(self, attr):
                        delattr(self, attr)
            return ok, txn_id
        except Exception as e:
            log_error(
                f"[Publish] publish_mut_scope_update RPC failed for "
                f"scope='{scope_path}': {e}. Deploy the SQL migration first."
            )
            raise RuntimeError(
                "atomic publish RPC not available — version writes require "
                "publish_mut_scope_update. Original error: "
                f"{e}"
            ) from e

    def record_version_index(
        self,
        *,
        scope_path: str,
        source_commit_id: str,
        source_scope_hash: str,
        project_root_hash: str,
        project_view_commit_id: str,
    ) -> None:
        """Persist the scope-commit → project-view-commit graft mapping."""

        if not source_commit_id or not project_view_commit_id:
            return
        data = {
            "project_id": self._project_id,
            "scope_path": _normalize(scope_path),
            "source_commit_id": source_commit_id,
            "source_scope_hash": source_scope_hash or "",
            "project_root_hash": project_root_hash or "",
            "project_view_commit_id": project_view_commit_id,
        }
        self._client.table("mut_version_index").upsert(
            data,
            on_conflict="project_id,source_commit_id",
        ).execute()

    def get_latest_project_view_commit_id(self) -> str:
        resp = (
            self._client.table("mut_version_index")
            .select("project_view_commit_id")
            .eq("project_id", self._project_id)
            .order("created_at", desc=True)
            .order("id", desc=True)
            .limit(1)
            .execute()
        )
        rows = _safe_data(resp) or []
        return rows[0].get("project_view_commit_id", "") if rows else ""

    def list_object_gc_roots(self) -> list[str]:
        """Return durable roots that make Git objects reachable.

        Used by the object GC mark phase. The method deliberately gathers
        roots from DB facts rather than from the object store itself: current
        scope refs, the project root, and all recorded commit rows are the
        authoritative publish surface.
        """

        roots: list[str] = []
        try:
            data = (
                self._client.table("projects")
                .select("mut_root_hash")
                .eq("id", self._project_id)
                .maybe_single()
                .execute()
            )
            project = _safe_data(data) or {}
            roots.append(project.get("mut_root_hash", ""))
        except Exception as exc:  # noqa: BLE001
            log_error(f"[MutHistory] object GC project roots failed: {exc}")

        try:
            for row in _select_all(
                self._client,
                self.SCOPE_STATE_TABLE,
                "scope_hash, head_commit_id",
                project_id=self._project_id,
            ):
                roots.extend([row.get("scope_hash", ""), row.get("head_commit_id", "")])
        except Exception as exc:  # noqa: BLE001
            log_error(f"[MutHistory] object GC scope roots failed: {exc}")

        try:
            for row in _select_all(
                self._client,
                self.TABLE,
                "commit_id, root_hash, scope_hash",
                project_id=self._project_id,
            ):
                roots.extend([
                    row.get("commit_id", ""),
                    row.get("root_hash", ""),
                    row.get("scope_hash", ""),
                ])
        except Exception as exc:  # noqa: BLE001
            log_error(f"[MutHistory] object GC history roots failed: {exc}")

        return roots

    def list_version_index_roots(self) -> list[dict]:
        """Return persistent subtree/history graft roots for object GC."""

        try:
            return _select_all(
                self._client,
                "mut_version_index",
                (
                    "source_commit_id, source_scope_hash, "
                    "project_root_hash, project_view_commit_id"
                ),
                project_id=self._project_id,
            )
        except Exception as exc:  # noqa: BLE001
            log_warning(f"[MutHistory] object GC version-index roots unavailable: {exc}")
            return []

    def list_pending_outbox_roots(self) -> list[dict]:
        """Return unprocessed durable side-effect rows that must pin objects."""

        try:
            return _select_all_query(
                lambda: (
                    self._client.table("mut_version_outbox")
                    .select("commit_id, payload")
                    .eq("project_id", self._project_id)
                    .is_("processed_at", "null")
                )
            )
        except Exception as exc:  # noqa: BLE001
            log_warning(f"[MutHistory] object GC outbox roots unavailable: {exc}")
            return []

    def list_pending_conflict_roots(self) -> list[dict]:
        """Return pending conflict metadata that may reference promoted roots."""

        try:
            return [
                row.get("metadata") or {}
                for row in _select_all_query(
                    lambda: (
                        self._client.table("audit_logs")
                        .select("metadata")
                        .eq("project_id", self._project_id)
                        .like("action", "%conflict_pending%")
                    )
                )
            ]
        except Exception as exc:  # noqa: BLE001
            log_warning(f"[MutHistory] object GC pending-conflict roots unavailable: {exc}")
            return []

    # ── Scope History Queries ──

    def get_previous_scope_hash(self, scope_path: str,
                                before_commit_id: str = "") -> str:
        """Return the ``scope_hash`` of the commit immediately preceding
        ``before_commit_id`` within this scope.

        When ``before_commit_id`` is empty, returns the current latest
        commit's scope_hash (i.e. "most recent known" for this scope).
        Used by graft conflict detection — we compare this fingerprint
        against the subtree under the global root to decide whether a
        sibling scope concurrently modified our path.
        """
        scope_path = _normalize(scope_path)

        # Locate the reference commit to anchor "before".
        before_entry = None
        if before_commit_id:
            before_entry = self.get_entry(before_commit_id)

        query = (
            self._client.table(self.TABLE)
            .select("scope_hash, created_at, commit_id")
            .eq("project_id", self._project_id)
            .eq("scope_path", scope_path)
            .order("created_at", desc=True)
            .order("commit_id", desc=True)
            .limit(1)
        )

        if before_entry and before_entry.get("created_at"):
            query = query.lt("created_at", before_entry["created_at"])

        try:
            resp = query.execute()
            rows = _safe_data(resp) or []
            if rows and rows[0].get("scope_hash"):
                return rows[0]["scope_hash"]
        except Exception as e:  # noqa: BLE001 — defensive on optional lookup
            log_error(f"[MutHistory] get_previous_scope_hash failed for scope='{scope_path}': {e}")
        return ""

    # ── Record ──

    def record(
        self,
        commit_id: str,
        who: str,
        message: str,
        scope_path: str,
        changes: list,
        conflicts: list | None = None,
        root_hash: str = "",
        scope_hash: str = "",
        created_at_iso: str = "",
    ) -> None:
        """Persist a commit.

        ``commit_id`` is the 40-hex SHA-1 of the git ``commit`` object
        body. The caller is expected to have computed it already
        (handlers / direct_writer do this right before calling us, so
        the value ends up in the audit log too).
        """
        if not commit_id:
            raise ValueError("commit_id is required")

        scope_path = _normalize(scope_path)
        data: dict = {
            "project_id": self._project_id,
            "commit_id": commit_id,
            "root_hash": root_hash,
            "scope_path": scope_path,
            "scope_hash": scope_hash,
            "who": who,
            "message": message or "",
            "changes": (
                json.dumps(changes) if isinstance(changes, list) else changes
            ),
        }
        if created_at_iso:
            data["created_at"] = created_at_iso
        if conflicts:
            from dataclasses import asdict
            serializable = [
                asdict(c) if hasattr(c, "__dataclass_fields__") else c
                for c in conflicts
            ]
            data["conflicts"] = json.dumps(serializable)

        self._client.table(self.TABLE).insert(data).execute()
        log_info(
            f"[MutHistory] Recorded commit {commit_id[:8]} "
            f"for project {self._project_id}"
        )

    # ── Query ──

    def get_since(
        self,
        since_commit_id: str,
        scope_path: str | None = None,
        limit: int = 0,
    ) -> list[dict]:
        """Return commits strictly after ``since_commit_id`` in linear
        order.

        Empty ``since_commit_id`` means "from the very beginning".
        The final result is always ordered
        ``(created_at ASC, commit_id ASC)`` — identical to the
        filesystem backend in the ``mut`` library, so both backends
        yield the same linear view.

        When a ``limit`` is supplied, the returned slice is the
        **newest** ``limit`` commits (matching
        ``entries[-limit:]`` in the filesystem backend), not the
        oldest.  We achieve this by pulling rows DESC from Postgres,
        capping at ``limit``, and reversing in-process — so callers
        that ask for "latest 50" get the most recent 50 commits in
        chronological order, not the earliest 50 ever recorded.
        """
        since_entry = None
        if since_commit_id:
            since_entry = self.get_entry(since_commit_id)
            if since_entry is None:
                # Unknown anchor → safer to return nothing than to
                # leak the full history.
                return []

        query = (
            self._client.table(self.TABLE)
            .select("*")
            .eq("project_id", self._project_id)
            # Fetch newest-first so LIMIT keeps the tail; we reverse
            # below to present the caller with ASC order.
            .order("created_at", desc=True)
            .order("commit_id", desc=True)
        )

        if since_entry:
            anchor_time = since_entry.get("created_at", "")
            anchor_cid = since_entry.get("commit_id", "")
            # Emulate `(created_at, commit_id) > (anchor_time, anchor_cid)`
            # via the PostgREST `or=` filter.
            if anchor_time:
                query = query.or_(
                    f"created_at.gt.{anchor_time},"
                    f"and(created_at.eq.{anchor_time},"
                    f"commit_id.gt.{anchor_cid})"
                )

        if scope_path:
            query = query.eq("scope_path", _normalize(scope_path))
        if limit > 0:
            query = query.limit(limit)

        resp = query.execute()
        entries = _safe_data(resp) or []
        entries.reverse()
        for entry in entries:
            _parse_json_fields(entry)
        return entries

    def get_entry(self, commit_id: str) -> dict | None:
        if not commit_id:
            return None
        resp = (
            self._client.table(self.TABLE)
            .select("*")
            .eq("project_id", self._project_id)
            .eq("commit_id", commit_id)
            .limit(1)
            .execute()
        )
        rows = _safe_data(resp)
        entry = rows[0] if rows else None
        if entry:
            _parse_json_fields(entry)
        return entry


def _normalize(scope_path: str) -> str:
    """Canonical scope_path form: strip surrounding ``/``, map None → ``""``.

    Single source of truth for scope_path normalization on the
    application side. The database-level trigger in
    ``20260416100000_scope_path_canonical.sql`` enforces the same
    rule as a second layer of defense.
    """
    return scope_path.strip("/") if scope_path else ""


def _select_all(
    client,
    table: str,
    columns: str,
    *,
    project_id: str,
    page_size: int = 1000,
) -> list[dict]:
    return _select_all_query(
        lambda: client.table(table).select(columns).eq("project_id", project_id),
        page_size=page_size,
    )


def _select_all_query(query_factory, *, page_size: int = 1000) -> list[dict]:
    rows: list[dict] = []
    start = 0
    page_size = max(1, min(int(page_size), 1000))
    while True:
        query = query_factory()
        resp = query.range(start, start + page_size - 1).execute()
        batch = _safe_data(resp) or []
        rows.extend(batch)
        if len(batch) < page_size:
            return rows
        start += page_size


def _serialize_conflicts(conflicts: list | None) -> list:
    from dataclasses import asdict

    return [
        asdict(c) if hasattr(c, "__dataclass_fields__") else c
        for c in (conflicts or [])
    ]


def _decode_publish_result(data) -> tuple[bool, int | None]:
    """Decode publish_mut_scope_update's return value across RPC variants.

    The v1 RPC (pre-2026-05-16) returned a plain BOOLEAN. The v2 RPC
    returns ``TABLE(published BOOLEAN, txn_id BIGINT)`` so the engine can
    cross-link the audit row to the new ``version_transactions`` row.
    Supabase's REST layer surfaces these as ``bool`` and
    ``list[dict]`` respectively.
    """

    if isinstance(data, bool):
        return data, None
    if isinstance(data, dict):
        return bool(data.get("published")), data.get("txn_id")
    if isinstance(data, list) and data:
        first = data[0]
        if isinstance(first, dict):
            return bool(first.get("published")), first.get("txn_id")
        return bool(first), None
    return False, None


def _parse_json_fields(entry: dict) -> None:
    """Parse JSON string fields in a history entry and expose
    ``root`` as an alias of ``root_hash`` for mut handler compat."""
    if isinstance(entry.get("changes"), str):
        entry["changes"] = json.loads(entry["changes"])
    if isinstance(entry.get("conflicts"), str):
        entry["conflicts"] = json.loads(entry["conflicts"])
    entry["root"] = entry.get("root_hash", "")
    entry["time"] = entry.get("created_at", "")
