//! Project an installed Sub Theme's Application declarations onto the native
//! palette (`Theme::from_tokens`), the way `tools/import-themes.mjs` projects
//! the built-in ones: the Neutral fallback sits underneath, the theme's
//! declarations cascade over it, and every `--po-*` the palette reads is
//! resolved to an sRGB colour.
use super::{css, value};
use std::{collections::HashMap, sync::OnceLock};

/// tools/css-tokens.mjs `PALETTE_TOKENS`.
pub const PALETTE_TOKENS: [&str; 75] = [
    "surface-canvas",
    "surface-chrome",
    "surface-panel",
    "surface-panel-raised",
    "surface-overlay",
    "surface-inset",
    "surface-editor",
    "canvas",
    "header",
    "sidebar",
    "text",
    "text-muted",
    "text-subtle",
    "text-disabled",
    "text-inverse",
    "border",
    "border-subtle",
    "border-strong",
    "divider",
    "hover",
    "active",
    "selected",
    "control",
    "control-hover",
    "focus-ring",
    "shadow",
    "backdrop",
    "backdrop-strong",
    "accent",
    "accent-text",
    "text-selection-bg",
    "success",
    "warning",
    "danger",
    "info",
    "purple",
    "notification",
    "tree-guide",
    "file-icon-body",
    "file-accent-default",
    "file-accent-markdown",
    "file-accent-json",
    "file-accent-html",
    "file-accent-pdf",
    "file-accent-image",
    "file-accent-audio",
    "file-accent-video",
    "file-accent-code",
    "file-accent-word",
    "file-accent-sheet",
    "file-accent-presentation",
    "diff-added-bg",
    "diff-added-text",
    "diff-removed-bg",
    "diff-removed-text",
    "terminal-cursor",
    "terminal-black",
    "terminal-red",
    "terminal-green",
    "terminal-yellow",
    "terminal-blue",
    "terminal-magenta",
    "terminal-cyan",
    "terminal-white",
    "terminal-bright-black",
    "terminal-bright-red",
    "terminal-bright-green",
    "terminal-bright-yellow",
    "terminal-bright-blue",
    "terminal-bright-magenta",
    "terminal-bright-cyan",
    "terminal-bright-white",
    "scrollbar-thumb",
    "scrollbar-thumb-hover",
    "skeleton-base",
];

/// tokens.css semantic aliases feature CSS reads instead of primitives.
const SEMANTIC_ALIASES: [(&str, &str); 7] = [
    ("--po-panel", "var(--po-surface-panel)"),
    ("--po-panel-raised", "var(--po-surface-panel-raised)"),
    ("--po-overlay", "var(--po-surface-overlay)"),
    ("--po-inset", "var(--po-surface-inset)"),
    ("--po-chrome", "var(--po-surface-chrome)"),
    ("--po-font-sans", "Geist, sans-serif"),
    ("--po-type-ui-micro", "11px"),
];

pub const NEUTRAL_CSS: &str = include_str!("../../../assets/themes/builtin/default-neutral.css");

pub type Declarations = Vec<(String, String)>;

/// The `:root` and `.dark .theme-root` blocks of a theme's
/// `@puppyone application` (`applicationBlocks` in tools/css-tokens.mjs).
pub fn application_blocks(text: &str) -> (Declarations, Declarations) {
    let Ok(root) = css::parse(text, "theme.css") else {
        return Default::default();
    };
    let application = root.iter().find_map(|node| match node {
        css::Node::AtRule(rule)
            if rule.name == "puppyone" && rule.params.trim() == "application" =>
        {
            rule.nodes.as_deref()
        }
        _ => None,
    });
    let block = |selector: &str| -> Declarations {
        application
            .and_then(|nodes| {
                nodes.iter().find_map(|node| match node {
                    css::Node::Rule(rule) if rule.selector == selector => Some(
                        rule.nodes
                            .iter()
                            .filter_map(|n| match n {
                                css::Node::Decl(d) => Some((d.prop.clone(), d.value.clone())),
                                _ => None,
                            })
                            .collect(),
                    ),
                    _ => None,
                })
            })
            .unwrap_or_default()
    };
    (block(":root"), block(".dark .theme-root"))
}

fn neutral() -> &'static (Declarations, Declarations) {
    static BLOCKS: OnceLock<(Declarations, Declarations)> = OnceLock::new();
    BLOCKS.get_or_init(|| application_blocks(NEUTRAL_CSS))
}

fn resolve(vars: &HashMap<&str, &str>, name: &str, dark: bool) -> Option<String> {
    let lookup = |var: &str| {
        vars.get(var).map(|v| (*v).to_owned()).or_else(|| {
            SEMANTIC_ALIASES
                .iter()
                .find(|(alias, _)| *alias == var)
                .map(|(_, v)| (*v).to_owned())
        })
    };
    let reference = value::tokenize(&format!("var(--po-{name})"))?;
    let substituted = value::substitute(&reference, &lookup, 0)?;
    value::color(&substituted, dark).map(value::format)
}

/// The palette tokens (`name` without `--po-`, formatted colour) of
/// `declared` (in cascade order) over the Neutral fallback. A token whose
/// value the native palette cannot evaluate keeps the Neutral value.
pub fn project(declared: &[(String, String)], dark: bool) -> HashMap<String, String> {
    let (light, dark_blocks) = neutral();
    let mut base: HashMap<&str, &str> = HashMap::new();
    for (k, v) in light
        .iter()
        .chain(if dark { &dark_blocks[..] } else { &[] })
    {
        base.insert(k.as_str(), v.as_str());
    }
    let mut vars: HashMap<&str, &str> = base.clone();
    for (k, v) in declared {
        vars.insert(k.as_str(), v.as_str());
    }
    PALETTE_TOKENS
        .iter()
        .map(|name| {
            let value = resolve(&vars, name, dark)
                .or_else(|| resolve(&base, name, dark))
                .unwrap_or_else(|| "#000000".into());
            ((*name).to_owned(), value)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn the_built_in_themes_project_exactly_as_the_importer_did() {
        #[derive(serde::Deserialize)]
        struct Pack {
            id: String,
            light: HashMap<String, String>,
            dark: HashMap<String, String>,
        }
        #[derive(serde::Deserialize)]
        struct File {
            packs: Vec<Pack>,
        }
        let file: File = serde_json::from_str(include_str!("../../../assets/themes.json")).unwrap();
        let sources = [
            ("default.neutral", NEUTRAL_CSS),
            (
                "default.warm",
                include_str!("../../../assets/themes/builtin/default-warm.css"),
            ),
            (
                "default.graphite",
                include_str!("../../../assets/themes/builtin/default-graphite.css"),
            ),
            (
                "default.github",
                include_str!("../../../assets/themes/builtin/default-github.css"),
            ),
            (
                "default.newspaper",
                include_str!("../../../assets/themes/builtin/default-newspaper.css"),
            ),
        ];
        let normal = |v: &str| {
            value::tokenize(v)
                .and_then(|t| value::color(&t, false))
                .map(value::format)
                .unwrap_or_else(|| panic!("{v}"))
        };
        assert_eq!(file.packs.len(), sources.len());
        for (id, text) in sources {
            let pack = file.packs.iter().find(|p| p.id == id).unwrap();
            let (light, dark) = application_blocks(text);
            let both: Declarations = light.iter().chain(dark.iter()).cloned().collect();
            for (expected, projected) in [
                (&pack.light, project(&light, false)),
                (&pack.dark, project(&both, true)),
            ] {
                assert_eq!(expected.len(), projected.len(), "{id}");
                for (name, value) in expected {
                    assert_eq!(normal(value), projected[name], "{id} {name}");
                }
            }
        }
    }
}
