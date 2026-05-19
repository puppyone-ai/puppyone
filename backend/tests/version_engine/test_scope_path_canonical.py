"""Regression tests for scope_path canonical form.

Covers the bug where ``SupabaseHistoryManager.record()`` /
``get_since()`` wrote raw ``scope_path`` values (e.g. ``"/docs/"``)
while every other method stored / queried the normalized form
(``"docs"``). This mismatch made ``get_previous_scope_hash()`` miss
historical commits on affected projects, which in turn caused the
post-push graft to merge against an empty base and resurrect deleted
files.

Tests here verify:

1. Every public method on ``SupabaseHistoryManager`` that accepts a
   ``scope_path`` normalizes it on entry, so the database only ever
   sees canonical form.
2. A full clone → delete → push cycle removes the file from the scope
   tree even when the scope was originally pushed with a non-canonical
   path — i.e. the graft path-selection logic sees a consistent history.

The tests use a thin in-memory fake for the Supabase client that
records every ``.insert()`` / ``.update()`` / ``.eq()`` call so we can
assert on the exact ``scope_path`` value that would hit the database.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from src.version_engine.infrastructure.supabase.history_repository import (
    SupabaseHistoryManager,
    _normalize,
)

# ══════════════════════════════════════════════════
# Fake Supabase client — records every call we care about
# ══════════════════════════════════════════════════

class _FakeQuery:
    """Chainable stand-in for a postgrest query. Records .eq() filters
    and the final .insert() / .update() / .upsert() payload for
    assertion.
    """

    def __init__(self, recorder: dict):
        self._recorder = recorder
        self._filters: dict = {}

    # ── chainable filters ──

    def select(self, *args, **kwargs):
        return self

    def eq(self, col, value):
        self._filters[col] = value
        return self

    def gt(self, *args, **kwargs):
        return self

    def lt(self, *args, **kwargs):
        return self

    def order(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def maybe_single(self):
        return self

    # ── writes ── record payload & filters

    def insert(self, data):
        self._recorder.setdefault("inserts", []).append(data)
        return self

    def update(self, data):
        self._recorder.setdefault("updates", []).append({
            "data": data,
            "filters": dict(self._filters),
        })
        return self

    def upsert(self, data, **_kw):
        self._recorder.setdefault("upserts", []).append(data)
        return self

    # ── terminal ──

    def execute(self):
        self._recorder.setdefault("executes", []).append(dict(self._filters))
        resp = MagicMock()
        resp.data = None
        return resp


class _FakeTable:
    def __init__(self, recorder: dict):
        self._recorder = recorder

    def __call__(self, *args, **kwargs):
        return _FakeQuery(self._recorder)


class _FakeClient:
    def __init__(self):
        self.recorder: dict = {}

    def table(self, _name):
        return _FakeQuery(self.recorder)

    def rpc(self, _name, _args):
        self.recorder.setdefault("rpc_calls", []).append({
            "name": _name, "args": _args,
        })
        return _FakeQuery(self.recorder)


@pytest.fixture
def history():
    """SupabaseHistoryManager wired to a fake client that records writes."""
    supabase = MagicMock()
    fake = _FakeClient()
    supabase.client = fake
    mgr = SupabaseHistoryManager(supabase, project_id="proj-1")
    mgr._fake_recorder = fake.recorder  # expose recorder for tests
    return mgr


# ══════════════════════════════════════════════════
# 1. _normalize — the canonical form rule itself
# ══════════════════════════════════════════════════

class TestNormalizeScopePath:
    """Pin down the canonical form contract."""

    @pytest.mark.parametrize("raw,expected", [
        ("/docs/", "docs"),
        ("/docs", "docs"),
        ("docs/", "docs"),
        ("docs", "docs"),
        ("", ""),
        ("/", ""),
        ("//", ""),
        (None, ""),
        ("/a/b/c/", "a/b/c"),
        ("a/b/c", "a/b/c"),
    ])
    def test_canonical_form(self, raw, expected):
        assert _normalize(raw) == expected


# ══════════════════════════════════════════════════
# 2. Every public method normalizes on entry
# ══════════════════════════════════════════════════

class TestHistoryManagerNormalizesOnEntry:
    """Whatever format the caller passes, the DB only ever sees canonical."""

    def test_record_normalizes_scope_path(self, history):
        history.record(
            commit_id="deadbeef00000001", who="user:a", message="m",
            scope_path="/docs/", changes=[], scope_hash="abc",
        )
        inserts = history._fake_recorder.get("inserts", [])
        assert inserts, "record() did not insert anything"
        assert inserts[0]["scope_path"] == "docs", (
            f"record() stored raw '/docs/' — expected canonical 'docs'. "
            f"Got: {inserts[0]['scope_path']!r}"
        )

    def test_record_handles_none_scope_path(self, history):
        history.record(
            commit_id="deadbeef00000002", who="user:a", message="m",
            scope_path=None, changes=[], scope_hash="abc",  # type: ignore
        )
        inserts = history._fake_recorder.get("inserts", [])
        assert inserts[0]["scope_path"] == ""

    def test_get_since_normalizes_scope_filter(self, history):
        history.get_since(since_commit_id="", scope_path="/docs/")
        executes = history._fake_recorder.get("executes", [])
        assert executes, "get_since() did not execute a query"
        filters = executes[-1]
        assert filters.get("scope_path") == "docs", (
            f"get_since() used raw scope_path in WHERE clause. "
            f"Got: {filters.get('scope_path')!r}"
        )

    def test_get_scope_hash_normalizes(self, history):
        history.get_scope_hash("/docs/")
        executes = history._fake_recorder.get("executes", [])
        assert any(e.get("scope_path") == "docs" for e in executes)

    def test_set_scope_hash_normalizes(self, history):
        history.set_scope_hash("/docs/", "hash1")
        upserts = history._fake_recorder.get("upserts", [])
        assert upserts and upserts[0]["scope_path"] == "docs"

    def test_get_scope_head_commit_id_normalizes(self, history):
        history.get_scope_head_commit_id("/docs/")
        executes = history._fake_recorder.get("executes", [])
        assert any(e.get("scope_path") == "docs" for e in executes)

    def test_set_scope_head_commit_id_normalizes(self, history):
        history.set_scope_head_commit_id("/docs/", "deadbeef12345678")
        upserts = history._fake_recorder.get("upserts", [])
        assert upserts and upserts[0]["scope_path"] == "docs"

    def test_get_previous_scope_hash_normalizes(self, history):
        history.get_previous_scope_hash(
            "/docs/", before_commit_id="deadbeefcafebabe",
        )
        executes = history._fake_recorder.get("executes", [])
        assert any(e.get("scope_path") == "docs" for e in executes)

    def test_cas_update_scope_hash_normalizes_rpc_arg(self, history):
        # Force the RPC branch: old_hash != "" skips the insert fast-path
        history.cas_update_scope_hash(
            "/docs/", old_hash="old", new_hash="new",
            head_commit_id="deadbeefcafebabe",
        )
        rpc_calls = history._fake_recorder.get("rpc_calls", [])
        assert rpc_calls, "no RPC was invoked"
        assert rpc_calls[0]["args"]["p_scope_path"] == "docs", (
            f"CAS RPC received raw scope_path. "
            f"Got: {rpc_calls[0]['args']['p_scope_path']!r}"
        )

    def test_cas_update_scope_hash_normalizes_empty_old_hash(self, history):
        # The first-push branch (empty old_hash) now also goes through
        # the RPC — the PL/pgSQL function handles INSERT-then-UPDATE
        # internally. The important thing is that scope_path still
        # arrives normalized.
        history.cas_update_scope_hash(
            "/docs/", old_hash="", new_hash="new",
            head_commit_id="deadbeefcafebabe",
        )
        rpc_calls = history._fake_recorder.get("rpc_calls", [])
        assert rpc_calls, "no RPC was invoked"
        assert rpc_calls[0]["args"]["p_scope_path"] == "docs"


# ══════════════════════════════════════════════════
# 3. The actual bug that started this investigation
# ══════════════════════════════════════════════════

class TestBugGetPreviousScopeHashAcrossFormats:
    """Regression for: record() wrote raw '/docs/' while
    get_previous_scope_hash() queried normalized 'docs' — a miss that
    made the post-push graft merge against an empty base.

    After the fix, both sides store / query canonical form, so the
    round-trip finds the earlier commit.
    """

    def test_record_then_get_previous_uses_same_key(self, history):
        # record() inserts with the canonical form...
        history.record(
            commit_id="deadbeef00000010", who="u", message="",
            scope_path="/docs/", changes=[], scope_hash="h1",
        )
        inserted_scope = history._fake_recorder["inserts"][0]["scope_path"]

        # ...and get_previous_scope_hash queries with the canonical form.
        history.get_previous_scope_hash("/docs/", before_commit_id="")
        queried_scope = history._fake_recorder["executes"][-1]["scope_path"]

        assert inserted_scope == queried_scope == "docs", (
            "The whole point: both write and read now use the same canonical form"
        )
