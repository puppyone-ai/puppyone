"""Unit tests for the PUP-3 folder-upload policy.

Covers the pure policy module
(``src.ingest.policy.upload_policy``); end-to-end HTTP rejection from
``/upload/init`` and ``/ap-fs/upload`` lives in the router test files
(``test_upload_init_policy.py``) which exercise the wiring.
"""

from __future__ import annotations

import pytest

from src.ingest.policy.upload_policy import (
    DEFAULT_BLOCKLIST_SEGMENTS,
    PER_BATCH_MAX_BYTES,
    PER_BATCH_MAX_FILES,
    PER_FILE_MAX_BYTES,
    PolicyOptions,
    evaluate_file,
    is_blocked_segment,
    is_dotfile_path,
    matches_ignore_rules,
    parse_ignore_text,
    path_has_blocked_segment,
)


class TestBlocklist:
    def test_canonical_blocked_segments(self) -> None:
        for name in [".git", "node_modules", ".DS_Store", "__pycache__", "dist", "build", ".venv"]:
            assert is_blocked_segment(name), name

    def test_non_blocked_lookalikes(self) -> None:
        for name in [".gitignore", ".gitkeep", "git", "nodemodules", "build.gradle"]:
            assert not is_blocked_segment(name), name

    def test_path_walk_finds_first_blocked_segment(self) -> None:
        assert path_has_blocked_segment("repo/.git/config") == (True, ".git")
        assert path_has_blocked_segment("foo/node_modules/lodash/index.js") == (True, "node_modules")

    def test_path_walk_ignores_substring_matches(self) -> None:
        assert path_has_blocked_segment("my.gitignore") == (False, None)
        assert path_has_blocked_segment("src/foo.py") == (False, None)

    def test_empty_segments_skipped(self) -> None:
        # Double slash is normalized away — empty segment doesn't match.
        assert path_has_blocked_segment("foo//bar") == (False, None)


class TestDotfile:
    def test_any_segment_starting_with_dot(self) -> None:
        assert is_dotfile_path(".env")
        assert is_dotfile_path("foo/.bashrc")
        assert is_dotfile_path("./local/.config")
        assert not is_dotfile_path("src/foo.py")


class TestIgnoreParser:
    def test_skips_comments_and_blanks(self) -> None:
        rules = parse_ignore_text("# comment\n\n  \nfoo\n")
        assert len(rules) == 1
        assert rules[0].pattern == "foo"

    def test_negation(self) -> None:
        rules = parse_ignore_text("*.log\n!important.log\n")
        assert rules[0].negate is False
        assert rules[1].negate is True

    def test_dir_only(self) -> None:
        rules = parse_ignore_text("dist/\nbuild\n")
        assert rules[0].dir_only is True
        assert rules[1].dir_only is False

    def test_match_ignored(self) -> None:
        rules = parse_ignore_text("*.log\n")
        assert matches_ignore_rules("app.log", rules)
        assert not matches_ignore_rules("app.py", rules)

    def test_negation_reincludes(self) -> None:
        rules = parse_ignore_text("*.log\n!important.log\n")
        assert matches_ignore_rules("app.log", rules)
        assert not matches_ignore_rules("important.log", rules)

    def test_directory_rule_matches_children(self) -> None:
        rules = parse_ignore_text("dist/\n")
        assert matches_ignore_rules("dist/index.js", rules)
        # Plain file at root named ``dist`` is not a directory match.
        assert not matches_ignore_rules("dist", rules, is_dir=False)


class TestEvaluateFile:
    def test_default_options_block_blocklist(self) -> None:
        d = evaluate_file("repo/.git/config", 100, [], PolicyOptions())
        assert not d.accept
        assert d.reason == "blocklist:.git"

    def test_default_options_block_hidden(self) -> None:
        d = evaluate_file(".env", 100, [], PolicyOptions())
        assert not d.accept
        assert d.reason == "hidden"

    def test_default_options_accept_normal_file(self) -> None:
        d = evaluate_file("src/foo.py", 100, [], PolicyOptions())
        assert d.accept

    def test_per_file_size_cap(self) -> None:
        d = evaluate_file("src/big.bin", PER_FILE_MAX_BYTES + 1, [], PolicyOptions())
        assert not d.accept
        assert d.reason == "too_large"

    def test_include_blocklist_override(self) -> None:
        d = evaluate_file(
            "repo/.git/config", 100, [],
            PolicyOptions(include_blocklist=True),
        )
        # Blocklist allowed, but ``.git`` segments are also dotfiles —
        # so the dotfile rule blocks it next. User must opt-in to both.
        assert not d.accept
        assert d.reason == "hidden"

    def test_include_blocklist_and_hidden_overrides(self) -> None:
        d = evaluate_file(
            "repo/.git/config", 100, [],
            PolicyOptions(include_blocklist=True, include_hidden=True),
        )
        assert d.accept

    def test_gitignore_layer(self) -> None:
        rules = parse_ignore_text("*.log\n")
        d = evaluate_file("foo.log", 100, rules, PolicyOptions())
        assert not d.accept
        assert d.reason == "gitignore"

    def test_include_ignored_override(self) -> None:
        rules = parse_ignore_text("*.log\n")
        d = evaluate_file(
            "foo.log", 100, rules,
            PolicyOptions(include_ignored=True),
        )
        assert d.accept

    def test_stage_priority_blocklist_before_gitignore_before_hidden(self) -> None:
        """When multiple stages would reject, the first reject wins
        and reports a specific reason."""
        # .git is both blocklisted and a dotfile; blocklist wins.
        d = evaluate_file(".git/HEAD", 100, [], PolicyOptions())
        assert d.reason == "blocklist:.git"


class TestThresholds:
    def test_constants_match_product_doc(self) -> None:
        # If you change these, also update:
        #   - frontend/lib/uploadPolicy.ts
        #   - cli/src/commands/fs/lib/upload-policy.js
        #   - docs/proposals/PUP-3-folder-upload-policy.md (§2.5)
        assert PER_FILE_MAX_BYTES == 50 * 1024 * 1024
        assert PER_BATCH_MAX_FILES == 5000
        assert PER_BATCH_MAX_BYTES == 1024 * 1024 * 1024


class TestParity:
    """Catches drift between the backend module and the documented
    blocklist. The full cross-language parity check (TS / JS mirrors)
    runs in CI as a string comparison."""

    def test_blocklist_includes_required_minimum(self) -> None:
        required = {
            ".git", ".svn", ".hg",
            ".DS_Store", "Thumbs.db",
            "node_modules", "__pycache__", ".venv",
            ".next", "dist", "build",
        }
        missing = required - DEFAULT_BLOCKLIST_SEGMENTS
        assert not missing, f"blocklist missing required segments: {missing}"


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
