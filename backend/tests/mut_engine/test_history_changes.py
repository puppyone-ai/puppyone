from src.mut_engine.history_changes import normalize_history_change, normalize_history_changes


def test_normalize_history_change_from_mut_action():
    assert normalize_history_change({"path": "docs/a.md", "action": "add"}) == {
        "path": "docs/a.md",
        "action": "add",
        "op": "added",
    }
    assert normalize_history_change({"path": "docs/a.md", "action": "update"}) == {
        "path": "docs/a.md",
        "action": "update",
        "op": "modified",
    }
    assert normalize_history_change({"path": "docs/a.md", "action": "delete"}) == {
        "path": "docs/a.md",
        "action": "delete",
        "op": "deleted",
    }


def test_normalize_history_change_from_legacy_op():
    assert normalize_history_changes([
        {"path": "a.md", "op": "added"},
        {"path": "b.md", "op": "modified"},
        {"path": "c.md", "op": "deleted"},
    ]) == [
        {"path": "a.md", "action": "add", "op": "added"},
        {"path": "b.md", "action": "update", "op": "modified"},
        {"path": "c.md", "action": "delete", "op": "deleted"},
    ]


def test_normalize_history_change_unknown_defaults_to_modified():
    assert normalize_history_change({"path": "notes.md", "action": "touch"}) == {
        "path": "notes.md",
        "action": "update",
        "op": "modified",
    }
