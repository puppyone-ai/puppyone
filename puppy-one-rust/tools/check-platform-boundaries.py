#!/usr/bin/env python3
"""Cross-platform boundary guard (puppyone#130).

Enforces Rules P1-P5 across `src/` and workspace `Cargo.toml` manifests against
the shrink-only baseline in `tools/platform-boundary-baseline.json`:
  - P1: No `target_os`, `cfg(windows)`, or `cfg(unix)` outside `src/platform/`
        and `src/web_host/backend/` (production code).
  - P2: No OS SDK/FFI imports (`objc2*`, `security_framework`, `core_foundation*`,
        `libc::`, or the `windows` crate) outside `src/platform/` and
        `src/web_host/backend/` (production code).
  - P3: No OS crate dependencies in `Cargo.toml` outside `crates/po-platform/Cargo.toml`
        (except `wry` / Apple WebKit crates in `crates/po-editor/Cargo.toml`).
  - P4: No hardcoded `"cmd-..."` (literal or `format!("{...}-...")` with `"cmd"`)
        keybindings anywhere in `src/` (production or tests); use GPUI's
        cross-platform `"secondary-..."` modifier.
  - P5: No runtime OS branching (`Os::current(` or `.os.is_*`) outside
        `src/platform/`, `src/web_host/backend/`, and `P5_ALLOWLIST` (production code);
        express UI and behavior differences via named `Conventions` or capabilities.

Usage:
  python3 tools/check-platform-boundaries.py
  python3 tools/check-platform-boundaries.py --prune
  python3 tools/check-platform-boundaries.py --self-test
"""
import argparse
import json
from pathlib import Path
import re
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parent))
import rust_paths  # noqa: E402

BASELINE_REL = "tools/platform-boundary-baseline.json"

OS_CFG_RE = re.compile(
    r'\btarget_os\b|\bcfg!?\s*\([^)]*\b(?:unix|windows)\b'
)
OS_API_RE = re.compile(
    r'\b(?:objc2(?:_\w+)?|security_framework|core_foundation(?:_sys)?|libc)\s*::'
    r'|\buse\s+windows\s*::'
    r'|\bwindows\s*::\s*(?:Win32|core|Wdk|UI|Foundation|System|Storage|Security|Graphics|Networking)\b'
)
HARDCODED_CMD_RE = re.compile(r'"[^"]*\bcmd-[^"]*"')
FORMAT_DASH_RE = re.compile(r'format!\s*\(\s*"[^"]*\{[^}]+\}-')
RUNTIME_OS_RE = re.compile(r"\bOs::current\s*\(|\.os\.is_\w+")
# Explicit production allowlist for P5 (empty by default: prefer named fields
# on `platform::conventions::Conventions` or `po-platform` capabilities).
P5_ALLOWLIST: set[str] = set()


def has_dynamic_cmd_keybinding(no_comments: str) -> bool:
    if '"cmd"' not in no_comments or "format!" not in no_comments:
        return False
    for m in FORMAT_DASH_RE.finditer(no_comments):
        window_start = max(0, m.start() - 400)
        window_end = min(len(no_comments), m.end() + 120)
        if '"cmd"' in no_comments[window_start:window_end]:
            return True
    return False
MANIFEST_OS_DEPS = {
    "objc2",
    "objc2-app-kit",
    "objc2-foundation",
    "objc2-web-kit",
    "security-framework",
    "core-foundation-sys",
    "windows",
    "windows-sys",
    "windows-registry",
    "libc",
    "block2",
    "dispatch2",
    "wry",
}
PO_EDITOR_ALLOWED_WEB_DEPS = {
    "wry",
    "objc2",
    "objc2-foundation",
    "objc2-web-kit",
    "block2",
    "dispatch2",
}


class Violation:
    __slots__ = ("rule", "key", "message")

    def __init__(self, rule: str, key: str, message: str):
        self.rule = rule
        self.key = key
        self.message = message


def strip_test_mods(source: str) -> str:
    """Strip comments and `#[cfg(...test...)] mod` blocks for production scans."""
    cleaned = re.sub(r"//[^\n]*", "", source)
    cleaned = re.sub(r"/\*.*?\*/", "", cleaned, flags=re.S)
    out, i = [], 0
    pattern = re.compile(
        r"#\[cfg\([^\]]*\btest\b[^\]]*\)\]\s*(?:#\[[^\]]*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?mod\s+\w+\s*([{;])"
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


def test_only_files(root: Path) -> set[Path]:
    skipped: set[Path] = set()
    cfg_mod = re.compile(
        r"#\[cfg\([^\]]*\btest\b[^\]]*\)\]\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;"
    )
    for mod_file in (root / "src").rglob("*.rs"):
        text = mod_file.read_text(encoding="utf-8")
        parent = (
            mod_file.parent
            if mod_file.name in ("mod.rs", "main.rs")
            else mod_file.with_suffix("")
        )
        for name in cfg_mod.findall(text):
            for candidate in (parent / f"{name}.rs", parent / name / "mod.rs"):
                if candidate.exists():
                    skipped.add(candidate)
    return skipped


def is_test_file(root: Path, path: Path, cfg_test_files: set[Path], source: str) -> bool:
    if path in cfg_test_files:
        return True
    if path.name in ("tests.rs", "bench.rs", "test_support.rs") or path.name.endswith(
        ("_tests.rs", "_test_fixtures.rs")
    ):
        return True
    rel_parts = path.relative_to(root).parts
    if "tests" in rel_parts or "parity_tests" in rel_parts or "dev" in rel_parts:
        return True
    if re.match(r"\s*#!\[cfg\(test\)\]", source):
        return True
    return False


def is_platform_layer(rel: str) -> bool:
    return rel.startswith("src/platform/") or rel.startswith("src/web_host/backend/")


def scan_manifests(root: Path) -> list[Violation]:
    violations: list[Violation] = []
    manifests = [root / "Cargo.toml", *sorted((root / "crates").glob("*/Cargo.toml"))]
    for manifest in manifests:
        if not manifest.is_file():
            continue
        rel = manifest.relative_to(root).as_posix()
        if rel == "crates/po-platform/Cargo.toml":
            continue
        in_dev_deps = False
        for line in manifest.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if stripped.startswith("["):
                in_dev_deps = "dev-dependencies" in stripped
                continue
            if in_dev_deps or not stripped or stripped.startswith("#"):
                continue
            m = re.match(r"^([A-Za-z0-9_-]+)\s*=", stripped)
            if not m:
                continue
            dep = m.group(1)
            if dep not in MANIFEST_OS_DEPS:
                continue
            if rel == "crates/po-editor/Cargo.toml" and dep in PO_EDITOR_ALLOWED_WEB_DEPS:
                continue
            key = f"P3 {rel} {dep}"
            violations.append(
                Violation(
                    "P3",
                    key,
                    f"[P3] {rel}: OS crate dependency `{dep}` belongs in crates/po-platform/Cargo.toml",
                )
            )
    return violations


def scan_repository(root: Path) -> list[Violation]:
    violations: list[Violation] = []
    seen: set[str] = set()

    def record(rule: str, key: str, message: str) -> None:
        if key not in seen:
            seen.add(key)
            violations.append(Violation(rule, key, message))

    src_dir = root / "src"
    if src_dir.is_dir():
        cfg_tests = test_only_files(root)
        for path in sorted(src_dir.rglob("*.rs")):
            rel = path.relative_to(root).as_posix()
            raw = path.read_text(encoding="utf-8")

            # P4: hardcoded "cmd-" keybindings (literal or format!) forbidden everywhere.
            no_comments = re.sub(r"//[^\n]*", "", raw)
            if HARDCODED_CMD_RE.search(no_comments) or has_dynamic_cmd_keybinding(
                no_comments
            ):
                record(
                    "P4",
                    f"P4 {rel}",
                    f"[P4] {rel}: hardcoded `cmd-` keybinding; use cross-platform `secondary-`",
                )

            if is_platform_layer(rel) or is_test_file(root, path, cfg_tests, raw):
                continue

            prod = strip_test_mods(raw)
            if OS_CFG_RE.search(prod):
                record(
                    "P1",
                    f"P1 {rel}",
                    f"[P1] {rel}: OS conditional (`target_os`/`cfg(unix)`/`cfg(windows)`) outside src/platform/",
                )
            if OS_API_RE.search(prod):
                record(
                    "P2",
                    f"P2 {rel}",
                    f"[P2] {rel}: direct OS FFI/SDK import outside src/platform/",
                )
            if rel not in P5_ALLOWLIST and RUNTIME_OS_RE.search(prod):
                record(
                    "P5",
                    f"P5 {rel}",
                    f"[P5] {rel}: runtime OS check (`Os::current()` / `.os.is_*`) outside src/platform/; use a named Conventions/capability field",
                )

    for v in scan_manifests(root):
        record(v.rule, v.key, v.message)

    return violations


def diff_baseline(
    baseline_keys: list[str], violations: list[Violation]
) -> tuple[list[Violation], list[str]]:
    by_key = {v.key: v for v in violations}
    current_keys = sorted(by_key)
    baseline_set = set(baseline_keys)
    current_set = set(current_keys)
    added = [by_key[k] for k in current_keys if k not in baseline_set]
    stale = [k for k in baseline_keys if k not in current_set]
    return added, stale


def run_self_tests() -> None:
    cases = [
        (
            "P1",
            {
                "src/platform/good.rs": "#[cfg(target_os = \"macos\")] fn f() {}\n",
                "src/web_host/backend/win.rs": "#[cfg(windows)] fn g() {}\n",
                "src/app/bad.rs": "fn f() -> bool { cfg!(target_os = \"macos\") }\n",
            },
            {"P1"},
        ),
        (
            "P2",
            {
                "src/app/ok_windows_mod.rs": "fn f() { app::windows::count(); crate::app::windows::open(); }\n",
                "src/cloud/bad.rs": "fn f() { let _ = security_framework::passwords::get_generic_password; }\n",
                "src/workspace/bad_win.rs": "use windows::Win32::Foundation::HANDLE;\n",
            },
            {"P2"},
        ),
        (
            "P3",
            {
                "crates/po-platform/Cargo.toml": "[dependencies]\nlibc = \"0.2\"\n",
                "crates/po-editor/Cargo.toml": "[dependencies]\nwry = \"=0.57.0\"\n",
                "crates/po-ui/Cargo.toml": "[dependencies]\nobjc2 = \"=0.6.4\"\n",
            },
            {"P3"},
        ),
        (
            "P4",
            {
                "src/app/good.rs": "const K: &str = \"secondary-s\";\n",
                "src/app/tests/bad.rs": "fn t() { cx.simulate_keystrokes(\"cmd-z\"); }\n",
            },
            {"P4"},
        ),
        (
            "P4-format",
            {
                "src/ui/bad_fmt.rs": (
                    "fn bind() {\n"
                    "    for m in [\"cmd\", \"ctrl\"] {\n"
                    "        let _ = format!(\"{m}-a\");\n"
                    "    }\n"
                    "}\n"
                ),
            },
            {"P4"},
        ),
        (
            "P5",
            {
                "src/platform/good.rs": "fn f() -> bool { Os::current().is_macos() }\n",
                "src/app/good_conv.rs": "fn f() -> bool { Conventions::current().emacs_line_bindings }\n",
                "src/editor/bad_os_current.rs": "fn f() -> bool { crate::platform::os::Os::current().is_macos() }\n",
                "src/app/bad_dot_os.rs": "fn g(c: Conventions) -> bool { c.os.is_windows() }\n",
            },
            {"P5"},
        ),
    ]
    for label, files, expected in cases:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_root = Path(tmp)
            for rel, content in files.items():
                full = tmp_root / rel
                full.parent.mkdir(parents=True, exist_ok=True)
                full.write_text(content, encoding="utf-8")
            found = scan_repository(tmp_root)
            got = {v.rule for v in found}
            if got != expected:
                raise AssertionError(
                    f"Self-test {label} expected {expected}, got {got}: {[v.key for v in found]}"
                )
    print(f"Platform boundary self-tests passed ({len(cases)} scenarios covering P1-P5).")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--prune",
        action="store_true",
        help=f"remove resolved entries from {BASELINE_REL}",
    )
    parser.add_argument(
        "--init-baseline",
        action="store_true",
        help=f"write current P1-P3 violations into {BASELINE_REL} (never allows P4)",
    )
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="run synthetic tests for P1-P4",
    )
    args = parser.parse_args()

    if args.self_test:
        run_self_tests()
        return

    root = Path(__file__).resolve().parents[1]
    baseline_file = root / BASELINE_REL
    violations = scan_repository(root)

    if args.init_baseline:
        p4 = [v for v in violations if v.rule == "P4"]
        if p4:
            sys.exit(
                "Cannot initialize baseline with hardcoded `cmd-` keybindings:\n  "
                + "\n  ".join(v.message for v in p4)
            )
        keys = sorted(v.key for v in violations)
        baseline_file.write_text(
            json.dumps(
                {
                    "description": "Shrink-only platform boundary baseline (puppyone#130). Resolve entries as OS logic moves into src/platform/ and src/web_host/backend/; run `--prune` to remove fixed items.",
                    "violations": keys,
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        print(f"Wrote {len(keys)} baseline exemption(s) to {BASELINE_REL}.")
        return

    if not baseline_file.exists():
        sys.exit(f"Missing baseline {BASELINE_REL}")

    baseline_data = json.loads(baseline_file.read_text(encoding="utf-8"))
    baseline_keys = list(baseline_data.get("violations", []))
    added, stale = diff_baseline(baseline_keys, violations)
    current_set = {v.key for v in violations}

    if args.prune:
        if added:
            sys.exit(
                "Cannot --prune while new platform boundary violations exist:\n  "
                + "\n  ".join(v.message for v in added)
            )
        pruned = [k for k in baseline_keys if k in current_set]
        baseline_file.write_text(
            json.dumps({**baseline_data, "violations": pruned}, indent=2) + "\n",
            encoding="utf-8",
        )
        print(
            f"Pruned {len(stale)} resolved exemption(s) from {BASELINE_REL} ({len(pruned)} remaining)."
        )
        return

    errors: list[str] = []
    if added:
        errors.append(
            "Platform boundary violation(s) introduced:\n  "
            + "\n  ".join(v.message for v in added)
        )
    if stale:
        errors.append(
            f"{BASELINE_REL} contains {len(stale)} stale exemption(s) that no longer violate "
            f"(run `python3 tools/check-platform-boundaries.py --prune`):\n  "
            + "\n  ".join(stale)
        )
    if errors:
        sys.exit("\n".join(errors))

    print(
        f"Platform boundary verified: P1-P5 checked, {len(current_set)} baseline exemption(s)"
    )


if __name__ == "__main__":
    main()
