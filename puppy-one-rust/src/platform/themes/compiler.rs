//! `theme-css-compiler.mjs`: validate one target of a Sub Theme the way the
//! product does (imports, at-rules, the light/dark contract, root-only public
//! tokens, selection-colour dependencies, assets) and keep its declarations
//! in cascade order for the native palette.
use super::{
    contract::{Mode, Target},
    css::{self, Decl, Node, Rule},
    value::{self, Tok},
};
use std::{collections::HashMap, collections::HashSet, sync::OnceLock};

/// Package-local resources, bounded by the theme's budget.
pub trait Loader {
    /// `(css, package-relative source path)` of an `@import`.
    fn import(&mut self, specifier: &str, importer: &str) -> Result<(String, String), String>;
    /// The MIME type of a package asset (`url(...)`), once reserved.
    fn asset(&mut self, specifier: &str, importer: &str) -> Result<&'static str, String>;
}

/// One rule's declarations in source order.
#[derive(Clone, Debug, PartialEq)]
pub struct Block {
    /// Every selector is a dark variant (`.dark .theme-root`).
    pub dark_only: bool,
    /// Inside `@media` / `@supports`, or nested: not evaluated natively.
    pub conditional: bool,
    pub declarations: Vec<(String, String)>,
}

#[derive(Debug)]
pub struct Compiled {
    pub blocks: Vec<Block>,
}

pub const APPLICATION_COLOR_TOKENS: &[&str] = &[
    "--po-surface-canvas",
    "--po-surface-chrome",
    "--po-surface-panel",
    "--po-surface-panel-raised",
    "--po-surface-overlay",
    "--po-surface-inset",
    "--po-surface-editor",
    "--po-surface-terminal",
    "--po-canvas",
    "--po-chrome",
    "--po-panel",
    "--po-panel-raised",
    "--po-overlay",
    "--po-inset",
    "--po-header",
    "--po-sidebar",
    "--po-control",
    "--po-control-hover",
    "--po-text",
    "--po-text-muted",
    "--po-text-subtle",
    "--po-text-disabled",
    "--po-text-inverse",
    "--po-border",
    "--po-border-strong",
    "--po-border-subtle",
    "--po-divider",
    "--po-shell-divider",
    "--po-header-divider",
    "--po-sidebar-divider",
    "--po-hover",
    "--po-selected",
    "--po-text-selection-bg",
    "--po-text-selection-inactive-bg",
    "--po-active",
    "--po-accent",
    "--po-accent-text",
    "--po-focus-ring",
    "--po-danger",
    "--po-info",
    "--po-success",
    "--po-success-contrast",
    "--po-warning",
    "--po-notification",
    "--po-notification-text",
    "--po-backdrop",
    "--po-backdrop-strong",
    "--po-shadow",
    "--po-text-fill-hover",
    "--po-skeleton-base",
    "--po-skeleton-shimmer",
    "--po-skeleton-edge",
    "--po-switch-border-on",
    "--po-switch-border-off",
    "--po-switch-thumb",
    "--po-switch-thumb-shadow",
    "--po-access-active-bg",
    "--po-access-active-hover",
    "--po-access-active-border",
    "--po-access-active-text",
    "--po-purple",
    "--po-project-card-tab",
    "--po-project-card-hover-bg",
    "--po-filetree-rail",
    "--po-tree-guide",
    "--po-file-icon-body",
    "--po-file-icon-fold",
    "--po-file-icon-stroke",
    "--po-file-icon-shadow",
    "--po-file-accent-default",
    "--po-file-accent-markdown",
    "--po-file-accent-json",
    "--po-file-accent-html",
    "--po-file-accent-pdf",
    "--po-file-accent-image",
    "--po-file-accent-audio",
    "--po-file-accent-video",
    "--po-file-accent-code",
    "--po-file-accent-word",
    "--po-file-accent-sheet",
    "--po-file-accent-presentation",
    "--po-diff-added-bg",
    "--po-diff-added-text",
    "--po-diff-removed-bg",
    "--po-diff-removed-text",
    "--po-editor-line",
    "--po-json-key",
    "--po-json-string",
    "--po-json-number",
    "--po-json-boolean",
    "--po-json-null",
    "--po-json-icon",
    "--po-scrollbar-thumb",
    "--po-scrollbar-thumb-hover",
    "--po-cloud-titlebar-bg",
    "--po-cloud-titlebar-text",
    "--po-cloud-titlebar-text-muted",
    "--po-cloud-titlebar-text-disabled",
    "--po-cloud-titlebar-hover",
    "--po-cloud-titlebar-active",
    "--po-cloud-titlebar-focus",
    "--po-terminal-cursor",
    "--po-terminal-selection",
    "--po-terminal-selection-inactive",
    "--po-terminal-black",
    "--po-terminal-red",
    "--po-terminal-green",
    "--po-terminal-yellow",
    "--po-terminal-blue",
    "--po-terminal-magenta",
    "--po-terminal-cyan",
    "--po-terminal-white",
    "--po-terminal-bright-black",
    "--po-terminal-bright-red",
    "--po-terminal-bright-green",
    "--po-terminal-bright-yellow",
    "--po-terminal-bright-blue",
    "--po-terminal-bright-magenta",
    "--po-terminal-bright-cyan",
    "--po-terminal-bright-white",
];

fn application_tokens() -> &'static HashSet<&'static str> {
    static SET: OnceLock<HashSet<&'static str>> = OnceLock::new();
    SET.get_or_init(|| APPLICATION_COLOR_TOKENS.iter().copied().collect())
}

/// `typographyTokenMap`: public size token → `(min, max)` pixels.
const TYPOGRAPHY: [(&str, u32, u32); 6] = [
    ("--po-text-size-interface", 11, 18),
    ("--po-text-size-content", 12, 24),
    ("--po-text-size-conversation", 12, 20),
    ("--po-text-size-data", 10, 18),
    ("--po-code-font-size", 10, 20),
    ("--po-terminal-font-size", 10, 20),
];

/// `csvTokenMap` keys.
const CSV: [&str; 14] = [
    "--po-editable-table-radius",
    "--po-csv-selection-bg",
    "--po-csv-selection-inactive-bg",
    "--po-csv-surface-background",
    "--po-csv-surface-color",
    "--po-editable-table-background",
    "--po-editable-table-border",
    "--po-editable-table-cell-border",
    "--po-editable-table-header-background",
    "--po-editable-table-sticky-header-background",
    "--csv-table-record-index-background",
    "--po-editable-table-cell-hover-background",
    "--po-editable-table-cell-focus-background",
    "--po-editable-table-cell-focus-ring",
];

/// `shared/markdown-theme-contract.json` (assets/themes/markdown-contract.json).
struct MarkdownContract {
    tokens: HashSet<String>,
    size_roles: Vec<String>,
    integer_sizes: HashSet<String>,
    presets: Vec<String>,
    default_preset: String,
    /// The Neutral defaults every theme's base rule is completed from.
    defaults: HashMap<String, String>,
}

fn markdown() -> &'static MarkdownContract {
    static CONTRACT: OnceLock<MarkdownContract> = OnceLock::new();
    CONTRACT.get_or_init(|| {
        #[derive(serde::Deserialize)]
        struct Token {
            name: String,
            #[serde(default, rename = "sizePresets")]
            size_presets: bool,
        }
        #[derive(serde::Deserialize)]
        struct Presets {
            choices: Vec<String>,
            default: String,
        }
        #[derive(serde::Deserialize)]
        struct File {
            tokens: Vec<Token>,
            #[serde(rename = "integerSizes")]
            integer_sizes: Vec<String>,
            #[serde(rename = "sizePresets")]
            size_presets: Presets,
        }
        let file: File = serde_json::from_str(include_str!(
            "../../../assets/themes/markdown-contract.json"
        ))
        .expect("Markdown theme contract");
        let presets = file.size_presets.choices;
        let mut integer_sizes: HashSet<String> = file.integer_sizes.iter().cloned().collect();
        for name in &file.integer_sizes {
            for preset in &presets {
                integer_sizes.insert(format!("{name}-{preset}"));
            }
        }
        let defaults_css = DEFAULT_MARKDOWN_CSS;
        let root = css::parse(defaults_css, "markdown-defaults.css").expect("Markdown defaults");
        let mut defaults = HashMap::new();
        for node in &root {
            if let Node::Rule(rule) = node
                && is_base_rule(rule)
            {
                for decl in css::decls(&rule.nodes) {
                    defaults.insert(decl.prop.clone(), decl.value.clone());
                }
            }
        }
        MarkdownContract {
            size_roles: file
                .tokens
                .iter()
                .filter(|t| t.size_presets)
                .map(|t| t.name.clone())
                .collect(),
            tokens: file.tokens.into_iter().map(|t| t.name).collect(),
            integer_sizes,
            presets,
            default_preset: file.size_presets.default,
            defaults,
        }
    })
}

/// `DEFAULT_MARKDOWN_THEME_CSS`: the Neutral Markdown profile new themes
/// start from and partial themes are completed with.
pub const DEFAULT_MARKDOWN_CSS: &str = include_str!("../../../assets/themes/markdown-defaults.css");

const ROOT_ALIASES: [&str; 5] = [".theme-root", ":root", "html", "body", "#write"];

fn is_base_rule(rule: &Rule) -> bool {
    css::split_selectors(&rule.selector)
        .iter()
        .any(|s| ROOT_ALIASES.contains(&s.trim()))
}

fn word_char(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_' || c == b'-'
}

/// `(?:^|[^a-z0-9_-])\.dark(?:[^a-z0-9_-]|$)`, case-insensitive.
pub fn has_dark_selector(selector: &str) -> bool {
    let lower = selector.to_ascii_lowercase();
    let bytes = lower.as_bytes();
    let mut from = 0;
    while let Some(found) = lower[from..].find(".dark") {
        let at = from + found;
        let before = at.checked_sub(1).map(|i| bytes[i]);
        let after = bytes.get(at + 5).copied();
        if before.is_none_or(|c| !word_char(c)) && after.is_none_or(|c| !word_char(c)) {
            return true;
        }
        from = at + 1;
    }
    false
}

fn starts_with_token(selector: &str, token: &str) -> bool {
    selector.starts_with(token)
        && selector[token.len()..]
            .chars()
            .next()
            .is_none_or(|c| c.is_whitespace() || ">+~:.#[]".contains(c))
}

/// `containsRootAlias`: the first occurrence of each alias, bounded.
fn contains_root_alias(selector: &str) -> bool {
    ROOT_ALIASES.iter().any(|alias| {
        let Some(index) = selector.find(alias) else {
            return false;
        };
        let previous = selector[..index].chars().next_back();
        let next = selector[index + alias.len()..].chars().next();
        previous.is_none_or(|c| c.is_whitespace() || ">+~,(".contains(c))
            && next.is_none_or(|c| c.is_whitespace() || ">+~:.#[],)".contains(c))
    })
}

fn dark_root_suffix(selector: &str) -> Result<Option<&str>, String> {
    let Some(nested) = selector.strip_prefix(".dark ") else {
        return Ok(None);
    };
    let nested = nested.trim_start();
    let Some(alias) = ROOT_ALIASES.iter().find(|a| starts_with_token(nested, a)) else {
        return Ok(None);
    };
    let suffix = &nested[alias.len()..];
    if contains_root_alias(suffix) {
        return Err(format!(
            "Theme CSS selector contains more than one root alias: {selector}."
        ));
    }
    Ok(Some(suffix))
}

fn is_application_root_selector(selector: &str) -> Result<bool, String> {
    let s = selector.trim();
    if ROOT_ALIASES.contains(&s) || ROOT_ALIASES.iter().any(|a| s == format!("{a}.dark")) {
        return Ok(true);
    }
    Ok(dark_root_suffix(s)?.is_some_and(str::is_empty))
}

fn parse_px(value: &str) -> Option<u32> {
    let digits = value.strip_suffix("px")?;
    (!digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()))
        .then(|| digits.parse().ok())
        .flatten()
}

/// `isSafeRelativePath`.
pub fn is_safe_relative_path(value: &str) -> bool {
    if value.is_empty() || value.encode_utf16().count() > 240 {
        return false;
    }
    if value.contains('\\') || value.starts_with('/') || value.starts_with('~') {
        return false;
    }
    // `^[a-z][a-z0-9+.-]*:` (a URL scheme).
    let scheme_end = value.find(':');
    if let Some(end) = scheme_end {
        let scheme = &value[..end];
        if scheme
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic())
            && scheme
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '.' | '-'))
        {
            return false;
        }
    }
    let normalized = value.strip_prefix("./").unwrap_or(value);
    normalized.split('/').all(|s| !s.is_empty())
}

fn import_specifier(params: &str) -> Option<String> {
    let value = params.trim();
    for q in ['"', '\''] {
        if let Some(inner) = value.strip_prefix(q).and_then(|v| v.strip_suffix(q))
            && !inner.is_empty()
            && !inner.contains(q)
        {
            return Some(inner.to_owned());
        }
    }
    let lower = value.to_ascii_lowercase();
    if lower.starts_with("url(") && value.ends_with(')') {
        let inner = value[4..value.len() - 1].trim();
        for q in ['"', '\''] {
            if let Some(quoted) = inner.strip_prefix(q).and_then(|v| v.strip_suffix(q)) {
                return (!quoted.is_empty() && !quoted.contains(q)).then(|| quoted.to_owned());
            }
        }
        return (!inner.is_empty()
            && !inner.contains(|c: char| c.is_whitespace() || "\"')".contains(c)))
        .then(|| inner.to_owned());
    }
    None
}

fn inline_imports(
    nodes: &mut Vec<Node>,
    source: &str,
    loader: &mut dyn Loader,
    ancestry: &[String],
    depth: usize,
) -> Result<(), String> {
    if depth > 8 {
        return Err("Theme CSS import depth exceeds the supported limit.".into());
    }
    let mut index = 0;
    while index < nodes.len() {
        if let Node::AtRule(rule) = &nodes[index]
            && rule.name == "import"
        {
            let specifier = import_specifier(&rule.params)
                .filter(|s| is_safe_relative_path(s) && s.to_lowercase().ends_with(".css"))
                .ok_or("Theme CSS imports must reference a package-local CSS file.")?;
            let (css_text, imported) = loader.import(&specifier, source)?;
            if ancestry.contains(&imported) {
                return Err(format!("Theme CSS import cycle detected at {imported}."));
            }
            let mut ancestry = ancestry.to_vec();
            ancestry.push(imported.clone());
            if depth + 1 > 8 {
                return Err("Theme CSS import depth exceeds the supported limit.".into());
            }
            let mut children = css::parse(&css_text, &imported)
                .map_err(|e| format!("Theme CSS could not be parsed: {e}"))?;
            inline_imports(&mut children, &imported, loader, &ancestry, depth + 1)?;
            let count = children.len();
            nodes.splice(index..=index, children);
            index += count;
            continue;
        }
        match &mut nodes[index] {
            Node::Rule(rule) => inline_imports(&mut rule.nodes, source, loader, ancestry, depth)?,
            Node::AtRule(rule) => {
                if let Some(children) = &mut rule.nodes {
                    inline_imports(children, source, loader, ancestry, depth)?;
                }
            }
            _ => {}
        }
        index += 1;
    }
    Ok(())
}

fn remove_charset(nodes: &mut Vec<Node>) {
    nodes.retain(|n| !matches!(n, Node::AtRule(r) if r.name == "charset"));
    for node in nodes {
        match node {
            Node::Rule(rule) => remove_charset(&mut rule.nodes),
            Node::AtRule(rule) => {
                if let Some(children) = &mut rule.nodes {
                    remove_charset(children);
                }
            }
            _ => {}
        }
    }
}

fn validate_mode_contract(
    nodes: &[Node],
    modes: Option<&[Mode]>,
    target: Target,
) -> Result<(), String> {
    for (rule, _) in css::at_rules(nodes) {
        if rule.name.eq_ignore_ascii_case("media")
            && rule
                .params
                .to_ascii_lowercase()
                .contains("prefers-color-scheme")
        {
            return Err(
                "Sub Themes must use their declared light/dark variants, not prefers-color-scheme."
                    .into(),
            );
        }
    }
    let Some(modes) = modes else { return Ok(()) };
    let rules = css::rules(nodes);
    let dark_rule = |rule: &Rule| rule.selector.split(',').any(has_dark_selector);
    let contains_dark = rules.iter().any(|(r, _)| dark_rule(r));
    let contains_declarations = !css::decls(nodes).is_empty();
    if target != Target::Typography
        && modes.contains(&Mode::Light)
        && modes.contains(&Mode::Dark)
        && contains_declarations
        && !contains_dark
    {
        return Err("A dual-mode Sub Theme target must declare explicit dark root tokens.".into());
    }
    if !modes.contains(&Mode::Dark) && rules.iter().any(|(r, _)| dark_rule(r)) {
        return Err("A light-only Sub Theme cannot declare dark selectors.".into());
    }
    Ok(())
}

/// `(?:^|[^a-z-])var\s*\(` or `light-dark\s*\(`, case-insensitive.
fn is_mode_adaptive(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    ["var", "light-dark"].iter().any(|name| {
        let mut from = 0;
        while let Some(found) = lower[from..].find(name) {
            let at = from + found;
            let before = lower[..at].bytes().next_back();
            let rest = lower[at + name.len()..].trim_start();
            if before.is_none_or(|c| !(c.is_ascii_lowercase() || c == b'-'))
                && rest.starts_with('(')
            {
                return true;
            }
            from = at + 1;
        }
        false
    })
}

fn validate_application_isolation(nodes: &[Node], modes: Option<&[Mode]>) -> Result<(), String> {
    let Some(modes) = modes else { return Ok(()) };
    if !(modes.contains(&Mode::Light) && modes.contains(&Mode::Dark)) {
        return Ok(());
    }
    let mut shared = std::collections::BTreeSet::new();
    let mut dark = HashSet::new();
    for (rule, _) in css::rules(nodes) {
        let selectors = css::split_selectors(&rule.selector);
        let has_shared = selectors.iter().any(|s| !has_dark_selector(s));
        let has_dark = selectors.iter().any(|s| has_dark_selector(s));
        for node in &rule.nodes {
            let Node::Decl(decl) = node else { continue };
            let property = decl.prop.to_lowercase();
            if !application_tokens().contains(property.as_str()) {
                continue;
            }
            if has_dark {
                dark.insert(property.clone());
            }
            if has_shared && !is_mode_adaptive(&decl.value) {
                shared.insert(property);
            }
        }
    }
    let leaking: Vec<String> = shared.into_iter().filter(|p| !dark.contains(p)).collect();
    if !leaking.is_empty() {
        return Err(format!(
            "A dual-mode Application Sub Theme must override static color tokens in its dark variant: {}.",
            leaking.join(", ")
        ));
    }
    Ok(())
}

fn validate_declarations(nodes: &[Node], target: Target, project: bool) -> Result<(), String> {
    let contract = markdown();
    for decl in css::decls(nodes) {
        let property = decl.prop.to_lowercase();
        let value = decl.value.trim().to_lowercase();
        if decl.important {
            return Err(
                "Theme CSS cannot use !important; cascade precedence is managed by PuppyOne."
                    .into(),
            );
        }
        match target {
            Target::Application if !application_tokens().contains(property.as_str()) => {
                return Err("Application Sub Themes may only declare public color tokens.".into());
            }
            Target::Typography => {
                let Some((_, min, max)) = TYPOGRAPHY.iter().find(|(n, ..)| *n == property) else {
                    return Err(
                        "Typography Sub Themes may only declare public typography size tokens."
                            .into(),
                    );
                };
                if !parse_px(&value).is_some_and(|size| size >= *min && size <= *max) {
                    return Err(format!(
                        "Typography token {property} must be a plain pixel value between {min}px and {max}px."
                    ));
                }
            }
            Target::Markdown => {
                if !contract.tokens.contains(&property) {
                    return Err(
                        "Markdown Sub Themes may only declare public Markdown tokens.".into(),
                    );
                }
                let alias = contract.size_roles.contains(&property)
                    && value == format!("var({property}-{})", contract.default_preset);
                let omitted =
                    !project && value.is_empty() && contract.integer_sizes.contains(&property);
                if contract.integer_sizes.contains(&property)
                    && !alias
                    && !omitted
                    && parse_px(&value).is_none()
                {
                    return Err(format!(
                        "Markdown size token {property} must be a plain integer pixel value."
                    ));
                }
            }
            Target::Csv if !CSV.contains(&property.as_str()) => {
                return Err("CSV Sub Themes may only declare public CSV tokens.".into());
            }
            _ => {}
        }
        if property == "position" && value == "fixed" {
            return Err("Theme CSS cannot use fixed positioning.".into());
        }
        if value.contains("expression(") || value.contains("-moz-binding") {
            return Err("Theme CSS contains an unsupported executable value.".into());
        }
    }
    Ok(())
}

/// `resolveMarkdownTypographyPresets`: complete the base rule from the
/// Neutral defaults; legacy single sizes become the default preset.
fn resolve_markdown_presets(nodes: &mut Vec<Node>) {
    let contract = markdown();
    let base_index = nodes
        .iter()
        .position(|n| matches!(n, Node::Rule(r) if is_base_rule(r)));
    let base_index = base_index.unwrap_or_else(|| {
        nodes.insert(
            0,
            Node::Rule(Rule {
                selector: ":root".into(),
                nodes: vec![],
            }),
        );
        0
    });
    let generated = |prop: &str, value: &str| {
        Node::Decl(Decl {
            prop: prop.into(),
            value: value.into(),
            important: false,
            file: "theme.css".into(),
        })
    };
    let mut visit = |rule: &mut Rule, is_base: bool| {
        for role in &contract.size_roles {
            let medium = format!("{role}-{}", contract.default_preset);
            let find = |rule: &Rule, name: &str| {
                rule.nodes
                    .iter()
                    .rposition(|n| matches!(n, Node::Decl(d) if d.prop.to_lowercase() == name))
            };
            let value_at = |rule: &Rule, i: usize| match &rule.nodes[i] {
                Node::Decl(d) => d.value.clone(),
                _ => String::new(),
            };
            if let Some(i) = find(rule, &medium)
                && value_at(rule, i).trim().is_empty()
            {
                rule.nodes.remove(i);
            }
            let legacy = find(rule, role);
            if let Some(i) = legacy {
                let value = value_at(rule, i);
                if !value.trim().is_empty()
                    && find(rule, &medium).is_none()
                    && value.trim() != format!("var({medium})")
                {
                    let mut migrated = rule.nodes[i].clone();
                    if let Node::Decl(d) = &mut migrated {
                        d.prop = medium.clone();
                    }
                    rule.nodes.push(migrated);
                }
            }
            for preset in &contract.presets {
                let name = format!("{role}-{preset}");
                if let Some(i) = find(rule, &name)
                    && value_at(rule, i).trim().is_empty()
                {
                    rule.nodes.remove(i);
                }
                if is_base && find(rule, &name).is_none() {
                    let default = contract.defaults.get(&name).cloned().unwrap_or_default();
                    rule.nodes.push(generated(&name, &default));
                }
            }
            match find(rule, role) {
                Some(i) => {
                    if let Node::Decl(d) = &mut rule.nodes[i] {
                        d.value = format!("var({medium})");
                    }
                }
                None if is_base => rule.nodes.push(generated(role, &format!("var({medium})"))),
                None => {}
            }
        }
    };
    fn walk(nodes: &mut [Node], base: Option<usize>, visit: &mut dyn FnMut(&mut Rule, bool)) {
        for (index, node) in nodes.iter_mut().enumerate() {
            match node {
                Node::Rule(rule) => {
                    visit(rule, base == Some(index));
                    walk(&mut rule.nodes, None, visit);
                }
                Node::AtRule(rule) => {
                    if let Some(children) = &mut rule.nodes {
                        walk(children, None, visit);
                    }
                }
                _ => {}
            }
        }
    }
    walk(nodes, Some(base_index), &mut visit);
}

const SELECTION_PAIRS: [(Target, &str, &str); 4] = [
    (
        Target::Application,
        "--po-text-selection-bg",
        "--po-text-selection-inactive-bg",
    ),
    (
        Target::Application,
        "--po-terminal-selection",
        "--po-terminal-selection-inactive",
    ),
    (
        Target::Markdown,
        "--po-md-selection-bg",
        "--po-md-selection-inactive-bg",
    ),
    (
        Target::Csv,
        "--po-csv-selection-bg",
        "--po-csv-selection-inactive-bg",
    ),
];

const SYSTEM_COLORS: [&str; 42] = [
    "accentcolor",
    "accentcolortext",
    "activetext",
    "buttonborder",
    "buttonface",
    "buttontext",
    "canvas",
    "canvastext",
    "field",
    "fieldtext",
    "graytext",
    "highlight",
    "highlighttext",
    "linktext",
    "mark",
    "marktext",
    "selecteditem",
    "selecteditemtext",
    "visitedtext",
    "activeborder",
    "activecaption",
    "appworkspace",
    "background",
    "buttonhighlight",
    "buttonshadow",
    "captiontext",
    "inactiveborder",
    "inactivecaption",
    "inactivecaptiontext",
    "infobackground",
    "infotext",
    "menu",
    "menutext",
    "scrollbar",
    "threeddarkshadow",
    "threedface",
    "threedhighlight",
    "threedlightshadow",
    "threedshadow",
    "window",
    "windowframe",
    "windowtext",
];

const COLOR_FUNCTIONS: [&str; 16] = [
    "rgb",
    "rgba",
    "hsl",
    "hsla",
    "hwb",
    "lab",
    "lch",
    "oklab",
    "oklch",
    "color",
    "color-mix",
    "light-dark",
    "calc",
    "min",
    "max",
    "clamp",
];

/// `<color>` (after `var()` has been replaced by a colour placeholder).
fn is_color(tokens: &[Tok]) -> bool {
    let [token] = tokens else { return false };
    match token {
        Tok::Hash(h) => {
            matches!(h.len(), 3 | 4 | 6 | 8) && h.chars().all(|c| c.is_ascii_hexdigit())
        }
        Tok::Ident(name) => {
            let lower = name.to_ascii_lowercase();
            lower == "transparent" || lower == "currentcolor" || value::named(&lower).is_some()
        }
        Tok::Func(name, args) => match name.to_ascii_lowercase().as_str() {
            "rgb" | "rgba" | "hsl" | "hsla" | "hwb" | "lab" | "lch" | "oklab" | "oklch"
            | "color" => {
                !args.is_empty() && args.iter().all(|t| !matches!(t, Tok::Str(_) | Tok::Url(_)))
            }
            "color-mix" => {
                let parts = value::groups(args);
                parts.len() >= 3
                    && matches!(parts[0].first(), Some(Tok::Ident(i)) if i.eq_ignore_ascii_case("in"))
                    && parts[1..].iter().all(|part| {
                        let colour: Vec<Tok> = part
                            .iter()
                            .filter(|t| !matches!(t, Tok::Num(_, unit) if unit == "%"))
                            .cloned()
                            .collect();
                        is_color(&colour)
                    })
            }
            "light-dark" => {
                let parts = value::groups(args);
                parts.len() == 2 && parts.iter().all(|p| is_color(p))
            }
            _ => false,
        },
        _ => false,
    }
}

struct Selection<'a> {
    public: &'a HashSet<String>,
    alternatives: HashMap<String, Vec<String>>,
    definite: HashSet<String>,
    values: HashMap<String, String>,
    optional_pairs: Vec<(&'static str, &'static str)>,
    optional: HashSet<&'static str>,
    visits: usize,
}

impl Selection<'_> {
    fn validate(&mut self, value: &str, ancestry: &[String]) -> Result<(), String> {
        self.visits += 1;
        if self.visits > 4096 || ancestry.len() > 32 || value.encode_utf16().count() > 16_384 {
            return Err("Selection color dependency limit exceeded.".into());
        }
        let not_color = || format!("Selection color must be a CSS color: {value}.");
        let mut tokens = value::tokenize(value).ok_or_else(not_color)?;
        self.replace_vars(&mut tokens, ancestry)?;
        fn check(tokens: &[Tok]) -> Result<(), String> {
            for token in tokens {
                match token {
                    Tok::Ident(name)
                        if SYSTEM_COLORS.contains(&name.to_ascii_lowercase().as_str()) =>
                    {
                        return Err(
                            "Selection colors cannot depend on operating-system colors.".into()
                        );
                    }
                    Tok::Func(name, args) => {
                        if !COLOR_FUNCTIONS.contains(&name.to_ascii_lowercase().as_str()) {
                            return Err(format!("Unsupported selection color function: {name}."));
                        }
                        check(args)?;
                    }
                    _ => {}
                }
            }
            Ok(())
        }
        check(&tokens)?;
        if !is_color(&tokens) {
            return Err(not_color());
        }
        Ok(())
    }
    fn replace_vars(&mut self, tokens: &mut [Tok], ancestry: &[String]) -> Result<(), String> {
        for token in tokens.iter_mut() {
            let Tok::Func(name, args) = token else {
                continue;
            };
            if !name.eq_ignore_ascii_case("var") {
                self.replace_vars(args, ancestry)?;
                continue;
            }
            let var = match args.first() {
                Some(Tok::Ident(var)) => var.clone(),
                _ => String::new(),
            };
            if !self.public.contains(&var) {
                return Err(format!(
                    "Selection color references unknown color token: {var}."
                ));
            }
            let fallback = args.len() > 1;
            let pair_active = self
                .optional_pairs
                .iter()
                .find(|(_, inactive)| var == *inactive)
                .map(|(active, _)| *active);
            let definitely = self.definite.contains(&var)
                || pair_active.is_some_and(|a| self.definite.contains(a))
                || (application_tokens().contains(var.as_str())
                    && !self.optional.contains(var.as_str()));
            if !definitely && !fallback {
                return Err(format!(
                    "Selection color requires a value or fallback for {var}."
                ));
            }
            if ancestry.contains(&var) {
                let mut chain = ancestry.to_vec();
                chain.push(var);
                return Err(format!(
                    "Selection color dependency cycle: {}.",
                    chain.join(" -> ")
                ));
            }
            let mut next = ancestry.to_vec();
            next.push(var.clone());
            if fallback {
                if args.len() < 3 || !matches!(args[1], Tok::Comma) {
                    return Err("Selection color contains an invalid var() fallback.".into());
                }
                let text = value::to_css(&args[2..]);
                self.validate(&text, &next)?;
            }
            let optional_missing = self.optional.contains(var.as_str())
                && !self.alternatives.contains_key(&var)
                && !pair_active.is_some_and(|a| self.alternatives.contains_key(a));
            if optional_missing {
                if !fallback {
                    return Err(format!(
                        "Selection color requires a value or fallback for {var}."
                    ));
                }
            } else if let Some(alternatives) = self.alternatives.get(&var).cloned() {
                for alternative in alternatives {
                    self.validate(&alternative, &next)?;
                }
            } else if let Some(value) = self.values.get(&var).cloned() {
                self.validate(&value, &next)?;
            } else if !application_tokens().contains(var.as_str()) && !fallback {
                return Err(format!(
                    "Selection color requires a value or fallback for {var}."
                ));
            }
            *token = Tok::Hash("000".into());
        }
        Ok(())
    }
}

fn validate_selection_colors(nodes: &[Node], target: Target) -> Result<(), String> {
    let pairs: Vec<(&str, &str)> = SELECTION_PAIRS
        .iter()
        .filter(|(t, ..)| *t == target)
        .map(|(_, a, i)| (*a, *i))
        .collect();
    if pairs.is_empty() {
        return Ok(());
    }
    let mut public: HashSet<String> = application_tokens()
        .iter()
        .map(|s| (*s).to_owned())
        .collect();
    if target == Target::Markdown {
        public.extend(
            markdown()
                .tokens
                .iter()
                .filter(|name| {
                    [
                        "color",
                        "background",
                        "selection-bg",
                        "selection-inactive-bg",
                    ]
                    .iter()
                    .any(|end| name.ends_with(end))
                        || name.rsplit_once("syntax-").is_some_and(|(_, tail)| {
                            !tail.is_empty() && tail.bytes().all(|b| b.is_ascii_lowercase())
                        })
                })
                .cloned(),
        );
    }
    if target == Target::Csv {
        public.extend(
            CSV.iter()
                .filter(|n| !n.ends_with("-radius"))
                .map(|n| (*n).to_owned()),
        );
    }
    struct Entry {
        dark: bool,
        property: String,
        value: String,
        unconditional: bool,
    }
    let mut common = HashMap::new();
    let mut dark = HashMap::new();
    let mut entries = Vec::new();
    for (rule, top) in css::rules(nodes) {
        let is_dark = has_dark_selector(&rule.selector);
        for node in &rule.nodes {
            let Node::Decl(decl) = node else { continue };
            if is_dark { &mut dark } else { &mut common }
                .insert(decl.prop.clone(), decl.value.clone());
            entries.push(Entry {
                dark: is_dark,
                property: decl.prop.clone(),
                value: decl.value.clone(),
                unconditional: top,
            });
        }
    }
    let mut defaults: Vec<(String, String)> = [
        ("--po-text-selection-bg", "var(--po-accent)"),
        (
            "--po-text-selection-inactive-bg",
            "var(--po-text-selection-bg)",
        ),
        ("--po-terminal-selection", "var(--po-text-selection-bg)"),
        (
            "--po-terminal-selection-inactive",
            "var(--po-terminal-selection)",
        ),
    ]
    .iter()
    .map(|(a, b)| ((*a).to_owned(), (*b).to_owned()))
    .collect();
    if target != Target::Application {
        for (active, inactive) in &pairs {
            defaults.push(((*active).into(), "var(--po-text-selection-bg)".into()));
            defaults.push(((*inactive).into(), format!("var({active})")));
        }
    }
    let selection: HashSet<&str> = pairs.iter().flat_map(|(a, i)| [*a, *i]).collect();
    let optional_pairs: Vec<(&'static str, &'static str)> = SELECTION_PAIRS
        .iter()
        .filter(|(_, active, _)| *active != "--po-text-selection-bg")
        .map(|(_, a, i)| (*a, *i))
        .collect();
    let optional: HashSet<&'static str> =
        optional_pairs.iter().flat_map(|(a, i)| [*a, *i]).collect();
    for in_dark in [false, true] {
        let mut values: HashMap<String, String> = defaults.iter().cloned().collect();
        values.extend(common.clone());
        if in_dark {
            values.extend(dark.clone());
        }
        let mut alternatives: HashMap<String, Vec<String>> = HashMap::new();
        let mut definite = HashSet::new();
        for entry in &entries {
            if entry.dark && !in_dark {
                continue;
            }
            let list = alternatives.entry(entry.property.clone()).or_default();
            if !list.contains(&entry.value) {
                list.push(entry.value.clone());
            }
            if entry.unconditional {
                definite.insert(entry.property.clone());
            }
        }
        for (active, inactive) in &optional_pairs {
            if !alternatives.contains_key(*inactive) {
                let source = if alternatives.contains_key(*active) {
                    *active
                } else {
                    "--po-text-selection-inactive-bg"
                };
                values.insert((*inactive).into(), format!("var({source})"));
            }
        }
        let mut state = Selection {
            public: &public,
            alternatives,
            definite,
            values,
            optional_pairs: optional_pairs.clone(),
            optional: optional.clone(),
            visits: 0,
        };
        for (active, inactive) in &pairs {
            for token in [*active, *inactive] {
                if optional.contains(token) && !state.alternatives.contains_key(token) {
                    continue;
                }
                let value = state.values.get(token).cloned().unwrap_or_default();
                state.validate(&value, &[token.to_owned()])?;
            }
        }
        for entry in &entries {
            if (!entry.dark || in_dark) && selection.contains(entry.property.as_str()) {
                state.validate(&entry.value, std::slice::from_ref(&entry.property))?;
            }
        }
    }
    Ok(())
}

fn complete_selection_pairs(nodes: &mut [Node], target: Target) {
    let pairs: Vec<(&str, &str)> = SELECTION_PAIRS
        .iter()
        .filter(|(t, ..)| *t == target)
        .map(|(_, a, i)| (*a, *i))
        .collect();
    css::for_each_mut(nodes, &mut |node| {
        let Node::Rule(rule) = node else { return };
        for (active, inactive) in &pairs {
            let has = |name: &str| {
                rule.nodes
                    .iter()
                    .any(|n| matches!(n, Node::Decl(d) if d.prop == name))
            };
            if has(active) && !has(inactive) {
                rule.nodes.push(Node::Decl(Decl {
                    prop: (*inactive).into(),
                    value: format!(
                        "color-mix(in srgb, var({active}) var(--po-text-selection-inactive-ratio), transparent)"
                    ),
                    important: false,
                    file: "theme.css".into(),
                }));
            }
        }
    });
}

/// `url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)` (case-insensitive).
fn urls(value: &str) -> Vec<(std::ops::Range<usize>, String)> {
    let lower = value.to_ascii_lowercase();
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(found) = lower[from..].find("url(") {
        let start = from + found;
        let body = start + 4;
        let rest = &value[body..];
        let ws = rest.len() - rest.trim_start().len();
        let inner = &rest[ws..];
        let quoted = inner
            .chars()
            .next()
            .filter(|c| *c == '"' || *c == '\'')
            .and_then(|q| {
                let close = inner[1..].find(q)? + 1;
                let after = &inner[close + 1..];
                let trailing = after.len() - after.trim_start().len();
                after.trim_start().starts_with(')').then(|| {
                    (
                        inner[1..close].to_owned(),
                        body + ws + close + 1 + trailing + 1,
                    )
                })
            });
        let matched = quoted.or_else(|| {
            let close = rest.find(')')?;
            Some((rest[..close].trim().to_owned(), body + close + 1))
        });
        let Some((specifier, end)) = matched else {
            break;
        };
        out.push((start..end, specifier.trim().to_owned()));
        from = end;
    }
    out
}

fn is_allowed_data_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    [
        "data:image/png;",
        "data:image/jpeg;",
        "data:image/gif;",
        "data:image/webp;",
        "data:image/svg+xml;",
        "data:font/woff;",
        "data:font/woff2;",
        "data:font/ttf;",
        "data:font/otf;",
    ]
    .iter()
    .any(|p| lower.starts_with(p))
}

fn rewrite_assets(nodes: &mut [Node], loader: &mut dyn Loader) -> Result<(), String> {
    let mut result = Ok(());
    css::for_each_mut(nodes, &mut |node| {
        if result.is_err() {
            return;
        }
        let Node::Decl(decl) = node else { return };
        let found = urls(&decl.value);
        if found.is_empty() {
            return;
        }
        let mut rewritten = String::new();
        let mut offset = 0;
        for (range, specifier) in found {
            let resolved = if specifier.starts_with("data:") {
                if !is_allowed_data_url(&specifier) || specifier.encode_utf16().count() > 512_000 {
                    result =
                        Err("Theme CSS data URLs must be bounded image or font assets.".into());
                    return;
                }
                specifier
            } else if !is_safe_relative_path(&specifier) {
                result = Err(format!(
                    "Theme CSS cannot load external asset URL: {specifier}."
                ));
                return;
            } else {
                match loader.asset(&specifier, &decl.file) {
                    Ok(mime) => format!("data:{mime};base64,"),
                    Err(e) => {
                        result = Err(e);
                        return;
                    }
                }
            };
            rewritten.push_str(&decl.value[offset..range.start]);
            rewritten.push_str(&format!("url(\"{}\")", resolved.replace('"', "\\\"")));
            offset = range.end;
        }
        rewritten.push_str(&decl.value[offset..]);
        decl.value = rewritten;
    });
    result
}

/// Compile one target. `modes` is `None` for a plain Markdown stylesheet.
pub fn compile(
    mut nodes: Vec<Node>,
    source: &str,
    target: Target,
    modes: Option<&[Mode]>,
    loader: &mut dyn Loader,
) -> Result<Compiled, String> {
    inline_imports(&mut nodes, source, loader, &[source.to_owned()], 0)?;
    remove_charset(&mut nodes);
    for (rule, _) in css::at_rules(&nodes) {
        let name = rule.name.to_lowercase();
        if name != "media" && name != "supports" {
            return Err(format!("Unsupported theme CSS at-rule: @{}.", rule.name));
        }
    }
    validate_mode_contract(&nodes, modes, target)?;
    if target == Target::Application {
        validate_application_isolation(&nodes, modes)?;
    }
    if target == Target::Markdown {
        validate_declarations(&nodes, target, false)?;
        resolve_markdown_presets(&mut nodes);
    }
    validate_selection_colors(&nodes, target)?;
    complete_selection_pairs(&mut nodes, target);
    for (rule, _) in css::rules(&nodes) {
        for selector in css::split_selectors(&rule.selector) {
            if !is_application_root_selector(&selector)? {
                return Err(format!(
                    "{} Sub Themes may only declare root-level public tokens.",
                    target.id()
                ));
            }
        }
    }
    rewrite_assets(&mut nodes, loader)?;
    validate_declarations(&nodes, target, true)?;
    let blocks = css::rules(&nodes)
        .into_iter()
        .map(|(rule, top)| Block {
            dark_only: css::split_selectors(&rule.selector)
                .iter()
                .all(|s| has_dark_selector(s)),
            conditional: !top,
            declarations: rule
                .nodes
                .iter()
                .filter_map(|n| match n {
                    Node::Decl(d) => Some((d.prop.clone(), d.value.clone())),
                    _ => None,
                })
                .collect(),
        })
        .collect();
    Ok(Compiled { blocks })
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    struct NoFiles;
    impl Loader for NoFiles {
        fn import(&mut self, s: &str, _: &str) -> Result<(String, String), String> {
            Err(format!("Theme CSS import cannot be loaded: {s}."))
        }
        fn asset(&mut self, s: &str, _: &str) -> Result<&'static str, String> {
            Err(format!("Theme CSS asset cannot be resolved: {s}."))
        }
    }
    fn run(css_text: &str, target: Target, modes: &[Mode]) -> Result<Compiled, String> {
        compile(
            css::parse(css_text, "theme.css").unwrap(),
            "theme.css",
            target,
            Some(modes),
            &mut NoFiles,
        )
    }
    const BOTH: [Mode; 2] = [Mode::Light, Mode::Dark];

    #[test]
    fn the_token_lists_match_the_product() {
        assert_eq!(application_tokens().len(), 120);
        assert_eq!(markdown().tokens.len(), 170);
        assert!(markdown().defaults.contains_key("--po-md-h1-size-medium"));
        assert!(has_dark_selector(".dark .theme-root") && has_dark_selector(":is(.dark) :root"));
        assert!(
            !has_dark_selector("html.dark")
                && !has_dark_selector(":root.dark")
                && !has_dark_selector(".darker")
        );
    }

    #[test]
    fn selection_colours_follow_their_dependencies() {
        let ok = run(
            ":root { --po-text-selection-bg: color-mix(in srgb, var(--po-accent) 30%, transparent); }\n.dark .theme-root { --po-accent: #fff; }",
            Target::Application,
            &BOTH,
        )
        .unwrap();
        assert_eq!(
            ok.blocks[0].declarations[1].0, "--po-text-selection-inactive-bg",
            "the inactive pair is completed"
        );
        let err = |css_text: &str| run(css_text, Target::Application, &[Mode::Light]).unwrap_err();
        assert_eq!(
            err(":root { --po-text-selection-bg: var(--po-terminal-selection); }"),
            "Selection color requires a value or fallback for --po-terminal-selection."
        );
        assert_eq!(
            err(":root { --po-text-selection-bg: env(x); }"),
            "Unsupported selection color function: env."
        );
        assert_eq!(
            err(":root { --po-text-selection-bg: 12px; }"),
            "Selection color must be a CSS color: 12px."
        );
        assert_eq!(
            err(
                ":root { --po-text-selection-bg: var(--po-text-selection-inactive-bg); --po-text-selection-inactive-bg: var(--po-text-selection-bg); }"
            ),
            "Selection color dependency cycle: --po-text-selection-bg -> --po-text-selection-inactive-bg -> --po-text-selection-bg."
        );
    }

    #[test]
    fn markdown_sizes_complete_from_the_neutral_defaults() {
        let compiled = run(
            ":root { --po-md-h1-size: 30px; }\n.dark .theme-root { --po-md-content-color: #fff; }",
            Target::Markdown,
            &BOTH,
        )
        .unwrap();
        let base = &compiled.blocks[0].declarations;
        let get = |name: &str| {
            base.iter()
                .find(|(p, _)| p == name)
                .map(|(_, v)| v.as_str())
        };
        assert_eq!(get("--po-md-h1-size"), Some("var(--po-md-h1-size-medium)"));
        assert_eq!(get("--po-md-h1-size-medium"), Some("30px"));
        assert!(get("--po-md-h1-size-small").is_some());
        assert_eq!(
            urls(r#"url( "a.woff2" ) , url(b.png), URL('c d')"#)
                .into_iter()
                .map(|(_, s)| s)
                .collect::<Vec<_>>(),
            ["a.woff2", "b.png", "c d"]
        );
        assert!(is_safe_relative_path("./fonts/a.woff2") && is_safe_relative_path("../a.css"));
        assert!(!is_safe_relative_path("https://x/a") && !is_safe_relative_path("a//b"));
    }
}
