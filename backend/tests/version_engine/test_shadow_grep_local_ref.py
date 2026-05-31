"""GAP-11: `puppyone fs grep --ref local:<machine>/<branch>` greps a
teammate's un-pushed working tree via its shadow snapshot.

V1 runs over the snapshot's stored previews and is bounded by the access
point's scope (an AP scoped to docs/ never sees the rest of the tree).
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

import src.version_engine.entrypoints.http.access_point_fs as apfs
import src.version_engine.entrypoints.http.shadow_snapshot as ss
import src.infra.supabase.client as supa_client


class FakeQuery:
    def __init__(self, rows):
        self._rows = rows

    def select(self, *_a, **_k):
        return self

    def eq(self, *_a, **_k):
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    def execute(self):
        return SimpleNamespace(data=self._rows)


class FakeClient:
    def __init__(self, rows):
        self._rows = rows

    def table(self, _name):
        return FakeQuery(self._rows)


class FakeSupabase:
    def __init__(self, rows):
        self.client = FakeClient(rows)


DOC = {
    "manifest": [
        {"path": "docs/a.md", "blob_hash": "h1", "preview": "hello world\nsecond line"},
        {"path": "docs/sub/b.md", "blob_hash": "h2"},          # in scope, no preview
        {"path": "src/c.py", "blob_hash": "h3", "preview": "hello from src"},  # out of scope
    ],
    "previews": {
        "docs/a.md": "hello world\nsecond line",
        # b.md intentionally has no preview entry
        "src/c.py": "hello from src",
    },
}


@pytest.fixture
def patched(monkeypatch):
    rows = [{"id": "snap1", "machine_id": "alice-mbp", "ref_name": "main",
             "user_id": "u-alice", "updated_at": "2026-05-30T00:00:00+00:00"}]
    monkeypatch.setattr(supa_client, "SupabaseClient", lambda: FakeSupabase(rows))

    async def fake_get(_pid, _sid):
        return DOC

    monkeypatch.setattr(ss, "_get_manifest_from_s3", fake_get)


def _call(scope, pattern="hello", **over):
    kwargs = dict(
        project_id="p1",
        scope=scope,
        ref="local:alice-mbp/main",
        pattern=pattern,
        match_line=apfs._grep_matcher(pattern, regex=False, ignore_case=False),
        rel_path="",
        regex=False,
        ignore_case=False,
        invert_match=False,
        only_matching=False,
        include_patterns=[],
        exclude_patterns=[],
        exclude_dir_patterns=[],
        before_context=0,
        after_context=0,
        include_offsets=False,
        safe_limit=1000,
        per_file_limit=0,
    )
    kwargs.update(over)
    import asyncio
    return asyncio.run(apfs._grep_shadow_snapshot(**kwargs))


def test_local_ref_greps_previews_within_scope(patched):
    scope = {"path": "docs", "mode": "rw", "exclude": []}
    result = _call(scope)

    # docs/c.py is out of scope and must not appear; src never reachable
    paths = {m["path"] for m in result["matches"]}
    assert paths == {"a.md"}                    # scope-relative
    assert result["matches"][0]["preview_only"] is True
    # docs/sub/b.md is in scope but has no preview → reported, not silently dropped
    assert result["files_without_preview"] == 1
    assert result["snapshot_id"] == "snap1"
    assert result["target_type"] == "shadow_snapshot"


def test_local_ref_root_scope_sees_all(patched):
    scope = {"path": "", "mode": "rw", "exclude": []}
    result = _call(scope)
    paths = {m["path"] for m in result["matches"]}
    # both previewed files match "hello"; b.md has no preview
    assert paths == {"docs/a.md", "src/c.py"}
    assert result["files_without_preview"] == 1


def test_local_ref_missing_snapshot_404(monkeypatch):
    monkeypatch.setattr(supa_client, "SupabaseClient", lambda: FakeSupabase([]))

    async def fake_get(_pid, _sid):
        return {}

    monkeypatch.setattr(ss, "_get_manifest_from_s3", fake_get)
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as ei:
        _call({"path": "", "mode": "rw", "exclude": []})
    assert ei.value.status_code == 404
