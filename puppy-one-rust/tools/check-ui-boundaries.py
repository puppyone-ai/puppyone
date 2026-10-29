#!/usr/bin/env python3
"""Early guard for the extracted native kit, not a replacement for crate APIs.
The GPUI shell retains its existing Web content adapter and Rust storage authority.
"""
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
errors = []
# UI primitives, the component library and the native text input (ui::input).
primitives = list((root / "src/ui").rglob("*.rs"))
for path in primitives:
    source = path.read_text()
    for pattern, message in [
        (r"\b(?:wry|rfd|cap_std|muda|tokio)\s*::", "native authority/runtime imported by a UI primitive"),
        (r"\bstd\s*::\s*(?:fs|process|thread|net)\b", "I/O or worker ownership inside a UI primitive"),
        # String, file-glyph and product-asset catalogs are leaf data modules UI may read.
        (r"crate\s*::\s*(?!ui\b|theme\b|localization\b|file_kind\b|asset_catalog\b)\w+",
         "reverse dependency from UI into composition/features"),
        (r"\b(?:rgb|rgba|hsla)\s*\(", "local palette instead of semantic theme input"),
    ]:
        if re.search(pattern, source):
            errors.append(f"{path.relative_to(root)}: {message}")

# Asset data must not grow an application/renderer dependency. Tests may
# verify that the separate GPUI asset adapter embeds each catalog entry.
asset_model = (root / 'src/asset_catalog.rs').read_text().split('#[cfg(test)]')[0]
if re.search(r'\bgpui\s*::|crate::(?:assets|features|shell)|\bstd::(?:fs|process|thread)', asset_model):
    errors.append('src/asset_catalog.rs: catalog data depends on composition/rendering')

# Product meanings have one typed registry entry. Views must not select an
# old concrete drawing (the asset adapter retains aliases for compatibility).
product_drawing = re.compile(r'(?:Icon::new|\.icon|\.path)\(\s*"(?:icons/)?(?:house(?:-compact)?|folder(?:-closed|-open)?|laptop|cloud(?:-off|-upload)?|tree-disclosure(?:-open)?|disclosure)(?:\.svg)?"')
for base in ['src/shell','src/features','src/ui']:
    for path in (root/base).rglob('*.rs'):
        if product_drawing.search(path.read_text()):
            errors.append(f'{path.relative_to(root)}: use ProductIcon registry, not a concrete product drawing')

# Workspace consumers use the admitted handle/ports, never the concrete local
# adapter. Relative paths in the single-root tree are not ambient OS grants.
for relative in ['src/workspace/contracts.rs', 'src/workspace/ports.rs']:
    source = (root / relative).read_text()
    if re.search(r'\b(?:gpui|cap_std|reqwest|tokio)\s*::|\bstd\s*::\s*(?:fs|net|thread|process)|crate::(?:shell|features)', source):
        errors.append(f'{relative}: provider contract owns an implementation/UI dependency')
for relative in ['src/documents.rs', 'src/shell/explorer', 'src/features/create_new', 'src/editor/host', 'src/editor/viewers']:
    base = root / relative
    paths = base.rglob('*.rs') if base.is_dir() else [base]
    for path in paths:
        if path.name == 'tests.rs':
            continue
        source = path.read_text().split('#[cfg(test)]')[0]
        if re.search(r'workspace::local|cap_std\s*::|std\s*::\s*fs\b', source):
            errors.append(f'{path.relative_to(root)}: workspace consumer bypasses provider authority')

# Native auth has one credential/transport owner, outside presentation. Only
# features/cloud_account.rs projects public snapshots and opens validated URLs.
for path in (root / 'src/cloud_auth').rglob('*.rs'):
    if re.search(r'\bgpui\s*::|crate::(?:features|shell|ui)', path.read_text()):
        errors.append(f'{path.relative_to(root)}: auth authority depends on presentation')
for base in ['src/features/settings/main', 'src/shell', 'src/shell.rs']:
    paths = [root / base] if (root / base).is_file() else (root / base).rglob('*.rs')
    for path in paths:
        source = path.read_text().split('#[cfg(test)]')[0]
        if re.search(r'\b(?:access_token|refresh_token|code_verifier)\b|bearer_auth|security_framework::|cloud_auth::(?:Broker|http|store)', source):
            errors.append(f'{path.relative_to(root)}: account view bypasses the public auth projection')

# The first-publication service (like `cloud_auth`) owns Git, keychain and its
# journal; it never depends on presentation or reads credentials itself.
for path in (root / 'src/cloud_publication').rglob('*.rs'):
    if path.name == 'tests.rs':
        continue
    source = path.read_text()
    if re.search(r'\bgpui\s*::|crate::(?:features|shell|ui|editor)|bearer_auth|\b(?:access_token|refresh_token)\b|reqwest::(?:Client|RequestBuilder|blocking)', source):
        errors.append(f'{path.relative_to(root)}: publication service depends on presentation or credentials')

# Live Cloud files consume admitted auth transport, not credentials, a private
# HTTP client, local mirrors or a second presentation/save owner.
for path in (root / 'src/workspace/cloud').rglob('*.rs'):
    if path.name == 'tests.rs':
        continue
    source = path.read_text()
    if re.search(r'\b(?:gpui|cap_std|security_framework)\s*::|crate::(?:features|shell|ui|editor)|bearer_auth|\b(?:access_token|refresh_token)\b|reqwest::(?:Client|RequestBuilder|blocking)|std::(?:fs|process|net)', source):
        errors.append(f'{path.relative_to(root)}: live Cloud adapter bypasses its authority/port boundary')

# The retired Markdown prototype must not come back.
if (root / "src/native_editor").exists():
    errors.append("src/native_editor: retired prototype editor remains")
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
# Component library: product screens compose `ui::components`. GPUI Kit's
# styled components (its default look) and per-view palettes stay out of
# feature and shell code; Kit's headless `gpui_kit::base` layer is fine.
stock = re.compile(r"\bgpui_kit\s*::\s*component\s*::\s*(?:button|menu|switch|checkbox|tab|select|dropdown|popover|dialog|radio|toggle)\b|\b(?:PopupMenu|PopupMenuItem|ContextMenuExt|DropdownMenu|ButtonVariants|ButtonCustomVariant)\b")
palette = re.compile(r"\bTheme\s*::\s*new\s*\(")
for folder in ["src/features", "src/shell"]:
    for path in (root / folder).rglob("*.rs"):
        source = path.read_text()
        if stock.search(source):
            errors.append(f"{path.relative_to(root)}: GPUI Kit stock component; use ui::components")
        if palette.search(source):
            errors.append(f"{path.relative_to(root)}: builds its own palette; read cx.palette()")
for retired in ["src/ui/primitives.rs", "src/ui/menu.rs", "src/ui/exact_text.rs",
                "src/features/settings/components.rs", "src/geometry/menu_position.rs"]:
    if (root / retired).exists():
        errors.append(f"{retired}: retired presentation helper remains; use ui::components")
# Style system: `theme.rs` is the only colour source (projected from the
# product theme packs and tokens.css) and `editor/tokens.rs` the editor's
# (it parses and composites the product's computed editor tokens);
# everything else reads `Theme` or token fields. Test fixtures may spell out
# the colours they assert.
colour_literal = re.compile(r"\b(?:rgb|rgba|hsla|hsl)\s*\(|\b(?:Rgba|Hsla)\s*\{\s*[rh]\s*:|\"#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?\"")
colour_sources = {root / 'src/theme.rs', root / 'src/editor/tokens.rs'}
for path in (root / 'src').rglob('*.rs'):
    if path in colour_sources or path.name == 'tests.rs' or path.name.endswith('_tests.rs'):
        continue
    for number, line in enumerate(path.read_text().splitlines(), 1):
        if colour_literal.search(line) and not line.lstrip().startswith('//'):
            errors.append(f'{path.relative_to(root)}:{number}: colour literal outside theme.rs')
if errors:
    raise SystemExit("\n".join(errors))
print("Native UI boundary guard passed (GPUI primitives, Markdown layers and retired framework guard)")
