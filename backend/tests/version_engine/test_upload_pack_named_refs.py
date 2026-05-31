"""GAP-3 Phase 1c: upload-pack advertises/serves stored branch/tag refs.

Stored refs are written into the PER-REQUEST bare repo (never the shared
transport cache). These tests lock in the sanitisation (which keeps unsafe
or non-advertisable refs out of the repo), the ref-file writing, and the
behaviour-preserving lookup helper.
"""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from src.version_engine.adapters.git.object_quarantine import (
    _sanitize_named_refs,
    _write_named_refs,
)
import src.version_engine.adapters.git.upload_pack as up


_A = "a" * 40
_B = "b" * 40


# ── _sanitize_named_refs ────────────────────────────────────────────


def test_sanitize_keeps_branch_and_tag():
    out = _sanitize_named_refs({
        "refs/heads/feature/x": _A,
        "refs/tags/v1.2.3": _B,
    })
    assert out == {"refs/heads/feature/x": _A, "refs/tags/v1.2.3": _B}


def test_sanitize_drops_main_and_unknown_namespace():
    out = _sanitize_named_refs({
        "refs/heads/main": _A,
        "refs/notes/commits": _A,
        "HEAD": _A,
    })
    assert out == {}


def test_sanitize_drops_bad_oid():
    out = _sanitize_named_refs({"refs/heads/x": "nothex", "refs/heads/y": "0" * 40})
    assert out == {}  # non-hex and all-zero (ZERO_ID) both rejected


def test_sanitize_drops_path_traversal():
    out = _sanitize_named_refs({
        "refs/heads/../../etc/passwd": _A,
        "refs/tags/a//b": _A,
        "refs/heads/trailing/": _A,
    })
    assert out == {}


# ── _write_named_refs ───────────────────────────────────────────────


def test_write_named_refs_creates_files(tmp_path):
    bare = tmp_path / "repo.git"
    refs = {"refs/heads/feature/x": _A, "refs/tags/v1": _B}
    _write_named_refs(bare, refs)
    assert (bare / "refs" / "heads" / "feature" / "x").read_text().strip() == _A
    assert (bare / "refs" / "tags" / "v1").read_text().strip() == _B


# ── _scope_version_refs (upload_pack helper) ────────────────────────


def test_scope_version_refs_empty_without_project_id():
    repo = SimpleNamespace()  # no _project_id
    assert up._scope_version_refs(repo, "") == {}


def test_scope_version_refs_builds_map(monkeypatch):
    import src.version_engine.infrastructure.supabase.version_ref_repository as vrr

    class FakeStore:
        def list_refs(self, project_id, scope_path):
            assert project_id == "p1"
            return [
                {"ref_name": "refs/heads/feat", "commit_id": _A},
                {"ref_name": "refs/tags/v1", "commit_id": _B},
                {"ref_name": "", "commit_id": _A},          # skipped
            ]

    monkeypatch.setattr(vrr, "VersionRefStore", lambda *a, **k: FakeStore())
    repo = SimpleNamespace(_project_id="p1")
    out = up._scope_version_refs(repo, "docs")
    assert out == {"refs/heads/feat": _A, "refs/tags/v1": _B}


def test_scope_version_refs_swallows_errors(monkeypatch):
    import src.version_engine.infrastructure.supabase.version_ref_repository as vrr

    class BoomStore:
        def list_refs(self, *a, **k):
            raise RuntimeError("supabase down")

    monkeypatch.setattr(vrr, "VersionRefStore", lambda *a, **k: BoomStore())
    repo = SimpleNamespace(_project_id="p1")
    # transport must never break because refs lookup failed
    assert up._scope_version_refs(repo, "") == {}
