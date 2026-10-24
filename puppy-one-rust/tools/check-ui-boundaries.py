#!/usr/bin/env python3
"""Early guard for the extracted native kit, not a replacement for crate APIs.
The GPUI shell retains its existing Web content adapter and Rust storage authority.
"""
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
errors = []
editor = root / "src/native_editor"
# The historical ui::input export remains stable; its implementation now lives
# with the Markdown adapter. Keep the same primitive checks after that move.
primitives = list((root / "src/ui").rglob("*.rs"))
primitives += list((editor / "gpui/input").rglob("*.rs"))
primitives += [editor / "gpui" / name for name in
               ["input.rs", "layout.rs", "hit_test.rs", "presentation.rs"]]
for path in primitives:
    source = path.read_text()
    for pattern, message in [
        (r"\b(?:wry|rfd|cap_std|muda|tokio)\s*::", "native authority/runtime imported by a UI primitive"),
        (r"\bstd\s*::\s*(?:fs|process|thread|net)\b", "I/O or worker ownership inside a UI primitive"),
        # The string catalog and the file-glyph table are leaf modules UI may read.
        (r"crate\s*::\s*(?!ui\b|theme\b|localization\b|file_kind\b)\w+",
         "reverse dependency from UI into composition/features"),
        (r"\b(?:rgb|rgba|hsla)\s*\(", "local palette instead of semantic theme input"),
    ]:
        if re.search(pattern, source):
            errors.append(f"{path.relative_to(root)}: {message}")

# These are source-level guardrails, not a substitute for Rust visibility or
# semantic tests. Features may edit the core model; only the host commits a
# document revision/history entry, and only the GPUI adapter owns native input.
for layer in ["core", "markdown", "features", "host", "gpui"]:
    for path in (editor / layer).rglob("*.rs"):
        source = path.read_text()
        rules = [
            (r"\b(?:wry|rfd|cap_std|tokio)\s*::|\bstd\s*::\s*(?:fs|process|thread|net)\b",
             "Markdown editor must use the existing document/storage host for I/O"),
        ]
        if layer != "gpui":
            rules.append((r"\b(?:gpui|gpui_kit)\s*(?:::|[,}])",
                          "native presentation dependency outside the GPUI adapter"))
        if layer in ["core", "markdown", "features"]:
            rules.extend([
                (r"crate\s*::\s*(?!native_editor\b)\w+",
                 "Markdown model/feature depends on an application service"),
                (r"\bhost\s*(?:::|[,}])",
                 "Markdown model/feature depends on the session host"),
            ])
        if layer == "core":
            rules.append((r"\b(?:features|markdown|pulldown_cmark)\s*(?:::|[,}])",
                          "editor core must stay independent of codecs and features"))
        if layer == "markdown":
            rules.append((r"\bfeatures\s*(?:::|[,}])",
                          "Markdown codec depends on edit features"))
        if layer == "features":
            rules.append((r"\b(?:markdown|pulldown_cmark)\s*(?:::|[,}])",
                          "edit features must operate on the semantic model"))
        for pattern, message in rules:
            if re.search(pattern, source):
                errors.append(f"{path.relative_to(root)}: {message}")
for retired in ["model.rs", "continuous.rs", "session.rs", "ui.rs",
                "model/tests.rs", "continuous/tests.rs", "ui/tests.rs"]:
    if (editor / retired).exists():
        errors.append(f"src/native_editor/{retired}: retired Markdown monolith remains")
for folder in [root / "src", root / "native-editor-probe/src"]:
    for path in folder.rglob("*.rs"):
        if re.search(r"\b(?:egui|eframe|wgpu)\s*::", path.read_text()):
            errors.append(f"{path.relative_to(root)}: retired UI framework import")
for manifest in [root / "Cargo.toml", root / "native-editor-probe/Cargo.toml"]:
    if "gpui-kit-markdown-editor" in manifest.read_text():
        errors.append(f"{manifest.relative_to(root)}: independent editor dependency is excluded")
    if not re.search(r'^gpui-kit\s*=.*=0\.8\.0', manifest.read_text(), re.M):
        errors.append(f"{manifest.relative_to(root)}: public Kit dependency must stay pinned")
    if re.search(r"^(?:egui|eframe|egui_extras|wgpu)\s*=", manifest.read_text(), re.M):
        errors.append(f"{manifest.relative_to(root)}: retired UI framework dependency")
for path in (root / 'src/platform').rglob('*.rs'):
    if re.search(r'\b(?:gpui|wry|egui)\s*::|crate::features', path.read_text()):
        errors.append(f'{path.relative_to(root)}: platform worker depends on presentation')
for path in (root / 'src/features/workbench').rglob('*.rs'):
    if re.search(r'\bstd\s*::\s*(?:fs|process)|platform::git|source_control::', path.read_text()):
        errors.append(f'{path.relative_to(root)}: workbench topology owns a feature operation')
for path in (root / 'src/agent').rglob('*.rs'):
    if re.search(r'\b(?:gpui|wry)\s*::|crate::features', path.read_text()):
        errors.append(f'{path.relative_to(root)}: Agent host depends on presentation')
for folder in ['src/features/desktop_agent/domain', 'src/features/desktop_agent/application']:
    for path in (root / folder).rglob('*.rs'):
        if re.search(r'\bgpui\s*::|\bstd\s*::\s*(?:fs|process)|runtimes::|transports::|infrastructure::', path.read_text()):
            errors.append(f'{path.relative_to(root)}: Agent application/domain depends on a platform adapter')
for path in (root / 'src/features/desktop_agent/ui').rglob('*.rs'):
    if re.search(r'json!|\["(?:method|params|threadId|turnId)"\]|runtimes::|transports::', path.read_text()):
        errors.append(f'{path.relative_to(root)}: Agent view owns wire protocol handling')
for path in (root / 'src/model_connections').rglob('*.rs'):
    if re.search(r'\b(?:gpui|wry)\s*::|crate::features', path.read_text()):
        errors.append(f'{path.relative_to(root)}: model configuration depends on presentation')
for path in [root / 'src/features/model_connections/ui.rs']:
    if re.search(r'\b(?:security_framework|reqwest)\s*::|\bstd\s*::\s*(?:fs|process|thread|net)|configuration::', path.read_text()):
        errors.append(f'{path.relative_to(root)}: model configuration view bypasses native client')
# Product-level owners must survive the language port; views do not persist data.
for relative in ['src/editor/document_session/document_editing_session.rs','src/editor/document_session/types.rs','src/features/settings/preference_types.rs','src/features/settings/sidebar/settings_sidebar_model.rs','src/features/create_new/create_entry_menu_registry.rs','src/features/create_new/create_entry_draft.rs','src/typography.rs']:
    path=root / relative
    if re.search(r'\b(?:gpui|gpui_kit|cap_std)\s*::|\bstd\s*::\s*(?:fs|process|thread)',path.read_text()):
        errors.append(f'{relative}: pure product model owns presentation or I/O')
for path in list((root/'src/features/settings/main').glob('*.rs'))+[root/'src/features/settings/settings_workspace_surface.rs',root/'src/features/create_new/create_entry_dialog.rs']:
    if re.search(r'crate::platform|\bstd\s*::\s*(?:fs|process|thread)',path.read_text()):
        errors.append(f'{path.relative_to(root)}: view bypasses its controller/native port')
# Style system: `theme.rs` is the only colour source (projected from the
# product theme packs and tokens.css); everything else reads `Theme` fields.
colour_literal = re.compile(r"\b(?:rgb|rgba|hsla|hsl)\s*\(|\b(?:Rgba|Hsla)\s*\{\s*[rh]\s*:|\"#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?\"")
for path in (root / 'src').rglob('*.rs'):
    if path == root / 'src/theme.rs':
        continue
    for number, line in enumerate(path.read_text().splitlines(), 1):
        if colour_literal.search(line) and not line.lstrip().startswith('//'):
            errors.append(f'{path.relative_to(root)}:{number}: colour literal outside theme.rs')
if errors:
    raise SystemExit("\n".join(errors))
print("Native UI boundary guard passed (GPUI primitives, Markdown layers and retired framework guard)")
