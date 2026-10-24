//! The canonical file format registry: a port of
//! `packages/shared-ui/src/core/fileFormats.ts` over the product's own table
//! (`assets/formats/file-formats.json`, imported by
//! `tools/import-formats.py`). Pure: no GPUI, no I/O.
//!
//! Every registry that picks behaviour by file type — editor viewers
//! (`editor::registry`), diff renderers, file icons — resolves the format
//! here first and then matches on its fields, never on raw extensions.
use serde::Deserialize;
use std::{
    collections::{BTreeMap, HashMap},
    sync::OnceLock,
};

/// `FileCategory`.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Category {
    Image,
    Audio,
    Video,
    App,
    Markdown,
    Text,
    Code,
    Data,
    Document,
    Archive,
    Binary,
}

/// `FileFormat`.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileFormat {
    pub id: String,
    pub label: String,
    /// Explicit semantic identity for formats whose product family matters.
    #[serde(default)]
    pub semantic_kind: Option<String>,
    #[serde(default)]
    pub filenames: Vec<String>,
    #[serde(default)]
    pub filename_patterns: Vec<String>,
    #[serde(default)]
    pub extensions: Vec<String>,
    #[serde(default)]
    pub mime_types: Vec<String>,
    /// Preferred MIME keyed by the registered extension (with its dot).
    #[serde(default)]
    pub mime_types_by_extension: BTreeMap<String, String>,
    pub category: Category,
    /// The format's `ViewerId` (`markdown-editor`, `image-preview`, …).
    pub default_viewer: String,
    #[serde(default)]
    pub available_viewers: Vec<String>,
    pub editable: bool,
    pub ingest_strategy: String,
    #[serde(default)]
    pub monaco_language: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Table {
    formats: Vec<FileFormat>,
    unknown_format: FileFormat,
}

struct Registry {
    formats: Vec<FileFormat>,
    unknown: FileFormat,
    image_unknown: FileFormat,
    text_unknown: FileFormat,
    by_filename: HashMap<String, usize>,
    by_extension: HashMap<String, usize>,
    by_mime: HashMap<String, usize>,
    patterns: Vec<(String, usize)>,
}

fn registry() -> &'static Registry {
    static REGISTRY: OnceLock<Registry> = OnceLock::new();
    REGISTRY.get_or_init(|| {
        let table: Table =
            serde_json::from_str(include_str!("../../assets/formats/file-formats.json"))
                .expect("imported format registry");
        // Later entries win, like the product's `Map.set` indexes.
        let mut registry = Registry {
            by_filename: HashMap::new(),
            by_extension: HashMap::new(),
            by_mime: HashMap::new(),
            patterns: Vec::new(),
            image_unknown: FileFormat {
                id: "image-unknown".into(),
                label: "Image".into(),
                category: Category::Image,
                default_viewer: "image-preview".into(),
                ..table.unknown_format.clone()
            },
            text_unknown: FileFormat {
                id: "text-unknown".into(),
                label: "Text".into(),
                category: Category::Text,
                default_viewer: "plain-text".into(),
                editable: true,
                monaco_language: Some("plaintext".into()),
                ..table.unknown_format.clone()
            },
            unknown: table.unknown_format,
            formats: table.formats,
        };
        for (index, format) in registry.formats.iter().enumerate() {
            for name in &format.filenames {
                registry.by_filename.insert(name.to_lowercase(), index);
            }
            for pattern in &format.filename_patterns {
                registry.patterns.push((pattern.to_lowercase(), index));
            }
            for extension in &format.extensions {
                registry
                    .by_extension
                    .insert(extension.to_lowercase(), index);
            }
            for mime in &format.mime_types {
                registry.by_mime.insert(mime.to_lowercase(), index);
            }
        }
        registry
    })
}

/// Every registered format, in registry order (`FILE_FORMATS`).
pub fn all() -> &'static [FileFormat] {
    &registry().formats
}
/// `UNKNOWN_FORMAT`: an opaque binary with the placeholder viewer.
pub fn unknown() -> &'static FileFormat {
    &registry().unknown
}

fn basename(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}
fn normalize_mime(mime: &str) -> String {
    mime.split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_lowercase()
}

/// `resolveFileFormat`: exact filename, then the longest registered
/// extension (`.d.ts` before `.ts`), then filename patterns (directory
/// qualified, like Git rebase state), then MIME type; unknown otherwise.
pub fn resolve(name: Option<&str>, mime: Option<&str>) -> &'static FileFormat {
    let registry = registry();
    if let Some(name) = name.filter(|n| !n.is_empty()) {
        let base = basename(name).to_lowercase();
        if let Some(&index) = registry.by_filename.get(&base) {
            return &registry.formats[index];
        }
        if let Some(format) = match_extension(&base) {
            return format;
        }
        let normalized = name.replace('\\', "/").to_lowercase();
        let base = basename(&normalized);
        for (pattern, index) in &registry.patterns {
            if glob(pattern, &normalized) || glob(pattern, base) {
                return &registry.formats[*index];
            }
        }
    }
    if let Some(mime) = mime {
        let mime = normalize_mime(mime);
        if let Some(&index) = registry.by_mime.get(&mime) {
            return &registry.formats[index];
        }
        if mime.starts_with("image/") {
            return &registry.image_unknown;
        }
        if mime.starts_with("text/")
            || mime == "application/javascript"
            || mime == "application/typescript"
        {
            return &registry.text_unknown;
        }
    }
    &registry.unknown
}
/// Shorthand for a file name without a MIME type.
pub fn of(name: &str) -> &'static FileFormat {
    resolve(Some(name), None)
}

/// `getMatchedExtension`: compound registered extensions (`.d.ts`) win.
pub fn matched_extension(name: &str) -> Option<String> {
    let lower = basename(name).to_lowercase();
    let last = lower.rfind('.')?;
    if let Some(second) = lower[..last].rfind('.')
        && registry().by_extension.contains_key(&lower[second..])
    {
        return Some(lower[second + 1..].to_owned());
    }
    Some(lower[last + 1..].to_owned())
}
/// `globPatternToRegExp`: `**/` → `(?:.*/)?`, `**` → `.*`, `*` → `[^/]*`,
/// `?` → `[^/]`; the whole text must match.
pub fn glob(pattern: &str, text: &str) -> bool {
    fn go(p: &[u8], t: &[u8]) -> bool {
        match p.first() {
            None => t.is_empty(),
            Some(b'*') if p.starts_with(b"**/") => {
                (0..=t.len()).any(|i| (i == 0 || t[i - 1] == b'/') && go(&p[3..], &t[i..]))
            }
            Some(b'*') if p.starts_with(b"**") => (0..=t.len()).any(|i| go(&p[2..], &t[i..])),
            Some(b'*') => (0..=t.len())
                .take_while(|&i| i == 0 || t[i - 1] != b'/')
                .any(|i| go(&p[1..], &t[i..])),
            Some(b'?') => !t.is_empty() && t[0] != b'/' && go(&p[1..], &t[1..]),
            Some(c) => t.first() == Some(c) && go(&p[1..], &t[1..]),
        }
    }
    go(pattern.as_bytes(), text.as_bytes())
}

fn match_extension(lower_base: &str) -> Option<&'static FileFormat> {
    let registry = registry();
    let last = lower_base.rfind('.')?;
    if let Some(second) = lower_base[..last].rfind('.')
        && let Some(&index) = registry.by_extension.get(&lower_base[second..])
    {
        return Some(&registry.formats[index]);
    }
    registry
        .by_extension
        .get(&lower_base[last..])
        .map(|&index| &registry.formats[index])
}

impl FileFormat {
    /// `isKnownFileFormat`.
    pub fn is_known(&self) -> bool {
        self.id != unknown().id
    }
    /// `getSemanticKindForFormat`.
    pub fn semantic_kind(&self) -> &str {
        if let Some(kind) = &self.semantic_kind {
            return kind;
        }
        match self.default_viewer.as_str() {
            "markdown-editor" => return "markdown",
            "html-artifact" => return "html",
            "app-preview" => return "app",
            "image-preview" => return "image",
            "audio-preview" => return "audio",
            "video-preview" => return "video",
            "pdf-preview" => return "pdf",
            "csv-table" => return "spreadsheet",
            _ => {}
        }
        match self.category {
            Category::Markdown => "markdown",
            Category::App => "app",
            Category::Image => "image",
            Category::Audio => "audio",
            Category::Video => "video",
            Category::Archive => "archive",
            Category::Document => "document",
            Category::Binary => "binary",
            Category::Text => "text",
            Category::Code | Category::Data => "code",
        }
    }
    /// `isTextLikeFileFormat`.
    pub fn is_text_like(&self) -> bool {
        matches!(
            self.category,
            Category::Markdown | Category::Text | Category::Code
        ) || self.default_viewer == "csv-table"
            || (self.category == Category::Data && self.default_viewer == "monaco-code")
    }
    /// The registered extension a name carries (longest first), without dot.
    fn extension_in(&self, name: &str) -> Option<String> {
        let lower = basename(name).to_lowercase();
        let mut extensions: Vec<String> =
            self.extensions.iter().map(|e| e.to_lowercase()).collect();
        extensions.sort_by_key(|e| std::cmp::Reverse(e.len()));
        extensions
            .into_iter()
            .find(|e| lower.ends_with(e.as_str()))
            .map(|e| e.trim_start_matches('.').to_owned())
    }
}

/// `getFileSemanticKind`: the format's kind, else the host's node type.
pub fn semantic_kind(name: &str, node_type: Option<&str>, mime: Option<&str>) -> String {
    let format = resolve(Some(name), mime);
    if format.is_known() {
        return format.semantic_kind().to_owned();
    }
    node_type
        .filter(|t| SEMANTIC_KINDS.contains(t))
        .unwrap_or("file")
        .to_owned()
}
/// `FILE_SEMANTIC_KINDS`.
pub const SEMANTIC_KINDS: &[&str] = &[
    "folder",
    "app",
    "context-map",
    "workflow",
    "markdown",
    "json",
    "html",
    "image",
    "audio",
    "pdf",
    "video",
    "word",
    "excel",
    "spreadsheet",
    "database",
    "presentation",
    "archive",
    "document",
    "binary",
    "code",
    "text",
    "file",
];

/// `getResolvedFileExtension`: the concrete registered extension a name or
/// MIME type represents, so family formats (doc/docx) stay data driven.
pub fn resolved_extension(
    name: Option<&str>,
    mime: Option<&str>,
    format: &FileFormat,
) -> Option<String> {
    if let Some(extension) = name.and_then(|n| format.extension_in(n)) {
        return Some(extension);
    }
    let mime = normalize_mime(mime?);
    format
        .mime_types_by_extension
        .iter()
        .find(|(_, m)| m.to_lowercase() == mime)
        .map(|(e, _)| e.trim_start_matches('.').to_owned())
}

/// `getPreferredMimeType`.
pub fn preferred_mime(name: &str) -> Option<&'static str> {
    let format = of(name);
    if let Some(extension) = format.extension_in(name)
        && let Some(mime) = format.mime_types_by_extension.get(&format!(".{extension}"))
    {
        return Some(mime);
    }
    format.mime_types.first().map(String::as_str)
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn names_resolve_like_the_product_registry() {
        assert_eq!(of("README.md").id, "markdown");
        assert_eq!(of("docs/Guide.MARKDOWN").default_viewer, "markdown-editor");
        assert_eq!(of("data.csv").default_viewer, "csv-table");
        assert_eq!(of("photo.PNG").default_viewer, "image-preview");
        assert_eq!(of("src/index.ts").default_viewer, "monaco-code");
        // Compound extensions win over their last segment; exact names and
        // directory-qualified patterns win over extensions.
        assert_eq!(of("flow.puppyflow.json").id, "puppyflow");
        assert_eq!(of("app.js.map").id, "json");
        assert_eq!(of("CMakeLists.txt").id, "cmake");
        assert_eq!(of("repo/.claude/agents/review.md").id, "markdown");
        assert_eq!(of("Dockerfile.dev").id, "dockerfile");
        assert!(of("archive.zip").category == Category::Archive);
        assert!(!of("blob.qqqq").is_known());
        assert_eq!(of("blob.qqqq").default_viewer, "binary-placeholder");
    }

    #[test]
    fn globs_and_matched_extensions_follow_the_product() {
        assert!(glob("**/.github/agents/*.md", ".github/agents/a.md"));
        assert!(glob("**/.github/agents/*.md", "repo/.github/agents/a.md"));
        assert!(!glob("*.md", "a/b.md"));
        assert!(glob("*.log.?", "server.log.1"));
        assert_eq!(
            matched_extension("flow.puppyflow.json").as_deref(),
            Some("puppyflow.json")
        );
        assert_eq!(
            matched_extension("archive.tar.gz").as_deref(),
            Some("tar.gz")
        );
        assert_eq!(matched_extension("notes.v2.txt").as_deref(), Some("txt"));
        assert_eq!(matched_extension("Makefile"), None);
    }

    #[test]
    fn mime_types_fill_in_for_unregistered_names() {
        assert_eq!(
            resolve(Some("scan"), Some("image/x-thing")).id,
            "image-unknown"
        );
        let text = resolve(None, Some("text/x-custom; charset=utf-8"));
        assert_eq!((text.id.as_str(), text.editable), ("text-unknown", true));
        assert_eq!(
            resolve(None, Some("application/octet-stream")).id,
            "unknown"
        );
    }

    #[test]
    fn semantic_kinds_and_extensions_follow_the_format() {
        assert_eq!(semantic_kind("a.md", None, None), "markdown");
        assert_eq!(semantic_kind("a.csv", None, None), "spreadsheet");
        assert_eq!(semantic_kind("a.qqqq", Some("image"), None), "image");
        assert_eq!(semantic_kind("a.qqqq", Some("nonsense"), None), "file");
        let docx = of("Report.DOCX");
        assert_eq!(
            resolved_extension(Some("Report.DOCX"), None, docx).as_deref(),
            Some("docx")
        );
        assert!(of("a.json").is_text_like());
        assert!(!of("a.png").is_text_like());
        // The extension's own MIME first, else the format's first MIME.
        assert_eq!(preferred_mime("old.doc"), Some("application/msword"));
        assert_eq!(preferred_mime("a.png"), Some("image/apng"));
        assert_eq!(
            resolved_extension(None, Some("application/vnd.ms-excel"), of("a.xlsx")).as_deref(),
            Some("xls")
        );
    }

    #[test]
    fn every_default_viewer_is_declared_by_the_viewer_manifest() {
        let manifest: serde_json::Value =
            serde_json::from_str(include_str!("../../assets/formats/preset-viewers.json")).unwrap();
        let declared: Vec<String> = manifest["viewers"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|v| {
                std::iter::once(v["id"].as_str().unwrap().to_owned()).chain(
                    v["formatViewerIds"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|id| id.as_str().unwrap().to_owned()),
                )
            })
            .collect();
        for format in all().iter().chain([unknown()]) {
            // `json-table` is the product's special JSON route to `json`.
            let viewer = format.default_viewer.as_str();
            assert!(
                declared.iter().any(|d| d == viewer) || viewer == "json-table",
                "{} → {viewer}",
                format.id
            );
        }
    }
}
