//! The Sub Theme contracts: `theme.json` packages
//! (`theme-package-contract.mjs`) and self-describing single-file CSS
//! (`theme-single-file-contract.mjs`).
use super::css::{self, Node};
use serde_json::Value;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Target {
    Application,
    Typography,
    Markdown,
    Csv,
}
pub const TARGETS: [Target; 4] = [
    Target::Application,
    Target::Typography,
    Target::Markdown,
    Target::Csv,
];
impl Target {
    pub fn id(self) -> &'static str {
        match self {
            Self::Application => "application",
            Self::Typography => "typography",
            Self::Markdown => "markdown",
            Self::Csv => "csv",
        }
    }
    fn parse(value: &str) -> Option<Self> {
        TARGETS.into_iter().find(|t| t.id() == value)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Light,
    Dark,
}
impl Mode {
    pub fn id(self) -> &'static str {
        match self {
            Self::Light => "light",
            Self::Dark => "dark",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: Option<String>,
    pub modes: Vec<Mode>,
    pub targets: Vec<Target>,
    pub compatible_root_theme_ids: Vec<String>,
    /// Entrypoint per target, in `targets` order.
    pub entrypoints: Vec<(Target, String)>,
}

/// `^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*){2,}$`: a reverse-domain id with
/// at least three segments (two are reserved for built-in themes).
pub fn is_theme_id(id: &str) -> bool {
    let segments: Vec<&str> = id.split('.').collect();
    segments.len() >= 3 && segments.iter().all(|s| is_segment(s))
}
fn is_segment(s: &str) -> bool {
    let mut chars = s.chars();
    chars.next().is_some_and(|c| c.is_ascii_lowercase())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}
/// `^[a-z0-9]+(?:-[a-z0-9]+)*$`.
fn is_root_theme_id(id: &str) -> bool {
    !id.is_empty()
        && id.split('-').all(|p| {
            !p.is_empty()
                && p.chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        })
}
/// `^[A-Za-z0-9][A-Za-z0-9._-]*\.css$`.
fn is_entrypoint(value: &str) -> bool {
    value.len() > 4
        && value.ends_with(".css")
        && value
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphanumeric())
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

fn require_string(value: Option<&Value>, message: &str) -> Result<String, String> {
    match value.and_then(Value::as_str) {
        Some(s) if !s.trim().is_empty() && s.encode_utf16().count() <= 200 => {
            Ok(s.trim().to_owned())
        }
        _ => Err(message.to_owned()),
    }
}

fn unique_list<T: PartialEq + Copy>(
    value: Option<&Value>,
    parse: impl Fn(&str) -> Option<T>,
    prefix: &str,
    id: impl Fn(T) -> &'static str,
) -> Result<Vec<T>, String> {
    let items = match value.and_then(Value::as_array) {
        Some(items) if !items.is_empty() => items,
        _ => return Err(format!("{prefix}: at least one value is required.")),
    };
    let mut out = Vec::new();
    for item in items {
        let parsed = item.as_str().and_then(&parse).ok_or_else(|| {
            let shown = match item {
                Value::String(s) => s.clone(),
                Value::Null => "null".into(),
                Value::Array(_) => item
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .map(|v| v.as_str().map_or_else(|| v.to_string(), str::to_owned))
                            .collect::<Vec<_>>()
                            .join(",")
                    })
                    .unwrap_or_default(),
                Value::Object(_) => "[object Object]".into(),
                other => other.to_string(),
            };
            format!("{prefix}: {shown}.")
        })?;
        if out.contains(&parsed) {
            return Err(format!("{prefix}: duplicate {}.", id(parsed)));
        }
        out.push(parsed);
    }
    Ok(out)
}

/// `parseThemeManifest`.
pub fn parse_manifest(value: &Value) -> Result<Manifest, String> {
    let Some(object) = value.as_object() else {
        return Err("Theme manifest must be an object.".into());
    };
    if object.get("schemaVersion").and_then(Value::as_f64) != Some(1.) {
        return Err("Unsupported theme schema version; expected version 1.".into());
    }
    let id = require_string(object.get("id"), "Theme id is required.")?;
    if !is_theme_id(&id) {
        return Err("Theme id must be a reverse-domain identifier using lowercase letters, digits, dots, and hyphens.".into());
    }
    let name = require_string(object.get("name"), "Theme name is required.")?;
    let version = require_string(object.get("version"), "Theme version is required.")?;
    let author = match object.get("author") {
        None => None,
        Some(value) => Some(require_string(
            Some(value),
            "Theme author must be a non-empty string.",
        )?),
    };
    let modes = unique_list(
        object.get("modes"),
        |s| match s {
            "light" => Some(Mode::Light),
            "dark" => Some(Mode::Dark),
            _ => None,
        },
        "Unsupported theme color mode",
        Mode::id,
    )?;
    let targets = unique_list(
        object.get("targets"),
        Target::parse,
        "Unsupported theme target",
        Target::id,
    )?;
    let compatible_root_theme_ids = match object.get("compatibleRootThemeIds") {
        None => vec!["default".to_owned()],
        Some(value) => {
            let ids: Option<Vec<String>> = value.as_array().and_then(|items| {
                items
                    .iter()
                    .map(|v| {
                        v.as_str()
                            .filter(|s| is_root_theme_id(s))
                            .map(str::to_owned)
                    })
                    .collect()
            });
            match ids {
                Some(ids)
                    if !ids.is_empty()
                        && ids.iter().collect::<std::collections::HashSet<_>>().len()
                            == ids.len() =>
                {
                    ids
                }
                _ => {
                    return Err("compatibleRootThemeIds must contain unique Root Theme ids.".into());
                }
            }
        }
    };
    let Some(entrypoints) = object.get("entrypoints").and_then(Value::as_object) else {
        return Err("Theme entrypoints must be an object.".into());
    };
    let mut declared = Vec::new();
    for (key, entry) in entrypoints {
        let target =
            Target::parse(key).ok_or_else(|| format!("Unsupported theme target: {key}."))?;
        if !entry.as_str().is_some_and(is_entrypoint) {
            return Err("Theme entrypoint must be a direct relative CSS filename.".into());
        }
        declared.push(target);
    }
    if targets.len() != declared.len() || targets.iter().any(|t| !declared.contains(t)) {
        return Err("Theme targets and entrypoints must match.".into());
    }
    let entrypoints = targets
        .iter()
        .map(|t| {
            (
                *t,
                entrypoints[t.id()].as_str().unwrap_or_default().to_owned(),
            )
        })
        .collect();
    Ok(Manifest {
        id,
        name,
        version,
        author,
        modes,
        targets,
        compatible_root_theme_ids,
        entrypoints,
    })
}

/// A coordinated single-file theme: its manifest and each target block.
#[derive(Clone, Debug)]
pub struct SingleFile {
    pub manifest: Manifest,
    pub stylesheets: Vec<(Target, Vec<Node>)>,
}

const METADATA: [&str; 6] = [
    "id",
    "name",
    "version",
    "author",
    "modes",
    "compatible-root-themes",
];

/// `parseSingleFileThemeCss`: `None` when the file carries no
/// `@puppyone-theme` block (a plain Markdown stylesheet).
pub fn parse_single_file(css_text: &str, source: &str) -> Result<Option<SingleFile>, String> {
    let root =
        css::parse(css_text, source).map_err(|e| format!("Theme CSS could not be parsed: {e}"))?;
    let is = |node: &Node, name: &str| matches!(node, Node::AtRule(r) if r.name.eq_ignore_ascii_case(name));
    let metadata: Vec<&Node> = root.iter().filter(|n| is(n, "puppyone-theme")).collect();
    let metadata = match metadata.as_slice() {
        [] => return Ok(None),
        [one] => *one,
        _ => {
            return Err(
                "A single-file theme must contain exactly one @puppyone-theme block.".into(),
            );
        }
    };
    let Node::AtRule(metadata) = metadata else {
        unreachable!()
    };
    let Some(metadata_nodes) = metadata
        .nodes
        .as_ref()
        .filter(|_| metadata.params.is_empty())
    else {
        return Err("@puppyone-theme must be a top-level declaration block.".into());
    };
    let mut blocks: Vec<(Target, Vec<Node>)> = Vec::new();
    for node in &root {
        match node {
            Node::Comment => continue,
            Node::AtRule(rule) if rule.name.eq_ignore_ascii_case("puppyone-theme") => continue,
            Node::AtRule(rule) if rule.name.eq_ignore_ascii_case("charset") => continue,
            Node::AtRule(rule) if rule.name.eq_ignore_ascii_case("puppyone") => {
                let name = rule.params.trim().to_lowercase();
                let target = Target::parse(&name).ok_or_else(|| {
                    format!(
                        "Unsupported theme target: {}.",
                        if name.is_empty() { "(empty)" } else { &name }
                    )
                })?;
                let Some(nodes) = &rule.nodes else {
                    return Err(format!("@puppyone {name} must be a top-level CSS block."));
                };
                if blocks.iter().any(|(t, _)| *t == target) {
                    return Err(format!("Duplicate theme target: {name}."));
                }
                blocks.push((target, nodes.clone()));
            }
            _ => {
                return Err("Coordinated theme CSS rules must be inside a top-level @puppyone target block.".into());
            }
        }
    }
    for (rule, top) in css::at_rules(&root) {
        let name = rule.name.to_lowercase();
        if (name == "puppyone" || name == "puppyone-theme") && !top {
            return Err("PuppyOne control blocks must be top-level.".into());
        }
    }
    let mut fields = serde_json::Map::new();
    for node in metadata_nodes {
        let decl = match node {
            Node::Comment => continue,
            Node::Decl(decl) => decl,
            _ => return Err("@puppyone-theme may contain metadata declarations only.".into()),
        };
        let property = decl.prop.trim().to_lowercase();
        if !METADATA.contains(&property.as_str()) {
            return Err(format!("Unsupported theme metadata property: {property}."));
        }
        if fields.contains_key(&property) {
            return Err(format!("Duplicate theme metadata property: {property}."));
        }
        fields.insert(property, Value::String(decl.value.trim().to_owned()));
    }
    let targets: Vec<Target> = TARGETS
        .into_iter()
        .filter(|t| blocks.iter().any(|(b, _)| b == t))
        .collect();
    if targets.is_empty() {
        return Err("A single-file theme must declare at least one target.".into());
    }
    let words = |key: &str| {
        fields.get(key).and_then(Value::as_str).map(|s| {
            Value::Array(
                s.split_whitespace()
                    .map(|w| Value::String(w.to_owned()))
                    .collect(),
            )
        })
    };
    let mut manifest = serde_json::Map::new();
    manifest.insert("schemaVersion".into(), 1.into());
    for key in ["id", "name", "version", "author"] {
        if let Some(value) = fields.get(key) {
            manifest.insert(key.into(), value.clone());
        }
    }
    if let Some(modes) = words("modes") {
        manifest.insert("modes".into(), modes);
    }
    if let Some(ids) = words("compatible-root-themes") {
        manifest.insert("compatibleRootThemeIds".into(), ids);
    }
    manifest.insert(
        "targets".into(),
        Value::Array(targets.iter().map(|t| t.id().into()).collect()),
    );
    manifest.insert(
        "entrypoints".into(),
        Value::Object(
            targets
                .iter()
                .map(|t| (t.id().to_owned(), Value::String(format!("{}.css", t.id()))))
                .collect(),
        ),
    );
    let manifest = parse_manifest(&Value::Object(manifest))?;
    let stylesheets = TARGETS
        .into_iter()
        .filter_map(|t| {
            let index = blocks.iter().position(|(b, _)| *b == t)?;
            Some((t, blocks[index].1.clone()))
        })
        .collect();
    Ok(Some(SingleFile {
        manifest,
        stylesheets,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn manifests_follow_the_package_contract() {
        let ok = serde_json::json!({
            "schemaVersion": 1, "id": "local.user.ok", "name": " Ok ", "version": "1",
            "modes": ["light"], "targets": ["csv", "application"],
            "entrypoints": {"application": "a.css", "csv": "c.css"}
        });
        let manifest = parse_manifest(&ok).unwrap();
        assert_eq!(manifest.name, "Ok");
        assert_eq!(manifest.compatible_root_theme_ids, ["default"]);
        assert_eq!(
            manifest.entrypoints,
            [
                (Target::Csv, "c.css".to_owned()),
                (Target::Application, "a.css".to_owned())
            ]
        );
        let with = |key: &str, value: Value| {
            let mut v = ok.clone();
            v[key] = value;
            parse_manifest(&v).unwrap_err()
        };
        assert_eq!(
            with("schemaVersion", 2.into()),
            "Unsupported theme schema version; expected version 1."
        );
        assert_eq!(
            with("modes", serde_json::json!(["light", "light"])),
            "Unsupported theme color mode: duplicate light."
        );
        assert_eq!(
            with("targets", serde_json::json!(["ink"])),
            "Unsupported theme target: ink."
        );
        assert_eq!(
            with("targets", serde_json::json!(["csv"])),
            "Theme targets and entrypoints must match."
        );
        assert_eq!(
            with(
                "entrypoints",
                serde_json::json!({"application": "../a.css", "csv": "c.css"})
            ),
            "Theme entrypoint must be a direct relative CSS filename."
        );
        assert_eq!(
            with("compatibleRootThemeIds", serde_json::json!([])),
            "compatibleRootThemeIds must contain unique Root Theme ids."
        );
        assert!(is_theme_id("local.user.x-1") && !is_theme_id("default.neutral"));
    }
}
