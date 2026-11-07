#!/usr/bin/env python3
"""Early guard for the extracted native kit, not a replacement for crate APIs.
The GPUI shell retains its existing Web content adapter and Rust storage authority.
"""
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import rust_paths  # noqa: E402

root = Path(__file__).resolve().parents[1]
errors = []
# UI primitives, the component library and the native text input (ui::input).
primitives = list((root / "src/ui").rglob("*.rs"))
for path in primitives:
    source = path.read_text()
    for pattern, message in [
        (r"\b(?:wry|rfd|cap_std|muda|tokio)\s*::", "native authority/runtime imported by a UI primitive"),
        (r"\bstd\s*::\s*(?:fs|process|thread|net)\b", "I/O or worker ownership inside a UI primitive"),
        # String, file-glyph, product-asset and type/font catalogs are leaf data
        # modules UI may read.
        (r"crate\s*::\s*(?!ui\b|theme\b|localization\b|file_kind\b|asset_catalog\b|typography\b)\w+",
         "reverse dependency from UI into composition/features"),
        (r"\b(?:rgb|rgba|hsla)\s*\(", "local palette instead of semantic theme input"),
    ]:
        if re.search(pattern, source):
            errors.append(f"{path.relative_to(root)}: {message}")

# Asset data must not grow an application/renderer dependency. Tests may
# verify that the separate GPUI asset adapter embeds each catalog entry.
asset_model = (root / 'src/asset_catalog.rs').read_text().split('#[cfg(test)]')[0]
if re.search(r'\bgpui\s*::|crate::(?:assets|features|app)|\bstd::(?:fs|process|thread)', asset_model):
    errors.append('src/asset_catalog.rs: catalog data depends on composition/rendering')

# Product meanings have one typed registry entry. Views must not select an
# old concrete drawing (the asset adapter retains aliases for compatibility).
product_drawing = re.compile(r'(?:Icon::new|\.icon|\.path)\(\s*"(?:icons/)?(?:house(?:-compact)?|folder(?:-closed|-open)?|laptop|cloud(?:-off|-upload)?|tree-disclosure(?:-open)?|disclosure)(?:\.svg)?"')
for base in ['src/app','src/features','src/ui']:
    for path in (root/base).rglob('*.rs'):
        if product_drawing.search(path.read_text()):
            errors.append(f'{path.relative_to(root)}: use ProductIcon registry, not a concrete product drawing')

# Workspace consumers use the admitted handle/ports, never the concrete local
# adapter. Relative paths in the single-root tree are not ambient OS grants.
for relative in ['src/workspace/contracts.rs', 'src/workspace/ports.rs']:
    source = (root / relative).read_text()
    if re.search(r'\b(?:gpui|cap_std|reqwest|tokio)\s*::|\bstd\s*::\s*(?:fs|net|thread|process)|crate::(?:app|features)', source):
        errors.append(f'{relative}: provider contract owns an implementation/UI dependency')
for relative in ['src/documents/mod.rs', 'src/app/explorer', 'src/features/create_new', 'src/editor/host', 'src/editor/viewers']:
    base = root / relative
    paths = base.rglob('*.rs') if base.is_dir() else [base]
    for path in paths:
        if path.name == 'tests.rs':
            continue
        source = path.read_text().split('#[cfg(test)]')[0]
        if re.search(r'workspace::local|cap_std\s*::|std\s*::\s*fs\b', source):
            errors.append(f'{path.relative_to(root)}: workspace consumer bypasses provider authority')

# Native auth has one credential/transport owner, outside presentation. Only
# features/cloud/account.rs projects public snapshots and opens validated URLs.
for path in (root / 'src/cloud/auth').rglob('*.rs'):
    if re.search(r'\bgpui\s*::|crate::(?:features|app|ui)', path.read_text()):
        errors.append(f'{path.relative_to(root)}: auth authority depends on presentation')
for base in ['src/features/settings/main', 'src/app']:
    paths = [root / base] if (root / base).is_file() else (root / base).rglob('*.rs')
    for path in paths:
        source = path.read_text().split('#[cfg(test)]')[0]
        if re.search(r'\b(?:access_token|refresh_token|code_verifier)\b|bearer_auth|security_framework::|cloud::auth::(?:Broker|http|store)', source):
            errors.append(f'{path.relative_to(root)}: account view bypasses the public auth projection')

# The first-publication service (like `cloud::auth`) owns Git, keychain and its
# journal; it never depends on presentation or reads credentials itself.
for path in (root / 'src/cloud/publication').rglob('*.rs'):
    if path.name == 'tests.rs':
        continue
    source = path.read_text()
    if re.search(r'\bgpui\s*::|crate::(?:features|app|ui|editor)|bearer_auth|\b(?:access_token|refresh_token)\b|reqwest::(?:Client|RequestBuilder|blocking)', source):
        errors.append(f'{path.relative_to(root)}: publication service depends on presentation or credentials')

# Live Cloud files consume admitted auth transport, not credentials, a private
# HTTP client, local mirrors or a second presentation/save owner.
for path in (root / 'src/workspace/cloud').rglob('*.rs'):
    if path.name == 'tests.rs':
        continue
    source = path.read_text()
    if re.search(r'\b(?:gpui|cap_std|security_framework)\s*::|crate::(?:features|app|ui|editor)|bearer_auth|\b(?:access_token|refresh_token)\b|reqwest::(?:Client|RequestBuilder|blocking)|std::(?:fs|process|net)', source):
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
def fixture(path):
    """Tests and the pixel lab's recorded fixtures may spell out JSON."""
    return 'tests' in path.parts or path.name in ('tests.rs', 'fixture.rs', 'fixtures.rs', 'lab.rs')
for path in (root / 'src/features/desktop_agent/ui').rglob('*.rs'):
    if fixture(path):
        continue
    source = path.read_text().split('#[cfg(test)]')[0]
    if re.search(r'json!|\["(?:method|params|threadId|turnId)"\]|runtimes::|transports::', source):
        errors.append(f'{path.relative_to(root)}: Agent view owns wire protocol handling')
# The Agent window works on the contract's types (`agent::contract::dto`,
# `agent::contract::protocol`); JSON stays in the contract, and in the Cloud
# Agent's API client.
for path in (root / 'src/features/desktop_agent').rglob('*.rs'):
    if fixture(path) or (root / 'src/features/desktop_agent/infrastructure/cloud') in [path, *path.parents] \
            or path == root / 'src/features/desktop_agent/infrastructure/cloud.rs':
        continue
    source = path.read_text().split('#[cfg(test)]')[0]
    if re.search(r'serde_json|\bValue\b|json!|contract::js', source):
        errors.append(f'{path.relative_to(root)}: Agent window code handles JSON instead of the contract types')
# Provider neutrality (`check-agent-architecture.mjs`): only a runtime
# implementation, a concrete adapter layer, the composition root or a
# migration edge names a concrete Agent; the Agent window names none outside
# its views.
provider_name = re.compile(r'\b(?:opencode|codex|claude(?:\s+code)?|cursor\s+(?:cli|runtime))\b', re.I)
def code(path):
    """Source without comments or its test module."""
    source = path.read_text().split('#[cfg(test)]')[0]
    return re.sub(r'/\*.*?\*/', '', re.sub(r'//[^\n]*', '', source), flags=re.S)
agent_concrete = {'runtimes', 'connections', 'cache', 'protocols', 'security', 'transports',
                  'bootstrap', 'persistence', 'infrastructure', 'migrations', 'installation', 'discovery'}
for path in (root / 'src/agent').rglob('*.rs'):
    if fixture(path) or path.relative_to(root / 'src/agent').parts[0] in agent_concrete:
        continue
    if provider_name.search(code(path)):
        errors.append(f'{path.relative_to(root)}: names a concrete runtime outside a runtime implementation, composition root or migration edge')
for path in (root / 'src/features/desktop_agent').rglob('*.rs'):
    if fixture(path) or root / 'src/features/desktop_agent/ui' in path.parents:
        continue
    if provider_name.search(code(path)):
        errors.append(f'{path.relative_to(root)}: names a concrete runtime; the Agent window outside its views is provider-neutral')
# Features are reached through their facades (`features/<name>/mod.rs`):
# their modules are private, but for the few public API modules below, and
# nothing names another feature's internals.
facade_modules = {'cloud': {'account'}}
for folder in (root / 'src/features').iterdir():
    if folder.is_dir():
        for name in rust_paths.submodules(root, folder.name, public=True) - facade_modules.get(folder.name, set()):
            errors.append(f'src/features/{folder.name}/mod.rs: `pub mod {name}` exposes internals; export its items')
for path, name in rust_paths.deep_feature_imports(root):
    errors.append(f'{path}: names another feature\'s internals ({name}); use its facade')
# Render only reads (`Shell::render`, `Explorer`, `Workbench`,
# `DocumentEditor` and every other view): state changes in events,
# commands and subscriptions, not while a frame is drawn. Listeners and
# deferred callbacks inside a render body run later and are skipped.
render_writes = re.compile(r'\.update(?:_in)?\(|\.emit\(|\bsync_\w+\(|\bguard_\w+\(|\bpersist\(')
for base in ['src/app', 'src/features', 'src/editor']:
    for path in (root / base).rglob('*.rs'):
        if fixture(path):
            continue
        for view, body in rust_paths.render_bodies(rust_paths.strip(path.read_text())):
            for found in render_writes.finditer(rust_paths.without_closures(body)):
                errors.append(f'{path.relative_to(root)}: {view}::render writes state ({found.group(0)})')
# The Shell composes: its fields, construction and assembly in
# `app/mod.rs` (at most 800 lines), its command routing, event handling and
# document pump in `app/command/`; the window's parts are their own
# entities. The dev-capture scenario driver and tests are the exceptions.
shell_impls = {'mod.rs', 'command/route.rs', 'command/events.rs', 'command/pump.rs', 'dev/capture_scenario.rs'}
for path in (root / 'src/app').rglob('*.rs'):
    relative = path.relative_to(root / 'src/app').as_posix()
    if relative not in shell_impls and not fixture(path) and re.search(r'^impl\s+Shell\b', path.read_text(), re.M):
        errors.append(f'src/app/{relative}: `impl Shell` outside the composition root; give the part its own entity')
if (lines := len((root / 'src/app/mod.rs').read_text().splitlines())) > 800:
    errors.append(f'src/app/mod.rs: {lines} lines; the composition root holds at most 800')
# The window's composition and views pass Rust values, never untyped JSON
# (`serde_json::Value`, `json!`): JSON stays at the wire edges (the Agent
# contract and providers, Cloud API clients, disk stores, bundled data).
# A feature's saved-state codec, its infrastructure adapters and dev
# fixtures are such edges.
untyped_json = re.compile(r'\bValue\b|json!|serde_json::(?:to_value|from_value|Map)')
def json_edge(path):
    return fixture(path) or 'dev' in path.parts or 'infrastructure' in path.parts \
        or path.name in ('infrastructure.rs', 'persistence.rs')
views = [*(root / 'src/app').rglob('*.rs'), *(root / 'src/ui').rglob('*.rs'),
         *(root / 'src/features/workbench').rglob('*.rs'),
         *(p for p in (root / 'src/features').rglob('*.rs') if 'ui' in p.parts or p.name == 'ui.rs')]
for path in sorted(set(views)):
    if not json_edge(path) and untyped_json.search(rust_paths.strip(path.read_text())):
        errors.append(f'{path.relative_to(root)}: composition or view code handles untyped JSON')
for path in (root / 'src/agent/model_connections').rglob('*.rs'):
    if re.search(r'\b(?:gpui|wry)\s*::|crate::features', path.read_text()):
        errors.append(f'{path.relative_to(root)}: model configuration depends on presentation')
for path in [root / 'src/features/model_connections/ui.rs']:
    if re.search(r'\b(?:security_framework|reqwest)\s*::|\bstd\s*::\s*(?:fs|process|thread|net)|configuration::', path.read_text()):
        errors.append(f'{path.relative_to(root)}: model configuration view bypasses native client')
# Product-level owners must survive the language port; views do not persist data.
for relative in ['src/editor/document_session/document_editing_session.rs','src/editor/document_session/types.rs','src/features/settings/preference_types.rs','src/features/settings/sidebar/settings_sidebar_model.rs','src/features/create_new/create_entry_menu_registry.rs','src/features/create_new/create_entry_draft.rs','src/typography/mod.rs']:
    path=root / relative
    if re.search(r'\b(?:gpui|gpui_kit|cap_std)\s*::|\bstd\s*::\s*(?:fs|process|thread)',path.read_text()):
        errors.append(f'{relative}: pure product model owns presentation or I/O')
for path in list((root/'src/features/settings/main').glob('*.rs'))+[root/'src/features/settings/settings_workspace_surface.rs',root/'src/features/create_new/create_entry_dialog.rs']:
    if re.search(r'crate::platform|\bstd\s*::\s*(?:fs|process|thread)',path.read_text()):
        errors.append(f'{path.relative_to(root)}: view bypasses its controller/native port')
# Component library: product screens compose `ui::components`. GPUI Kit's
# styled components (its default look) and per-view palettes stay out of
# feature and app code; Kit's headless `gpui_kit::base` layer is fine.
stock = re.compile(r"\bgpui_kit\s*::\s*component\s*::\s*(?:button|menu|switch|checkbox|tab|select|dropdown|popover|dialog|radio|toggle)\b|\b(?:PopupMenu|PopupMenuItem|ContextMenuExt|DropdownMenu|ButtonVariants|ButtonCustomVariant)\b")
palette = re.compile(r"\bTheme\s*::\s*new\s*\(")
for folder in ["src/features", "src/app"]:
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
# `platform/themes` evaluates installed Sub Theme CSS for `theme.rs`;
# everything else reads `Theme` or token fields. Test fixtures may spell out
# the colours they assert.
colour_literal = re.compile(r"\b(?:rgb|rgba|hsla|hsl)\s*\(|\b(?:Rgba|Hsla)\s*\{\s*[rh]\s*:|\"#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?\"")
colour_sources = {root / 'src/theme.rs', root / 'src/editor/tokens.rs'}
for path in (root / 'src').rglob('*.rs'):
    if (path in colour_sources or root / 'src/platform/themes' in path.parents
            or path.name == 'tests.rs' or path.name.endswith('_tests.rs')):
        continue
    for number, line in enumerate(path.read_text().splitlines(), 1):
        if colour_literal.search(line) and not line.lstrip().startswith('//'):
            errors.append(f'{path.relative_to(root)}:{number}: colour literal outside theme.rs')
# Crates: every source module belongs to one crate. `crates/*/lib.rs`
# mount theirs from src/ by `#[path]` (an inline module mounts a subtree's
# children), the window (`main.rs`) declares the rest; `bench.rs` holds the
# test helpers both the editor's and the window's benchmarks build.
mounted = {}
for lib in sorted((root / 'crates').glob('*/lib.rs')):
    for target, inline in re.findall(r'#\[path\s*=\s*"\.\./\.\./src/([^"]+)"\]\s*pub\s+mod\s+\w+\s*(\{[^}]*\})?',
                                     lib.read_text()):
        names = ([f'{target}/{child}' for child in re.findall(r'mod\s+(\w+)\s*;', inline)] if inline
                 else [re.sub(r'(/mod)?\.rs$', '', target)])
        for name in names:
            mounted.setdefault(name, []).append(lib.parent.name)
for name in re.findall(r'^(?:#\[[^\]]*\]\s*)*mod\s+(\w+)\s*;', (root / 'src/main.rs').read_text(), re.M):
    if name != 'bench':
        mounted.setdefault(name, []).append('the window')
for entry in sorted((root / 'src').iterdir()):
    name = entry.stem if entry.suffix == '.rs' else entry.name
    if name not in ('main', 'bench') and (entry.suffix == '.rs' or entry.is_dir()) and name not in mounted:
        errors.append(f'src/{entry.name}: mounted by no crate')
for name, crates in sorted(mounted.items()):
    if len(crates) > 1:
        errors.append(f'src/{name}: compiled by {", ".join(crates)}')
    parent, _, child = name.rpartition('/')
    if parent and re.search(rf'^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+{child}\s*;',
                            (root / 'src' / parent / 'mod.rs').read_text(), re.M):
        errors.append(f'src/{name}: declared again by src/{parent}/mod.rs')
if errors:
    raise SystemExit("\n".join(errors))
print("Native UI boundary guard passed (GPUI primitives, Markdown layers and retired framework guard)")
