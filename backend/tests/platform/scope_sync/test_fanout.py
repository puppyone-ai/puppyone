"""Parent/child fanout (M4) — pure path-scoped projection tests."""

from __future__ import annotations

from src.platform.scope_sync.fanout import fanout_targets, to_abs

# project scopes: root, docs, docs/api, src
SCOPES = [("s-root", ""), ("s-docs", "docs"), ("s-api", "docs/api"), ("s-src", "src")]


def test_to_abs_translates_to_root_coordinates():
    assert to_abs("docs", {"a.md", "api/x.md"}) == {"docs/a.md", "docs/api/x.md"}
    assert to_abs("", {"a.md"}) == {"a.md"}        # root scope: already absolute


def test_sub_scope_change_reaches_root_and_ancestors_not_siblings():
    # publish to docs/ touching a.md → abs docs/a.md
    abs_paths = to_abs("docs", {"a.md"})
    targets = fanout_targets(abs_paths, SCOPES)
    assert targets["s-root"] == ["docs/a.md"]      # root sees absolute
    assert targets["s-docs"] == ["a.md"]           # the scope itself (co-users)
    assert "s-src" not in targets                  # disjoint sibling untouched
    assert "s-api" not in targets                  # docs/a.md not under docs/api


def test_change_in_deeper_scope_reaches_its_ancestors_translated():
    # publish to docs/api touching v1.md → abs docs/api/v1.md
    abs_paths = to_abs("docs/api", {"v1.md"})
    targets = fanout_targets(abs_paths, SCOPES)
    assert targets["s-root"] == ["docs/api/v1.md"]
    assert targets["s-docs"] == ["api/v1.md"]      # docs sees it under api/
    assert targets["s-api"] == ["v1.md"]
    assert "s-src" not in targets


def test_root_publish_reaches_only_scopes_whose_subtree_intersects():
    # root publish touching src/main.py + docs/x.md
    abs_paths = {"src/main.py", "docs/x.md"}
    targets = fanout_targets(abs_paths, SCOPES)
    assert targets["s-root"] == ["docs/x.md", "src/main.py"]
    assert targets["s-docs"] == ["x.md"]
    assert targets["s-src"] == ["main.py"]
    assert "s-api" not in targets                  # neither path under docs/api
