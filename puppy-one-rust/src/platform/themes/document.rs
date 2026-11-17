//! A Sub Theme over the Markdown and CSV viewers' tokens, the way the
//! browser cascades it: the product's root tokens, the Neutral Application
//! fallback, the theme's Application declarations, the viewer's own host
//! rules (assets/editor/document-defaults.json, tools/import-document-
//! defaults.mjs), then the theme's Markdown (over the Markdown defaults) or
//! CSV declarations, and finally the text scale's size presets.
//!
//! The viewers keep the Chromium-resolved Neutral tokens; [`changed`] names
//! the ones whose substituted value under a theme differs from Neutral's,
//! with the theme's value to evaluate.
use super::{compiler, css, palette, service, value};
use std::{
    collections::HashMap,
    sync::{Arc, OnceLock},
};

pub type Declarations = Vec<(String, String)>;

/// Which viewer's host rules apply.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Host {
    Markdown,
    Csv,
}

/// A theme's document targets: `[light, dark]` declarations each (dark
/// carries the shared rules too), in cascade order.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Document {
    pub application: [Declarations; 2],
    pub markdown: [Declarations; 2],
    pub csv: [Declarations; 2],
}

impl Document {
    pub fn of(theme: &service::Theme) -> Self {
        Self {
            application: theme.application.clone().unwrap_or_default(),
            markdown: theme.markdown.clone().unwrap_or_default(),
            csv: theme.csv.clone().unwrap_or_default(),
        }
    }
}

/// The built-in Sub Themes' sources (`assets/themes/builtin`).
const BUILTIN: [(&str, &str); 5] = [
    (
        "default.neutral",
        include_str!("../../../assets/themes/builtin/default-neutral.css"),
    ),
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

/// A target's `:root` and `.dark .theme-root` declarations in a theme
/// source (`@puppyone <target> { … }`): `[light, light + dark]`.
fn blocks(root: &[css::Node], target: &str) -> [Declarations; 2] {
    let nodes = root.iter().find_map(|node| match node {
        css::Node::AtRule(rule) if rule.name == "puppyone" && rule.params.trim() == target => {
            rule.nodes.as_deref()
        }
        _ => None,
    });
    let rule = |selector: &str| -> Declarations {
        nodes
            .into_iter()
            .flatten()
            .filter_map(|node| match node {
                css::Node::Rule(rule) if rule.selector == selector => Some(css::decls(&rule.nodes)),
                _ => None,
            })
            .flatten()
            .map(|d| (d.prop.clone(), d.value.clone()))
            .collect()
    };
    let light = rule(":root");
    let mut dark = light.clone();
    dark.extend(rule(".dark .theme-root"));
    [light, dark]
}

/// A built-in Sub Theme's document targets.
pub fn builtin(id: &str) -> Option<Arc<Document>> {
    static ALL: OnceLock<HashMap<&'static str, Arc<Document>>> = OnceLock::new();
    ALL.get_or_init(|| {
        BUILTIN
            .iter()
            .filter_map(|(id, text)| {
                let root = css::parse(text, &format!("{id}.css")).ok()?;
                let document = Document {
                    application: blocks(&root, "application"),
                    markdown: blocks(&root, "markdown"),
                    csv: blocks(&root, "csv"),
                };
                Some((*id, Arc::new(document)))
            })
            .collect()
    })
    .get(id)
    .cloned()
}

#[derive(serde::Deserialize, Default)]
struct Scoped {
    root: HashMap<String, String>,
    host: HashMap<String, String>,
}
#[derive(serde::Deserialize)]
struct Defaults {
    markdown: Scoped,
    csv: Scoped,
}

fn defaults(host: Host) -> &'static Scoped {
    static ALL: OnceLock<Defaults> = OnceLock::new();
    let all = ALL.get_or_init(|| {
        serde_json::from_str(include_str!(
            "../../../assets/editor/document-defaults.json"
        ))
        .expect("document defaults")
    });
    match host {
        Host::Markdown => &all.markdown,
        Host::Csv => &all.csv,
    }
}

/// `DEFAULT_MARKDOWN_THEME_CSS`'s base rule: what every Markdown block is
/// completed from.
fn markdown_defaults() -> &'static Declarations {
    static DECLS: OnceLock<Declarations> = OnceLock::new();
    DECLS.get_or_init(|| {
        css::parse(compiler::DEFAULT_MARKDOWN_CSS, "markdown-defaults.css")
            .map(|nodes| {
                nodes
                    .iter()
                    .filter_map(|node| match node {
                        css::Node::Rule(rule) if rule.selector == ":root" => {
                            Some(css::decls(&rule.nodes))
                        }
                        _ => None,
                    })
                    .flatten()
                    .map(|d| (d.prop.clone(), d.value.clone()))
                    .collect()
            })
            .unwrap_or_default()
    })
}

/// Markdown size roles (`sizePresets` in the contract): `role` follows
/// `role-<scale>`.
fn size_roles() -> &'static [String] {
    static ROLES: OnceLock<Vec<String>> = OnceLock::new();
    ROLES.get_or_init(|| {
        #[derive(serde::Deserialize)]
        struct Token {
            name: String,
            #[serde(default, rename = "sizePresets")]
            size_presets: bool,
        }
        #[derive(serde::Deserialize)]
        struct File {
            tokens: Vec<Token>,
        }
        serde_json::from_str::<File>(include_str!(
            "../../../assets/themes/markdown-contract.json"
        ))
        .map(|f| {
            f.tokens
                .into_iter()
                .filter(|t| t.size_presets)
                .map(|t| t.name)
                .collect()
        })
        .unwrap_or_default()
    })
}

/// Every custom property a viewer sees under `document`, by name.
fn variables(host: Host, document: &Document, dark: bool, scale: &str) -> HashMap<String, String> {
    fn extend<'a>(
        vars: &mut HashMap<String, String>,
        decls: impl IntoIterator<Item = (&'a String, &'a String)>,
    ) {
        for (k, v) in decls {
            vars.insert(k.clone(), v.clone());
        }
    }
    let pairs = |decls: &'static Declarations| decls.iter().map(|(k, v)| (k, v));
    let mode = usize::from(dark);
    let scoped = defaults(host);
    let mut vars: HashMap<String, String> = palette::SEMANTIC_ALIASES
        .iter()
        .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
        .collect();
    extend(&mut vars, &scoped.root);
    let (light, dark_blocks) = palette::neutral();
    extend(&mut vars, pairs(light));
    if dark {
        extend(&mut vars, pairs(dark_blocks));
    }
    extend(
        &mut vars,
        document.application[mode].iter().map(|(k, v)| (k, v)),
    );
    extend(&mut vars, &scoped.host);
    match host {
        Host::Markdown => {
            extend(&mut vars, pairs(markdown_defaults()));
            extend(
                &mut vars,
                document.markdown[mode].iter().map(|(k, v)| (k, v)),
            );
            for role in size_roles() {
                let preset = format!("{role}-{scale}");
                if vars.contains_key(&preset) {
                    vars.insert(role.clone(), format!("var({preset})"));
                }
            }
        }
        Host::Csv => extend(&mut vars, document.csv[mode].iter().map(|(k, v)| (k, v))),
    }
    vars
}

/// `var(name)` substituted through `vars`, as CSS text. Where a variable
/// no stylesheet here declares has no fallback (the typography runtime's
/// `--po-font-locale-sans`), it stays as its name: it is the same under
/// every theme, and a font list still names its faces around it.
fn resolve(vars: &HashMap<String, String>, name: &str) -> Option<String> {
    let reference = value::tokenize(&format!("var({name})"))?;
    let strict = |var: &str| vars.get(var).cloned();
    let lenient = |var: &str| vars.get(var).cloned().or_else(|| Some(var.to_owned()));
    value::substitute(&reference, &strict, 0)
        .or_else(|| value::substitute(&reference, &lenient, 0))
        .map(|t| value::to_css(&t))
}

/// The tokens among `names` whose value under `document` differs from
/// Neutral's, each with the theme's substituted CSS value. `scale` is the
/// text scale preset (`small`, `medium`, `large`).
pub fn changed<'a>(
    host: Host,
    document: &Document,
    dark: bool,
    scale: &str,
    names: impl IntoIterator<Item = &'a str>,
) -> Vec<(String, String)> {
    let Some(neutral) = builtin("default.neutral") else {
        return Vec::new();
    };
    let base = variables(host, &neutral, dark, scale);
    let themed = variables(host, document, dark, scale);
    names
        .into_iter()
        .filter_map(|name| {
            let was = resolve(&base, name)?;
            let now = resolve(&themed, name)?;
            (was != now).then(|| (name.to_owned(), now))
        })
        .collect()
}

/// A substituted value as an sRGB colour (channels 0–255, alpha 0–1).
pub fn color(css: &str, dark: bool) -> Option<[f64; 4]> {
    value::color(&value::tokenize(css)?, dark)
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn neutral_changes_nothing_and_packs_change_their_tokens() {
        let neutral = builtin("default.neutral").unwrap();
        let names = [
            "--po-md-surface-background",
            "--po-md-content-color",
            "--po-editor-bg",
        ];
        for dark in [false, true] {
            assert!(changed(Host::Markdown, &neutral, dark, "medium", names).is_empty());
        }
        let newspaper = builtin("default.newspaper").unwrap();
        let light = changed(Host::Markdown, &newspaper, false, "medium", names);
        let surface = light
            .iter()
            .find(|(n, _)| n == "--po-md-surface-background")
            .map(|(_, v)| v.as_str());
        assert_eq!(surface, Some("#faf7f0"));
        assert_eq!(color("#faf7f0", false), Some([250., 247., 240., 1.]));
    }

    #[test]
    fn csv_tokens_follow_the_application_through_the_product_defaults() {
        // Warm declares no CSV block: its dark surface follows its editor
        // colour (its light one is Neutral's).
        let warm = builtin("default.warm").unwrap();
        let surface = ["--po-csv-surface-background"];
        assert!(super::changed(Host::Csv, &warm, false, "medium", surface).is_empty());
        let changed = changed(
            Host::Csv,
            &warm,
            true,
            "medium",
            ["--po-csv-surface-background"],
        );
        assert_eq!(changed.len(), 1, "{changed:?}");
        let github = builtin("default.github").unwrap();
        let declared = super::changed(
            Host::Csv,
            &github,
            true,
            "medium",
            ["--po-csv-surface-background"],
        );
        assert_eq!(
            declared,
            vec![("--po-csv-surface-background".into(), "#0d1117".into())]
        );
    }

    #[test]
    fn size_roles_follow_the_scale() {
        let newspaper = builtin("default.newspaper").unwrap();
        let vars = variables(Host::Markdown, &newspaper, false, "large");
        assert_eq!(
            resolve(&vars, "--po-md-content-size").as_deref(),
            Some("16px")
        );
    }
}
