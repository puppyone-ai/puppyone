#!/usr/bin/env python3
"""Editor internal layering and vocabulary guard (TA-10, TA-30, TA-41, TA-42, TA-60, TA-80).

Enforces Rules R1-R10 across `src/` (excluding `#[cfg(test)]` modules, `tests.rs`,
`*_tests.rs`, `tests/` directories and `bench.rs`) against the shrink-only
baseline in `tools/editor-architecture-baseline.json`:
  - Any new violation not in the baseline fails.
  - Any stale baseline entry that no longer violates fails (run `--prune`).

Usage:
  python3 tools/check-editor-architecture.py
  python3 tools/check-editor-architecture.py --prune
  python3 tools/check-editor-architecture.py --self-test
"""
import argparse
import json
from pathlib import Path
import re
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parent))
import rust_paths  # noqa: E402

BASELINE_REL = "tools/editor-architecture-baseline.json"

# R3: format-specific actions and EditIntent variants forbidden in generic `src/editor/view/`.
FORBIDDEN_VIEW_ACTIONS = {
    "ToggleBold",
    "ToggleItalic",
    "ToggleStrike",
    "ToggleCode",
    "ToggleUnderline",
    "InsertLink",
    "Heading0",
    "Heading1",
    "Heading2",
    "Heading3",
    "Heading4",
    "Heading5",
    "Heading6",
    "ToggleBulletList",
    "ToggleOrderedList",
    "ToggleTaskList",
    "ToggleQuote",
}

FORBIDDEN_EDIT_INTENTS = {
    "Bold",
    "Italic",
    "Strike",
    "Code",
    "Underline",
    "Link",
    "Heading",
    "BulletList",
    "OrderedList",
    "TaskList",
    "Quote",
    "BlockUp",
    "BlockDown",
}

# R8: explicit core port prefixes an optional Markdown add-on (`markdown/addons/<name>/`)
# is permitted to import (Rust counterpart of `addonCorePorts` in
# `scripts/check-markdown-architecture.mjs`).
ADDON_CORE_PORTS = (
    ("commands", "block_move"),
    ("localization",),
    ("syntax", "block_boundaries"),
)

MARKDOWN_INTERNAL_SUBMODULES = {
    "core",
    "features",
    "composition",
    "shared",
    "style",
    "platform",
    "addons",
    "navigation",
}


class Violation:
    __slots__ = ("rule", "key", "message")

    def __init__(self, rule: str, key: str, message: str):
        self.rule = rule
        self.key = key
        self.message = message


def strip_all_test_mods(source: str) -> str:
    """Strip comments/strings via `rust_paths.strip`, plus `#[cfg(all(test, ...))] mod`."""
    cleaned = rust_paths.strip(source)
    out, i = [], 0
    pattern = re.compile(
        r"#\[cfg\([^\]]*\btest\b[^\]]*\)\]\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+\w+\s*([{;])"
    )
    while True:
        m = pattern.search(cleaned, i)
        if not m:
            out.append(cleaned[i:])
            break
        out.append(cleaned[i : m.start()])
        if m.group(1) == ";":
            i = m.end()
            continue
        i = rust_paths.matching(cleaned, m.end() - 1)
    return "".join(out)


def test_only_Declarations(root: Path) -> set[Path]:
    """Files mounted only behind `#[cfg(...test...)] mod <name>;`."""
    skipped: set[Path] = set()
    cfg_mod = re.compile(
        r"#\[cfg\([^\]]*\btest\b[^\]]*\)\]\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;"
    )
    for mod_file in (root / "src").rglob("*.rs"):
        text = mod_file.read_text(encoding="utf-8")
        parent = mod_file.parent if mod_file.name in ("mod.rs", "main.rs") else mod_file.with_suffix("")
        for name in cfg_mod.findall(text):
            for candidate in (parent / f"{name}.rs", parent / name / "mod.rs"):
                if candidate.exists():
                    skipped.add(candidate)
    return skipped


def is_ignored_file(path: Path, cfg_test_files: set[Path]) -> bool:
    if path in cfg_test_files:
        return True
    if path.name in ("tests.rs", "bench.rs") or path.name.endswith("_tests.rs"):
        return True
    if "tests" in path.parts:
        return True
    return False


def expand_use_tree(tree: str) -> list[tuple[list[str], str | None]]:
    """Expand a `use` tree into `(path_segments, alias_or_local_name)` pairs."""
    compact = re.sub(r"\s+", " ", tree).strip()
    return _expand_node("", compact)


def _expand_node(prefix: str, node: str) -> list[tuple[list[str], str | None]]:
    node = node.strip()
    if not node:
        return []
    brace = node.find("{")
    if brace < 0:
        if " as " in node:
            raw_path, alias = node.split(" as ", 1)
            raw_path, alias = raw_path.strip(), alias.strip()
        else:
            raw_path, alias = node, None
        full = (prefix + raw_path) if raw_path != "self" else prefix.rstrip(":")
        segs = [s for s in full.split("::") if s]
        if not segs:
            return []
        local = alias if (alias and alias != "_") else (None if segs[-1] == "*" else segs[-1])
        return [(segs, local)]

    close = node.rfind("}")
    head = prefix + node[:brace].strip()
    inner = node[brace + 1 : close]
    parts, depth, start = [], 0, 0
    for idx, ch in enumerate(inner):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
        elif ch == "," and depth == 0:
            parts.append(inner[start:idx])
            start = idx + 1
    parts.append(inner[start:])
    out: list[tuple[list[str], str | None]] = []
    for part in parts:
        if part.strip():
            out.extend(_expand_node(head, part))
    return out


def resolve_crate_segments(
    segments: list[str],
    here: list[str],
    child_mods: set[str],
) -> list[str] | None:
    if not segments:
        return None
    first = segments[0]
    if first in ("crate", "po_editor"):
        return ["crate", *segments[1:]]
    if first == "self":
        return [*here, *segments[1:]]
    if first == "super":
        base = list(here)
        rest = list(segments)
        while rest and rest[0] == "super":
            if len(base) > 1:
                base.pop()
            rest.pop(0)
        return [*base, *rest]
    if first in child_mods:
        return [*here, *segments]
    return None


def collect_file_references(root: Path, path: Path, cleaned: str) -> tuple[list[list[str]], bool]:
    """Return `(resolved_crate_paths, references_gpui)` for a single source file."""
    here = rust_paths.module_path(root, path)
    child_mods = set(
        re.findall(r"^\s*(?:#\[[^\]]*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*[;{]", cleaned, re.M)
    )
    resolved: list[list[str]] = []
    aliases: dict[str, list[str]] = {}
    uses_gpui = bool(re.search(r"\bextern\s+crate\s+gpui(?:_kit)?\b", cleaned))

    for m in re.finditer(r"\buse\s+([^;]+);", cleaned):
        for segs, local in expand_use_tree(m.group(1)):
            s0 = segs[0] if segs else ""
            if s0 in ("gpui", "gpui_kit"):
                uses_gpui = True
                continue
            target = resolve_crate_segments(segs, here, child_mods)
            if target is None and s0 in aliases:
                target = [*aliases[s0], *segs[1:]]
            if target is not None:
                resolved.append(target)
                if local and local not in child_mods:
                    aliases[local] = target

    non_use = re.sub(r"\buse\s+[^;]+;", " ", cleaned)
    if re.search(r"\bgpui(?:_kit)?\s*::", non_use):
        uses_gpui = True

    for m in re.finditer(r"(?<!::)\b([A-Za-z_]\w*(?:\s*::\s*[A-Za-z_]\w*)+)", non_use):
        segs = [s.strip() for s in m.group(1).split("::") if s.strip()]
        if not segs:
            continue
        if segs[0] in ("gpui", "gpui_kit"):
            uses_gpui = True
            continue
        target = resolve_crate_segments(segs, here, child_mods)
        if target is None and segs[0] in aliases:
            target = [*aliases[segs[0]], *segs[1:]]
        if target is not None:
            resolved.append(target)

    return resolved, uses_gpui


def check_r3_view_vocabulary(rel: str, cleaned: str) -> list[Violation]:
    """R3: inspect `actions!(...)` and `enum EditIntent { ... }` in `src/editor/view/`."""
    found: list[Violation] = []
    seen: set[str] = set()

    for m in re.finditer(r"\bactions!\s*\(", cleaned):
        end = rust_paths.matching(cleaned, m.end() - 1)
        body = cleaned[m.end() : end - 1]
        # Strip optional namespace before comma if `actions!(namespace, [ ... ])`.
        bracket = body.find("[")
        scan = body[bracket + 1 : body.rfind("]")] if bracket >= 0 else body
        for ident in re.findall(r"\b([A-Za-z_]\w*)\b", scan):
            if ident in FORBIDDEN_VIEW_ACTIONS:
                key = f"view-vocabulary {rel} {ident}"
                if key not in seen:
                    seen.add(key)
                    found.append(
                        Violation(
                            "R3",
                            key,
                            f"[R3] {rel}: generic view `actions!` defines format action `{ident}`",
                        )
                    )

    for m in re.finditer(r"\benum\s+EditIntent\s*\{", cleaned):
        end = rust_paths.matching(cleaned, m.end() - 1)
        body = cleaned[m.end() : end - 1]
        # Drop tuple/struct payloads `( ... )` and `{ ... }` inside the enum body so only variant names remain.
        stripped_variants = []
        i = 0
        while i < len(body):
            if body[i] in "({":
                i = rust_paths.matching(body, i)
                continue
            stripped_variants.append(body[i])
            i += 1
        variants_src = re.sub(r"#\[[^\]]*\]", " ", "".join(stripped_variants))
        for raw in variants_src.split(","):
            name_match = re.match(r"^\s*([A-Za-z_]\w*)", raw)
            if not name_match:
                continue
            ident = name_match.group(1)
            if ident in FORBIDDEN_EDIT_INTENTS:
                key = f"view-vocabulary {rel} EditIntent::{ident}"
                if key not in seen:
                    seen.add(key)
                    found.append(
                        Violation(
                            "R3",
                            key,
                            f"[R3] {rel}: generic view `EditIntent` defines format variant `{ident}`",
                        )
                    )

    return found


def addon_submodules(root: Path, addon: str) -> set[str]:
    """Private/nested submodule files or folders inside `src/editor/markdown/addons/<addon>/`."""
    addon_dir = root / "src/editor/markdown/addons" / addon
    if not addon_dir.is_dir():
        return set()
    subs: set[str] = set()
    for entry in addon_dir.iterdir():
        if entry.is_dir():
            subs.add(entry.name)
        elif entry.suffix == ".rs" and entry.stem != "mod":
            subs.add(entry.stem)
    return subs


def markdown_root_submodules(root: Path) -> set[str]:
    md_mod = root / "src/editor/markdown/mod.rs"
    extra: set[str] = set()
    if md_mod.exists():
        cleaned = strip_all_test_mods(md_mod.read_text(encoding="utf-8"))
        extra.update(
            re.findall(
                r"^\s*(?:#\[[^\]]*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*[;{]",
                cleaned,
                re.M,
            )
        )
    return MARKDOWN_INTERNAL_SUBMODULES | extra


def scan_repository(root: Path) -> list[Violation]:
    src_dir = root / "src"
    if not src_dir.is_dir():
        return []

    cfg_test_files = test_only_Declarations(root)
    md_internals = markdown_root_submodules(root)
    violations: list[Violation] = []
    seen_keys: set[str] = set()

    def record(rule: str, key: str, message: str) -> None:
        if key not in seen_keys:
            seen_keys.add(key)
            violations.append(Violation(rule, key, message))

    for path in sorted(src_dir.rglob("*.rs")):
        if is_ignored_file(path, cfg_test_files):
            continue
        rel = path.relative_to(root).as_posix()
        cleaned = strip_all_test_mods(path.read_text(encoding="utf-8"))
        refs, uses_gpui = collect_file_references(root, path, cleaned)

        in_text = rel.startswith("src/editor/text/")
        in_view = rel.startswith("src/editor/view/")
        in_markdown = rel.startswith("src/editor/markdown/")
        in_md_core = rel.startswith("src/editor/markdown/core/")
        in_md_decorations = rel.startswith("src/editor/markdown/core/decorations/")
        in_md_features = rel.startswith("src/editor/markdown/features/")
        in_md_shared = rel.startswith("src/editor/markdown/shared/")
        in_md_platform = rel.startswith("src/editor/markdown/platform/")
        in_md_addons = rel.startswith("src/editor/markdown/addons/")

        own_feature = None
        if in_md_features:
            rest = Path(rel).relative_to("src/editor/markdown/features").parts
            own_feature = Path(rest[0]).stem if rest else None

        own_addon = None
        if in_md_addons:
            rest = Path(rel).relative_to("src/editor/markdown/addons").parts
            own_addon = Path(rest[0]).stem if rest else None

        # R3: generic view vocabulary
        if in_view:
            for v in check_r3_view_vocabulary(rel, cleaned):
                record(v.rule, v.key, v.message)

        # R10: `src/editor/text/` and `markdown/core/` (outside `decorations/`) must not reference `gpui`.
        if (in_text or (in_md_core and not in_md_decorations)) and uses_gpui:
            key = f"pure-gpui {rel} -> gpui"
            record("R10", key, f"[R10] {rel}: pure text/markdown-core module references `gpui`")

        for segs in refs:
            if len(segs) < 3 or segs[0] != "crate" or segs[1] != "editor":
                continue
            area = segs[2]

            # R1: `src/editor/text/` -> no `editor::{view, markdown, csv, code}`
            if in_text and area in ("view", "markdown", "csv", "code"):
                key = f"text-import {rel} -> editor/{area}"
                record("R1", key, f"[R1] {rel}: text kernel imports `editor::{area}`")

            # R2: `src/editor/view/` -> no `editor::{markdown, csv, code}`
            if in_view and area in ("markdown", "csv", "code"):
                key = f"view-import {rel} -> editor/{area}"
                record("R2", key, f"[R2] {rel}: generic view imports format `editor::{area}`")

            if area != "markdown":
                continue

            md_sub = segs[3] if len(segs) >= 4 else None

            # R9: outside `src/editor/markdown/`, only root `editor::markdown` exports may be used.
            if not in_markdown and md_sub in md_internals:
                detail = (
                    f"markdown/{md_sub}/{segs[4]}"
                    if len(segs) >= 5 and md_sub in ("core", "features", "addons")
                    else f"markdown/{md_sub}"
                )
                key = f"markdown-internal {rel} -> {detail}"
                record(
                    "R9",
                    key,
                    f"[R9] {rel}: external module reaches into `editor::markdown::{md_sub}`; use `editor::markdown` root exports",
                )

            # R8 (host install): outside `markdown/addons/`, only `src/editor/markdown/mod.rs`
            # may reference `markdown::addons`, and only through each add-on's root module.
            if not in_md_addons and md_sub == "addons":
                addon_name = segs[4] if len(segs) >= 5 else "*"
                sub_name = segs[5] if len(segs) >= 6 else None
                if rel != "src/editor/markdown/mod.rs":
                    key = f"addon-boundary {rel} -> addons/{addon_name}"
                    record(
                        "R8",
                        key,
                        f"[R8] {rel}: only `src/editor/markdown/mod.rs` may install `markdown::addons::{addon_name}`",
                    )
                elif addon_name != "*" and sub_name and sub_name in addon_submodules(root, addon_name):
                    key = f"addon-boundary {rel} -> addons/{addon_name}/{sub_name}"
                    record(
                        "R8",
                        key,
                        f"[R8] {rel}: host reaches into `addons::{addon_name}::{sub_name}`; install through the add-on root module",
                    )

            # R4: `markdown/core/` -> no `features` or `composition`
            if in_md_core and md_sub in ("features", "composition"):
                target = (
                    f"features/{segs[4]}"
                    if md_sub == "features" and len(segs) >= 5
                    else md_sub
                )
                key = f"core-import {rel} -> {target}"
                record("R4", key, f"[R4] {rel}: markdown core imports `{target}`")

            # R5: `markdown/features/<a>/` -> no `features/<b>` (`b != a`) and no `composition`
            if in_md_features:
                if md_sub == "composition":
                    key = f"feature-import {rel} -> composition"
                    record("R5", key, f"[R5] {rel}: feature `{own_feature}` imports `composition`")
                elif md_sub == "features" and len(segs) >= 5 and segs[4] != own_feature:
                    target = f"features/{segs[4]}"
                    key = f"feature-import {rel} -> {target}"
                    record(
                        "R5",
                        key,
                        f"[R5] {rel}: feature `{own_feature}` imports sibling `{target}`",
                    )

            # R6: `markdown/shared/` -> no `markdown/{core, features, composition, platform, addons}`
            if in_md_shared and md_sub in ("core", "features", "composition", "platform", "addons"):
                target = (
                    f"features/{segs[4]}"
                    if md_sub == "features" and len(segs) >= 5
                    else md_sub
                )
                key = f"shared-import {rel} -> {target}"
                record("R6", key, f"[R6] {rel}: `markdown/shared/` imports `{target}`")

            # R7: `markdown/platform/` -> no `markdown/{features, composition}`
            if in_md_platform and md_sub in ("features", "composition"):
                target = (
                    f"features/{segs[4]}"
                    if md_sub == "features" and len(segs) >= 5
                    else md_sub
                )
                key = f"platform-import {rel} -> {target}"
                record("R7", key, f"[R7] {rel}: `markdown/platform/` imports `{target}`")

            # R8 (inside `markdown/addons/<a>/`):
            if in_md_addons:
                if md_sub in ("features", "composition", "platform", "shared"):
                    target = (
                        f"features/{segs[4]}"
                        if md_sub == "features" and len(segs) >= 5
                        else md_sub
                    )
                    key = f"addon-boundary {rel} -> {target}"
                    record("R8", key, f"[R8] {rel}: add-on `{own_addon}` imports `{target}`")
                elif md_sub == "addons" and len(segs) >= 5 and segs[4] != own_addon:
                    target = f"addons/{segs[4]}"
                    key = f"addon-boundary {rel} -> {target}"
                    record(
                        "R8",
                        key,
                        f"[R8] {rel}: add-on `{own_addon}` imports sibling `{target}`",
                    )
                elif md_sub == "core":
                    tail = tuple(segs[4:])
                    allowed = bool(tail) and any(
                        tail[: len(port)] == port for port in ADDON_CORE_PORTS
                    )
                    if not allowed:
                        sub_desc = "/".join(segs[4:6]) if len(segs) >= 5 else "root"
                        key = f"addon-boundary {rel} -> core/{sub_desc}"
                        record(
                            "R8",
                            key,
                            f"[R8] {rel}: add-on `{own_addon}` accesses unlisted core module `core::{sub_desc.replace('/', '::')}`",
                        )

    return violations


def run_self_tests() -> None:
    """Prove every rule R1-R10 catches a constructed violation and spares valid code."""
    cases = [
        (
            "R1",
            {
                "src/editor/text/bad.rs": "use crate::editor::view::EditorView;\n",
                "src/editor/text/bad_fmt.rs": "fn f() { let _ = crate::editor::csv::Model; }\n",
            },
            {"R1"},
        ),
        (
            "R2",
            {
                "src/editor/view/bad.rs": "use super::super::markdown::MarkdownExtension;\n",
            },
            {"R2"},
        ),
        (
            "R3",
            {
                # Font style words outside `actions!` / `EditIntent` must NOT trigger R3.
                "src/editor/view/style.rs": "pub struct S { pub Italic: bool, pub Underline: bool }\n",
                "src/editor/view/mod.rs": "actions!(puppy_editor, [MoveLeft, ToggleBold]);\n",
                "src/editor/view/extension.rs": "pub enum EditIntent { Enter, Heading(u8), Quote }\n",
            },
            {"R3"},
        ),
        (
            "R4",
            {
                "src/editor/markdown/core/plans.rs": "use crate::editor::markdown::features::math::tex;\n",
            },
            {"R4"},
        ),
        (
            "R5",
            {
                "src/editor/markdown/features/callout/mod.rs": "use super::table::TableFeature;\n",
                "src/editor/markdown/features/callout/widget.rs": "use super::super::composition::FEATURES;\n",
            },
            {"R5"},
        ),
        (
            "R6",
            {
                "src/editor/markdown/shared/helper.rs": "use crate::editor::markdown::core::plans::Plan;\n",
            },
            {"R6"},
        ),
        (
            "R7",
            {
                "src/editor/markdown/platform/broker.rs": "use crate::editor::markdown::features::image::cache;\n",
            },
            {"R7"},
        ),
        (
            "R8-inside-addon",
            {
                "src/editor/markdown/addons/block_drag/mod.rs": (
                    "use crate::editor::markdown::core::commands::block_move;\n"
                    "use crate::editor::markdown::core::plans::Plan;\n"
                ),
            },
            {"R8"},
        ),
        (
            "R8-cross-addon-and-host",
            {
                "src/editor/markdown/mod.rs": (
                    "pub mod addons;\n"
                    "use self::addons::block_drag::internal::State;\n"
                ),
                "src/editor/markdown/addons/block_drag/mod.rs": "pub mod internal;\n",
                "src/editor/markdown/addons/block_drag/internal.rs": "pub struct State;\n",
                "src/editor/markdown/addons/other/mod.rs": "use super::block_drag::State;\n",
            },
            {"R8"},
        ),
        (
            "R9",
            {
                "src/editor/markdown/mod.rs": "pub mod core;\npub struct MarkdownExtension;\n",
                "src/app/caller.rs": (
                    "use crate::editor::markdown::MarkdownExtension;\n"
                    "use crate::editor::markdown::core::links::find_links;\n"
                ),
            },
            {"R9"},
        ),
        (
            "R10",
            {
                # `decorations/` may reference `gpui`; `core/plans.rs` and `text/` may not.
                "src/editor/markdown/core/decorations/mod.rs": "use gpui::*;\n",
                "src/editor/markdown/core/plans.rs": "use gpui::px;\n",
                "src/editor/text/rope.rs": "fn f() { let _ = gpui::px(1.0); }\n",
            },
            {"R10"},
        ),
    ]

    for label, files, expected_rules in cases:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_root = Path(tmp)
            for rel_path, content in files.items():
                full = tmp_root / rel_path
                full.parent.mkdir(parents=True, exist_ok=True)
                full.write_text(content, encoding="utf-8")
            found = scan_repository(tmp_root)
            got_rules = {v.rule for v in found}
            if got_rules != expected_rules:
                raise AssertionError(
                    f"Self-test {label} expected rules {expected_rules}, got {got_rules}: "
                    f"{[v.key for v in found]}"
                )
            # Ensure R3 did not flag `src/editor/view/style.rs` and R10 did not flag `decorations/mod.rs`.
            if label == "R3" and any("style.rs" in v.key for v in found):
                raise AssertionError(f"Self-test R3 falsely flagged font style file: {[v.key for v in found]}")
            if label == "R10":
                flagged_files = {v.key.split()[1] for v in found}
                if flagged_files != {"src/editor/markdown/core/plans.rs", "src/editor/text/rope.rs"}:
                    raise AssertionError(f"Self-test R10 unexpected files: {flagged_files}")

    # Also verify shrink-only baseline comparison (added fails, stale fails, prune shrinks).
    sample_v = Violation("R4", "core-import a.rs -> features/math", "[R4] a.rs")
    other_v = Violation("R5", "feature-import b.rs -> features/image", "[R5] b.rs")
    added, stale = diff_baseline(["core-import a.rs -> features/math"], [sample_v, other_v])
    assert [v.key for v in added] == ["feature-import b.rs -> features/image"] and not stale
    added, stale = diff_baseline(
        ["core-import a.rs -> features/math", "feature-import b.rs -> features/image"],
        [sample_v],
    )
    assert not added and stale == ["feature-import b.rs -> features/image"]

    print(f"Editor architecture self-tests passed ({len(cases)} scenarios covering R1-R10 + shrink-only baseline).")


def diff_baseline(
    baseline_keys: list[str],
    violations: list[Violation],
) -> tuple[list[Violation], list[str]]:
    by_key = {v.key: v for v in violations}
    current_keys = sorted(by_key)
    baseline_set = set(baseline_keys)
    current_set = set(current_keys)
    added = [by_key[k] for k in current_keys if k not in baseline_set]
    stale = [k for k in baseline_keys if k not in current_set]
    return added, stale


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prune", action="store_true", help=f"remove resolved entries from {BASELINE_REL}")
    parser.add_argument("--self-test", action="store_true", help="run built-in synthetic tests for R1-R10")
    args = parser.parse_args()

    if args.self_test:
        run_self_tests()
        return

    root = Path(__file__).resolve().parents[1]
    baseline_file = root / BASELINE_REL
    violations = scan_repository(root)

    if not baseline_file.exists():
        sys.exit(f"Missing baseline {BASELINE_REL}")

    baseline_data = json.loads(baseline_file.read_text(encoding="utf-8"))
    baseline_keys = list(baseline_data.get("violations", []))
    added, stale = diff_baseline(baseline_keys, violations)
    current_set = {v.key for v in violations}

    if args.prune:
        if added:
            sys.exit(
                "Cannot --prune while new editor architecture violations exist:\n  "
                + "\n  ".join(v.message for v in added)
            )
        pruned_list = [k for k in baseline_keys if k in current_set]
        baseline_file.write_text(
            json.dumps({**baseline_data, "violations": pruned_list}, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"Pruned {len(stale)} resolved exemption(s) from {BASELINE_REL} ({len(pruned_list)} remaining).")
        return

    errors: list[str] = []
    if added:
        errors.append(
            "Editor architecture layering violation(s) introduced:\n  "
            + "\n  ".join(v.message for v in added)
        )
    if stale:
        errors.append(
            f"{BASELINE_REL} contains {len(stale)} stale exemption(s) that no longer violate "
            f"(run `python3 tools/check-editor-architecture.py --prune`):\n  "
            + "\n  ".join(stale)
        )
    if errors:
        sys.exit("\n".join(errors))

    print(
        f"Editor architecture verified: R1-R10 checked, {len(current_set)} baseline exemption(s)"
    )


if __name__ == "__main__":
    main()
