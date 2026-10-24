//! Viewer Pack manifests, API v1: the strict validation of
//! `electron/main/viewer-packs/manifest-schema.mjs`, so a pack the product
//! accepts is accepted here and nothing else is.
use serde_json::Value;
use std::collections::BTreeSet;

pub const VIEWER_API_VERSION: &str = "1";
pub const SCHEMA_VERSION: u64 = 1;

/// Core viewer ids a pack may never claim as its own.
const RESERVED_CORE_VIEWER_IDS: &[&str] = &[
    "app-preview",
    "markdown",
    "json",
    "csv-table",
    "html-artifact",
    "image-preview",
    "pdf-preview",
    "office-preview",
    "audio-preview",
    "video-preview",
    "text",
    "document-placeholder",
    "binary-placeholder",
    "monaco-code",
    "plain-text",
    "markdown-editor",
];
const ALLOWED_RUNTIME: &[&str] = &["worker", "webgl", "webgpu", "wasm"];
const ALLOWED_SOURCE: &[&str] = &["range-resource", "resource", "none"];

/// `ViewerPackFormatContribution`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PackFormat {
    pub id: String,
    pub label: String,
    /// Normalised (`.glb`), sorted.
    pub extensions: Vec<String>,
    pub mime_types: Vec<String>,
    pub category: String,
    /// `plugin:<pack id>`.
    pub default_viewer: String,
}

/// `ViewerPackViewerContribution`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PackViewer {
    /// Pack-relative entry document.
    pub entry: String,
    pub source: String,
    pub runtime: Vec<String>,
}

/// A validated `ViewerPackManifest`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PackManifest {
    pub id: String,
    pub publisher: String,
    pub version: String,
    /// The npm range of host versions the pack supports.
    pub host_range: String,
    pub activation_events: Vec<String>,
    pub viewer: PackViewer,
    pub formats: Vec<PackFormat>,
    /// `metadata`, and `readRange` unless the viewer reads nothing.
    pub current_document: Vec<String>,
}

fn is_id(id: &str) -> bool {
    // `^[a-z][a-z0-9-]{0,62}(?:\.[a-z0-9][a-z0-9-]{0,62}){1,7}$`
    let parts: Vec<&str> = id.split('.').collect();
    let part = |p: &str, first_alpha: bool| {
        let mut chars = p.chars();
        match chars.next() {
            Some(c)
                if (if first_alpha {
                    c.is_ascii_lowercase()
                } else {
                    c.is_ascii_lowercase() || c.is_ascii_digit()
                }) => {}
            _ => return false,
        }
        p.len() <= 63 && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    };
    id.len() <= 255
        && (2..=8).contains(&parts.len())
        && part(parts[0], true)
        && parts[1..].iter().all(|p| part(p, false))
}
fn matches_class(
    text: &str,
    first: impl Fn(char) -> bool,
    rest: impl Fn(char) -> bool,
    max: usize,
) -> bool {
    let mut chars = text.chars();
    chars.next().is_some_and(first) && text.len() <= max && chars.all(rest)
}
fn is_publisher(p: &str) -> bool {
    // `^[a-z0-9][a-z0-9._-]{1,127}$`
    p.len() >= 2
        && matches_class(
            p,
            |c| c.is_ascii_lowercase() || c.is_ascii_digit(),
            |c| c.is_ascii_lowercase() || c.is_ascii_digit() || "._-".contains(c),
            128,
        )
}
fn is_format_id(id: &str) -> bool {
    matches_class(
        id,
        |c| c.is_ascii_lowercase() || c.is_ascii_digit(),
        |c| c.is_ascii_lowercase() || c.is_ascii_digit() || "._-".contains(c),
        64,
    )
}
fn is_extension(e: &str) -> bool {
    // `^\.[a-z0-9][a-z0-9._+-]{0,63}$`
    e.strip_prefix('.').is_some_and(|rest| {
        matches_class(
            rest,
            |c| c.is_ascii_lowercase() || c.is_ascii_digit(),
            |c| c.is_ascii_lowercase() || c.is_ascii_digit() || "._+-".contains(c),
            64,
        )
    })
}
fn is_mime(m: &str) -> bool {
    let token = |t: &str| {
        !t.is_empty()
            && t.chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || "!#$&^_.+-".contains(c))
    };
    m.split_once('/').is_some_and(|(a, b)| token(a) && token(b))
}
fn is_category(c: &str) -> bool {
    matches_class(
        c,
        |c| c.is_ascii_lowercase(),
        |c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-',
        32,
    )
}
fn is_display(text: &str, max: usize) -> bool {
    !text.trim().is_empty() && text.chars().count() <= max && !text.chars().any(|c| c.is_control())
}
/// `semver.valid(v) === v`: canonical versions only.
pub fn is_version(version: &str) -> bool {
    semver::Version::parse(version).is_ok_and(|v| v.to_string() == version)
}

/// `normalizePackRelativePath`.
pub fn normalize_relative_path(value: &str) -> Result<String, &'static str> {
    if value.trim().is_empty() || value.len() > 512 {
        return Err("empty-or-too-long");
    }
    let trimmed = value.trim().replace('\\', "/");
    let drive = trimmed.len() >= 2
        && trimmed.as_bytes()[0].is_ascii_alphabetic()
        && trimmed.as_bytes()[1] == b':';
    if trimmed.starts_with('/') || drive || trimmed.contains('\0') || trimmed.contains("//") {
        return Err("absolute-or-empty-segment");
    }
    let bad = |s: &str| {
        s.is_empty() || s == "." || s == ".." || s.len() > 255 || s.chars().any(|c| c.is_control())
    };
    if trimmed.split('/').any(bad) {
        return Err("traversal-or-control");
    }
    Ok(trimmed)
}

/// An npm version range (`>=0.1.2 <1.0.0`, `^1.2`, `1.x || 2.x`,
/// `1.0.0 - 2.0.0`) as the alternatives Rust's `semver` can evaluate.
pub fn host_range(range: &str) -> Option<Vec<semver::VersionReq>> {
    range
        .split("||")
        .map(|set| {
            let set = set.trim();
            let comparators = if let Some((low, high)) = set.split_once(" - ") {
                format!(">={}, <={}", low.trim(), high.trim())
            } else if set.is_empty() {
                "*".into()
            } else {
                // npm separates comparators with spaces; allow `>= 1.2`.
                let mut parts: Vec<String> = Vec::new();
                for token in set.split_whitespace() {
                    match parts.last_mut() {
                        Some(last)
                            if matches!(
                                last.as_str(),
                                ">" | ">=" | "<" | "<=" | "=" | "^" | "~"
                            ) =>
                        {
                            last.push_str(token)
                        }
                        _ => parts.push(token.to_owned()),
                    }
                }
                parts.join(", ")
            };
            semver::VersionReq::parse(&comparators).ok()
        })
        .collect()
}

/// `checkViewerPackEngineCompatibility`.
pub fn compatible(manifest: &PackManifest, host_version: &str) -> Result<(), &'static str> {
    let host = semver::Version::parse(host_version).map_err(|_| "host-version-invalid")?;
    let range = host_range(&manifest.host_range).ok_or("host-range-invalid")?;
    if range.iter().any(|req| req.matches(&host)) {
        Ok(())
    } else {
        Err("host-version-incompatible")
    }
}

fn strings(value: &Value) -> Option<Vec<String>> {
    value
        .as_array()?
        .iter()
        .map(|v| v.as_str().map(str::to_owned))
        .collect()
}
fn unique(values: &[String]) -> bool {
    values.iter().collect::<BTreeSet<_>>().len() == values.len()
}
fn reject_unknown(value: &Value, allowed: &[&str], code: &str, errors: &mut Vec<String>) {
    if value
        .as_object()
        .is_some_and(|o| o.keys().any(|k| !allowed.contains(&k.as_str())))
    {
        errors.push(code.into());
    }
}

/// `validateViewerPackManifest`: every rule failing is reported, codes as
/// the product's.
pub fn validate(raw: &Value) -> Result<PackManifest, Vec<String>> {
    let mut errors: Vec<String> = Vec::new();
    if !raw.is_object() {
        return Err(vec!["manifest-not-object".into()]);
    }
    reject_unknown(
        raw,
        &[
            "schemaVersion",
            "id",
            "publisher",
            "version",
            "engines",
            "activationEvents",
            "viewer",
            "formats",
            "permissions",
        ],
        "manifest-unknown-keys",
        &mut errors,
    );
    if raw["schemaVersion"].as_u64() != Some(SCHEMA_VERSION) {
        errors.push("schemaVersion-unsupported".into());
    }
    let id = raw["id"].as_str().unwrap_or_default();
    if !is_id(id) {
        errors.push("id-invalid".into());
    }
    let publisher = raw["publisher"].as_str().unwrap_or_default();
    if !is_publisher(publisher) {
        errors.push("publisher-invalid".into());
    }
    let version = raw["version"].as_str().unwrap_or_default();
    if !is_version(version) {
        errors.push("version-invalid".into());
    }
    // Engines.
    let engines = &raw["engines"];
    if !engines.is_object() {
        errors.push("engines-required".into());
    } else {
        reject_unknown(
            engines,
            &["puppyone", "viewerApi"],
            "engines-unknown-keys",
            &mut errors,
        );
        if engines["puppyone"].as_str().and_then(host_range).is_none() {
            errors.push("engines.puppyone-invalid".into());
        }
        if engines["viewerApi"].as_str() != Some(VIEWER_API_VERSION) {
            errors.push("engines.viewerApi-unsupported".into());
        }
    }
    // Viewer.
    let viewer = &raw["viewer"];
    let entry = viewer["entry"].as_str().map(normalize_relative_path);
    if !viewer.is_object() {
        errors.push("viewer-required".into());
    } else {
        reject_unknown(
            viewer,
            &["entry", "source", "sources", "runtime"],
            "viewer-unknown-keys",
            &mut errors,
        );
        match &entry {
            Some(Err(reason)) => errors.push(format!("viewer.entry-{reason}")),
            None => errors.push("viewer.entry-empty-or-too-long".into()),
            _ => {}
        }
        if !viewer["source"]
            .as_str()
            .is_some_and(|s| ALLOWED_SOURCE.contains(&s))
        {
            errors.push("viewer.source-invalid".into());
        }
        if strings(&viewer["sources"]).as_deref() != Some(&["local".to_owned()][..]) {
            errors.push("viewer.sources-must-be-local-only".into());
        }
        let runtime_ok = strings(&viewer["runtime"]).is_some_and(|r| {
            r.len() <= ALLOWED_RUNTIME.len()
                && unique(&r)
                && r.iter().all(|x| ALLOWED_RUNTIME.contains(&x.as_str()))
        });
        if !runtime_ok {
            errors.push("viewer.runtime-invalid".into());
        }
    }
    // Formats.
    let mut formats = Vec::new();
    match raw["formats"].as_array() {
        Some(list) if !list.is_empty() && list.len() <= 128 => {
            let mut seen = BTreeSet::new();
            for (index, format) in list.iter().enumerate() {
                let prefix = format!("formats[{index}]");
                if !format.is_object() {
                    errors.push(format!("{prefix}-invalid"));
                    continue;
                }
                reject_unknown(
                    format,
                    &[
                        "id",
                        "label",
                        "extensions",
                        "mimeTypes",
                        "category",
                        "defaultViewer",
                        "editable",
                    ],
                    &format!("{prefix}-unknown-keys"),
                    &mut errors,
                );
                let format_id = format["id"].as_str().unwrap_or_default();
                if !is_format_id(format_id) || !seen.insert(format_id.to_owned()) {
                    errors.push(format!("{prefix}.id-invalid"));
                }
                let label = format["label"].as_str().unwrap_or_default();
                if !is_display(label, 128) {
                    errors.push(format!("{prefix}.label-invalid"));
                }
                let extensions: Option<Vec<String>> = strings(&format["extensions"])
                    .map(|e| e.iter().map(|x| x.trim().to_lowercase()).collect());
                if !extensions.as_ref().is_some_and(|e| {
                    !e.is_empty() && e.len() <= 64 && unique(e) && e.iter().all(|x| is_extension(x))
                }) {
                    errors.push(format!("{prefix}.extensions-invalid"));
                }
                let mimes: Option<Vec<String>> = strings(&format["mimeTypes"])
                    .map(|m| m.iter().map(|x| x.trim().to_lowercase()).collect());
                if !mimes
                    .as_ref()
                    .is_some_and(|m| m.len() <= 64 && unique(m) && m.iter().all(|x| is_mime(x)))
                {
                    errors.push(format!("{prefix}.mimeTypes-invalid"));
                }
                let category = format["category"].as_str().unwrap_or_default();
                if !is_category(category) {
                    errors.push(format!("{prefix}.category-invalid"));
                }
                let default_viewer = format["defaultViewer"].as_str().unwrap_or_default();
                if default_viewer != format!("plugin:{id}") {
                    errors.push(format!("{prefix}.defaultViewer-must-match-plugin-id"));
                }
                if RESERVED_CORE_VIEWER_IDS.contains(&default_viewer.trim_start_matches("plugin:"))
                {
                    errors.push(format!("{prefix}.defaultViewer-reserved-core-id"));
                }
                if format["editable"] != Value::Bool(false) {
                    errors.push(format!("{prefix}.editable-must-be-false"));
                }
                let mut extensions = extensions.unwrap_or_default();
                extensions.sort();
                let mut mime_types = mimes.unwrap_or_default();
                mime_types.sort();
                formats.push(PackFormat {
                    id: format_id.to_owned(),
                    label: label.trim().to_owned(),
                    extensions,
                    mime_types,
                    category: category.to_owned(),
                    default_viewer: default_viewer.to_owned(),
                });
            }
        }
        _ => errors.push("formats-invalid-count".into()),
    }
    // Permissions.
    let permissions = &raw["permissions"];
    let current_document = strings(&permissions["currentDocument"]).unwrap_or_default();
    if !permissions.is_object() {
        errors.push("permissions-required".into());
    } else {
        reject_unknown(
            permissions,
            &["currentDocument", "relatedFiles", "network"],
            "permissions-unknown-keys",
            &mut errors,
        );
        let valid = strings(&permissions["currentDocument"]).is_some_and(|c| {
            unique(&c)
                && c.iter().all(|x| x == "metadata" || x == "readRange")
                && c.iter().any(|x| x == "metadata")
        });
        if !valid {
            errors.push("permissions.currentDocument-invalid".into());
        }
        if viewer["source"].as_str() != Some("none")
            && !current_document.iter().any(|x| x == "readRange")
        {
            errors.push("permissions.currentDocument-readRange-required".into());
        }
        // Related files and network access are not part of API v1.
        if permissions["relatedFiles"].as_str() != Some("none") {
            errors.push("permissions.relatedFiles-must-be-none-v1".into());
        }
        if !permissions["network"]
            .as_array()
            .is_some_and(|n| n.is_empty())
        {
            errors.push("permissions.network-must-be-empty-v1".into());
        }
    }
    // Activation events must be exactly the formats' extensions.
    let mut expected: Vec<String> = formats
        .iter()
        .flat_map(|f| f.extensions.iter().map(|e| format!("onFileExtension:{e}")))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    expected.sort();
    match strings(&raw["activationEvents"]) {
        Some(events) if unique(&events) => {
            if events.iter().any(|e| e == "*" || e == "onStartup") {
                errors.push("activationEvents-startup-forbidden".into());
            }
            let set: BTreeSet<_> = events.iter().collect();
            if set != expected.iter().collect() {
                errors.push("activationEvents-must-match-formats".into());
            }
        }
        _ => errors.push("activationEvents-invalid".into()),
    }
    if !errors.is_empty() {
        let mut seen = BTreeSet::new();
        errors.retain(|e| seen.insert(e.clone()));
        return Err(errors);
    }
    let mut runtime = strings(&viewer["runtime"]).unwrap_or_default();
    runtime.sort();
    let mut current_document = current_document;
    current_document.sort();
    Ok(PackManifest {
        id: id.to_owned(),
        publisher: publisher.to_owned(),
        version: version.to_owned(),
        host_range: engines["puppyone"].as_str().unwrap_or_default().to_owned(),
        activation_events: expected,
        viewer: PackViewer {
            entry: entry.and_then(Result::ok).unwrap_or_default(),
            source: viewer["source"].as_str().unwrap_or_default().to_owned(),
            runtime,
        },
        formats,
        current_document,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    /// The product's own example pack (`viewer-packs/glb/manifest.json`).
    fn glb() -> Value {
        serde_json::json!({
            "schemaVersion": 1,
            "id": "ai.puppyone.viewer.glb",
            "publisher": "puppyone",
            "version": "1.0.0",
            "engines": { "puppyone": ">=0.1.2 <1.0.0", "viewerApi": "1" },
            "activationEvents": ["onFileExtension:.glb"],
            "viewer": { "entry": "viewer.html", "source": "range-resource", "sources": ["local"], "runtime": [] },
            "formats": [{
                "id": "glb", "label": "glTF Binary Scene", "extensions": [".glb"],
                "mimeTypes": ["model/gltf-binary"], "category": "binary",
                "defaultViewer": "plugin:ai.puppyone.viewer.glb", "editable": false
            }],
            "permissions": { "currentDocument": ["metadata", "readRange"], "relatedFiles": "none", "network": [] }
        })
    }

    #[test]
    fn the_product_example_pack_is_valid_and_host_bound() {
        let manifest = validate(&glb()).unwrap();
        assert_eq!(manifest.viewer.entry, "viewer.html");
        assert_eq!(manifest.formats[0].extensions, vec![".glb"]);
        assert!(compatible(&manifest, "0.5.0").is_ok());
        assert_eq!(
            compatible(&manifest, "1.0.0"),
            Err("host-version-incompatible")
        );
        assert_eq!(
            compatible(&manifest, "0.1.1"),
            Err("host-version-incompatible")
        );
    }

    #[test]
    fn manifests_overreaching_api_v1_are_refused() {
        let refused = |edit: fn(&mut Value), code: &str| {
            let mut raw = glb();
            edit(&mut raw);
            let errors = validate(&raw).unwrap_err();
            assert!(errors.iter().any(|e| e == code), "{code}: {errors:?}");
        };
        refused(
            |m| m["permissions"]["network"] = serde_json::json!(["https://x.test"]),
            "permissions.network-must-be-empty-v1",
        );
        refused(
            |m| m["permissions"]["relatedFiles"] = "same-directory".into(),
            "permissions.relatedFiles-must-be-none-v1",
        );
        refused(
            |m| m["viewer"]["entry"] = "../escape.html".into(),
            "viewer.entry-traversal-or-control",
        );
        refused(
            |m| m["viewer"]["entry"] = "/abs.html".into(),
            "viewer.entry-absolute-or-empty-segment",
        );
        refused(
            |m| m["viewer"]["sources"] = serde_json::json!(["local", "cloud"]),
            "viewer.sources-must-be-local-only",
        );
        refused(
            |m| m["formats"][0]["defaultViewer"] = "plugin:other.pack".into(),
            "formats[0].defaultViewer-must-match-plugin-id",
        );
        refused(
            |m| m["formats"][0]["editable"] = true.into(),
            "formats[0].editable-must-be-false",
        );
        refused(
            |m| m["activationEvents"] = serde_json::json!(["onStartup"]),
            "activationEvents-startup-forbidden",
        );
        refused(
            |m| m["activationEvents"] = serde_json::json!(["onFileExtension:.gltf"]),
            "activationEvents-must-match-formats",
        );
        refused(|m| m["id"] = "single".into(), "id-invalid");
        refused(|m| m["version"] = "v1.0.0".into(), "version-invalid");
        refused(|m| m["surprise"] = true.into(), "manifest-unknown-keys");
    }

    #[test]
    fn npm_ranges_evaluate_like_the_product() {
        let ok = |range: &str, v: &str| {
            host_range(range)
                .unwrap()
                .iter()
                .any(|r| r.matches(&semver::Version::parse(v).unwrap()))
        };
        assert!(ok("^1.2.0", "1.9.0") && !ok("^1.2.0", "2.0.0"));
        assert!(ok("1.x || 3.x", "3.1.0") && !ok("1.x || 3.x", "2.0.0"));
        assert!(ok("1.0.0 - 2.0.0", "2.0.0") && !ok("1.0.0 - 2.0.0", "2.0.1"));
        assert!(ok(">= 0.1.0 < 0.2.0", "0.1.5"));
        assert!(host_range("not a range").is_none());
        assert_eq!(
            normalize_relative_path("dist\\viewer.html").unwrap(),
            "dist/viewer.html"
        );
    }
}
