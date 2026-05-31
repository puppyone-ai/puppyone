"""GAP-3 Phase 1b: receive-pack routes branch/tag pushes to version_refs.

A push to refs/heads/main still lands through the write engine; any other
refs/heads/* or refs/tags/* is stored as a named ref (objects promoted, no
scope-head advance). Other namespaces stay rejected.
"""
from __future__ import annotations

from types import SimpleNamespace

import src.version_engine.adapters.git.receive_pack as rp
import src.version_engine.infrastructure.supabase.version_ref_repository as vrr
from src.version_engine.adapters.git.receive_pack import _ref_writability, _named_ref_exclude_roots


_A = "a" * 40
_B = "b" * 40
_C = "c" * 40
_ZERO = "0" * 40


# ── _ref_writability ────────────────────────────────────────────────


def test_main_is_writable():
    ok, reason = _ref_writability("refs/heads/main")
    assert ok and reason == ""


def test_branch_is_writable():
    ok, _ = _ref_writability("refs/heads/feature/x")
    assert ok


def test_tag_is_writable():
    ok, _ = _ref_writability("refs/tags/v1.2.3")
    assert ok


def test_other_namespace_rejected():
    ok, reason = _ref_writability("refs/notes/commits")
    assert not ok
    assert "not writable" in reason


# ── _named_ref_exclude_roots (GAP-3 branch-off-main promote boundary) ──


def _cmd(ref, old=_ZERO, new=_A):
    return SimpleNamespace(ref=ref, old_id=old, new_id=new)


def _patch_view_and_refs(monkeypatch, head=None, ref_commits=()):
    monkeypatch.setattr(rp, "resolve_git_view_head",
                        lambda *a, **k: SimpleNamespace(head=head))

    class Store:
        def list_refs(self, *a, **k):
            return [{"commit_id": c} for c in ref_commits]
    monkeypatch.setattr(vrr, "VersionRefStore", lambda *a, **k: Store())


def test_main_push_exclude_unchanged_fast_forward(monkeypatch):
    # main with a non-zero old_id => exactly [old_id], no view/ref lookup
    _patch_view_and_refs(monkeypatch, head=_C)
    out = _named_ref_exclude_roots(None, "p", "", [], _cmd("refs/heads/main", old=_B))
    assert out == [_B]


def test_main_push_first_push_empty(monkeypatch):
    _patch_view_and_refs(monkeypatch, head=_C)
    out = _named_ref_exclude_roots(None, "p", "", [], _cmd("refs/heads/main", old=_ZERO))
    assert out == []


def test_branch_off_main_excludes_scope_head(monkeypatch):
    # new branch (old_id ZERO) descending from main head _B: must exclude _B
    _patch_view_and_refs(monkeypatch, head=_B)
    out = _named_ref_exclude_roots(None, "p", "", [], _cmd("refs/heads/feature/x", old=_ZERO))
    assert _B in out


def test_branch_excludes_existing_ref_tips(monkeypatch):
    _patch_view_and_refs(monkeypatch, head=_B, ref_commits=[_C])
    out = _named_ref_exclude_roots(None, "p", "", [], _cmd("refs/tags/v1", old=_ZERO))
    assert _B in out and _C in out


def test_exclude_roots_deduped(monkeypatch):
    # scope head == an existing ref tip => appears once
    _patch_view_and_refs(monkeypatch, head=_B, ref_commits=[_B])
    out = _named_ref_exclude_roots(None, "p", "", [], _cmd("refs/heads/x", old=_ZERO))
    assert out.count(_B) == 1


def test_branch_lookup_failure_degrades(monkeypatch):
    def boom(*a, **k): raise RuntimeError("view corrupt")
    monkeypatch.setattr(rp, "resolve_git_view_head", boom)
    monkeypatch.setattr(vrr, "VersionRefStore", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("db")))
    # must not raise — returns [] (best effort)
    out = _named_ref_exclude_roots(None, "p", "", [], _cmd("refs/heads/x", old=_ZERO))
    assert out == []


# ── _store_named_ref ────────────────────────────────────────────────


class FakeStore:
    last = None

    def set_ref(self, **kwargs):
        FakeStore.last = kwargs
        return FakeStore._result

    _result = True


def _fakes():
    promoted = {"count": 0}

    quarantine = SimpleNamespace(
        promote_reachable=lambda: promoted.__setitem__("count", promoted["count"] + 1)
    )
    official = SimpleNamespace(output=b"REPORT")
    command = SimpleNamespace(
        ref="refs/heads/feature/x",
        new_id=_A,
        capabilities={"report-status"},
    )
    return quarantine, official, command, promoted


def _patch(monkeypatch, *, store_result=True):
    FakeStore._result = store_result
    FakeStore.last = None
    monkeypatch.setattr(vrr, "VersionRefStore", lambda *a, **k: FakeStore())
    monkeypatch.setattr(rp, "receive_pack_result", lambda *a, **kw: ("RESULT", kw))
    monkeypatch.setattr(rp, "_official_receive_pack_response", lambda out: ("OFFICIAL", out))


def test_store_named_ref_promotes_and_records(monkeypatch):
    _patch(monkeypatch, store_result=True)
    quarantine, official, command, promoted = _fakes()

    result = rp._store_named_ref(
        quarantine=quarantine,
        official=official,
        official_ref_updated=True,
        project_id="p1",
        scope_path="docs",
        actor="alice",
        command=command,
    )

    # objects promoted so the ref is fetchable
    assert promoted["count"] == 1
    # ref recorded with the pushed commit, scoped, attributed
    assert FakeStore.last == {
        "project_id": "p1",
        "scope_path": "docs",
        "ref_name": "refs/heads/feature/x",
        "commit_id": _A,
        "created_by": "alice",
    }
    # git's own report-status is returned (official ref was updated)
    assert result == ("OFFICIAL", b"REPORT")


def test_store_named_ref_synthetic_committed_when_no_official_output(monkeypatch):
    _patch(monkeypatch, store_result=True)
    quarantine, official, command, _ = _fakes()
    official.output = b""  # git produced no report-status

    result = rp._store_named_ref(
        quarantine=quarantine,
        official=official,
        official_ref_updated=False,
        project_id="p1",
        scope_path="",
        actor="bob",
        command=command,
    )
    tag, kw = result
    assert tag == "RESULT"
    assert kw["outcome"] == "committed"


def test_store_named_ref_rejected_when_store_fails(monkeypatch):
    _patch(monkeypatch, store_result=False)
    quarantine, official, command, promoted = _fakes()

    result = rp._store_named_ref(
        quarantine=quarantine,
        official=official,
        official_ref_updated=True,
        project_id="p1",
        scope_path="docs",
        actor="alice",
        command=command,
    )
    tag, kw = result
    assert tag == "RESULT"
    assert kw["outcome"] == "rejected"
    # objects were still promoted before the store attempt
    assert promoted["count"] == 1
