//! The viewer registry: a port of `src/shared-ui/editor/registry`.
//!
//! ```text
//! formats            which format a file is (crate::formats, incl. RG-01 sniffing)
//! manifest.rs        what each preset viewer may do (presetViewerManifest.json)
//! admission.rs       stat-first admission, read-only large text & oversized cards (RG-02..RG-04)
//! request.rs         per-instance SurfaceRequest & DocumentContext (RG-10, RG-11)
//! actions.rs         typed HostCommand, PaneItemId & PaneSegmentId (RG-21)
//! contribution.rs    what a viewer implementation adds, validated against manifest
//! surface.rs         slim ViewerSurface + optional capability sub-traits (RG-20)
//! builtin.rs         the built-in contributions, in match order (the only list)
//! packs/             external Viewer Packs: manifests, routing, the host port
//! ```

pub mod actions;
pub mod admission;
mod builtin;
mod contribution;
mod manifest;
pub mod normalize;
pub mod packs;
pub mod request;
mod surface;

pub use actions::{HostCommand, MarkdownCommand, PaneItemId, PaneSegmentId};
pub use admission::{Admission, READ_ONLY_TEXT_MAX_BYTES};
pub use contribution::{
    EditorDocument, Presentation, PresetViewer, SourceKind, SurfaceFactory, ViewerImplementation,
    ViewerMatch,
};
pub use manifest::{Capability, Source, ViewerManifest, manifest};
pub use request::{AssetReader, DocumentAssets, DocumentContext, SurfaceInput, SurfaceRequest};
#[cfg(test)]
pub use surface::SpecialSurfaceProbe;
#[cfg(any(test, feature = "dev-capture", feature = "test-support"))]
pub use surface::SurfaceTestProbe;
pub use surface::{
    CompanionHistory, HtmlWindowTools, PaneEntries, SurfaceEvent, SurfaceEvents, SurfaceHistory,
    SurfaceHtmlJsError, SurfaceHtmlToolAction, SurfaceHtmlToolEvent, SurfaceHtmlToolMode,
    SurfaceHtmlToolSnapshot, ViewerSurface,
};

use crate::formats::{self, FileFormat};
use std::{collections::HashSet, sync::OnceLock};

/// An immutable, order-preserving registry with one honest fallback
/// (`createPresetViewerRegistry`).
pub struct ViewerRegistry {
    contributions: Vec<PresetViewer>,
    fallback: PresetViewer,
}

impl ViewerRegistry {
    pub fn new(
        contributions: Vec<ViewerImplementation>,
        fallback: ViewerImplementation,
        manifest: &'static ViewerManifest,
    ) -> Result<Self, String> {
        let contributions = contributions
            .into_iter()
            .map(|c| PresetViewer::define(c, manifest))
            .collect::<Result<Vec<_>, _>>()?;
        let fallback = PresetViewer::define(fallback, manifest)?;
        let mut ids = HashSet::new();
        for viewer in contributions.iter().chain([&fallback]) {
            if !ids.insert(viewer.id) {
                return Err(format!(
                    "Preset viewer id {} is registered more than once.",
                    viewer.id
                ));
            }
        }
        if fallback.id != manifest.fallback_viewer_id {
            return Err(format!(
                "The preset viewer fallback must be {}.",
                manifest.fallback_viewer_id
            ));
        }
        // `assertCompletePresetViewerRegistry`.
        let missing: Vec<&str> = manifest
            .viewers
            .iter()
            .map(|v| v.id.as_str())
            .filter(|id| !ids.contains(id))
            .collect();
        if !missing.is_empty() {
            return Err(format!(
                "Preset viewer manifest has no implementation for: {}.",
                missing.join(", ")
            ));
        }
        Ok(Self {
            contributions,
            fallback,
        })
    }
    #[cfg(test)]
    pub fn fallback(&self) -> &PresetViewer {
        &self.fallback
    }
    pub fn resolve(&self, m: &ViewerMatch) -> &PresetViewer {
        self.contributions
            .iter()
            .find(|viewer| viewer.matches(m))
            .unwrap_or(&self.fallback)
    }
}

/// The registry this build ships (`PRESET_VIEWER_REGISTRY`).
pub fn registry() -> &'static ViewerRegistry {
    static REGISTRY: OnceLock<ViewerRegistry> = OnceLock::new();
    REGISTRY.get_or_init(|| {
        ViewerRegistry::new(builtin::contributions(), builtin::fallback(), manifest())
            .expect("the built-in viewer registry is complete and valid")
    })
}

/// A document's viewer, format and concrete extension.
pub struct Resolved {
    pub viewer: &'static PresetViewer,
    pub format: &'static FileFormat,
    pub resolved_extension: Option<String>,
}
impl Resolved {
    pub fn view_match<'a>(&'a self, document: &'a EditorDocument) -> ViewerMatch<'a> {
        ViewerMatch {
            document,
            format: self.format,
        }
    }
}

/// `resolveEditorViewer` by name and optional MIME.
pub fn resolve(document: &EditorDocument) -> Resolved {
    resolve_with_head(document, None)
}

/// `resolveEditorViewer` with bounded head-byte content sniffing when name and
/// MIME resolve to `unknown` (`RG-01`).
///
/// Known extensions are never overridden by sniffing, and sniffing never
/// selects content-executing viewers (`html-artifact`, `app-preview`).
pub fn resolve_with_head(document: &EditorDocument, head: Option<&[u8]>) -> Resolved {
    let format_path = if document.path.is_empty() {
        &document.name
    } else {
        &document.path
    };
    let format = formats::resolve_with_sniff(Some(format_path), document.mime.as_deref(), head);
    resolve_with_format(document, format)
}

/// Resolves a viewer using a pre-computed [`FileFormat`] (e.g. a sniffed format
/// delivered on [`DocumentContext`]).
pub fn resolve_with_format(document: &EditorDocument, format: &'static FileFormat) -> Resolved {
    let resolved_extension =
        formats::resolved_extension(Some(&document.name), document.mime.as_deref(), format);
    let m = ViewerMatch { document, format };
    Resolved {
        viewer: registry().resolve(&m),
        format,
        resolved_extension,
    }
}

/// Returns the canonical `resourcePolicy.maxSourceBytes` declared in
/// `preset-viewers.json` for `viewer_id` (`RG-04`).
pub fn viewer_budget(viewer_id: &str) -> u64 {
    manifest()
        .definition(viewer_id)
        .map(|def| def.resource_policy.max_source_bytes)
        .unwrap_or(0)
}

/// The resolved viewer's `resourcePolicy.maxSourceBytes` for `path`.
pub fn source_budget(path: &str) -> u64 {
    resolve(&EditorDocument::local(path))
        .viewer
        .definition
        .resource_policy
        .max_source_bytes
}

/// `formatByteLimit`: whole GB / MB when exact, otherwise rounded-up MB / KB.
pub fn format_byte_limit(bytes: u64) -> String {
    const MB: u64 = 1024 * 1024;
    if bytes >= MB && bytes.is_multiple_of(MB) {
        format!("{} MB", bytes / MB)
    } else {
        format!("{} KB", bytes.div_ceil(1024))
    }
}

/// `getEditorSourceRequirement`: what the host reads to open a file.
pub fn source_requirement(path: &str) -> Source {
    resolve(&EditorDocument::local(path)).viewer.source()
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn viewer(path: &str) -> &'static str {
        resolve(&EditorDocument::local(path)).viewer.id
    }

    #[test]
    fn source_budgets_follow_the_product_manifest() {
        assert_eq!(source_budget("a.md"), 16 * 1024 * 1024);
        assert_eq!(source_budget("a.txt"), 16 * 1024 * 1024);
        assert_eq!(source_budget("a.csv"), 8 * 1024 * 1024);
        assert_eq!(source_budget("a.json"), 8 * 1024 * 1024);
        assert_eq!(source_budget("a.html"), 4 * 1024 * 1024);
        assert_eq!(viewer_budget("office-preview"), 25 * 1024 * 1024);
        assert_eq!(viewer_budget("database-preview"), 8 * 1024 * 1024 * 1024);
        assert_eq!(viewer_budget("audio-preview"), 512 * 1024 * 1024);
        assert_eq!(viewer_budget("video-preview"), 2 * 1024 * 1024 * 1024);
        assert_eq!(format_byte_limit(8 * 1024 * 1024), "8 MB");
        assert_eq!(format_byte_limit(1500), "2 KB");
    }

    #[test]
    fn rg30_viewer_and_platform_modules_hold_no_duplicate_source_budget_constants() {
        // Every manifest viewer id resolves through viewer_budget.
        for def in &manifest().viewers {
            assert_eq!(
                viewer_budget(&def.id),
                def.resource_policy.max_source_bytes,
                "viewer_budget mismatch for {}",
                def.id
            );
        }
        let repo_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(|p| p.parent())
            .expect("workspace root");
        let viewers_dir = repo_root.join("src/editor/viewers");
        let mut files = vec![repo_root.join("src/platform/database.rs")];
        for entry in std::fs::read_dir(&viewers_dir).expect("read viewers dir") {
            let path = entry.expect("dir entry").path();
            if path.extension().and_then(|s| s.to_str()) == Some("rs") {
                files.push(path);
            }
        }
        let forbidden_patterns = [
            "const BUDGET:",
            "const MAX_SOURCE_BYTES:",
            "25 * 1024 * 1024",
            "512 * 1024 * 1024",
            "2 * 1024 * 1024 * 1024",
            "8 * 1024 * 1024 * 1024",
        ];
        for path in files {
            let raw = std::fs::read_to_string(&path).expect("read source file");
            // Strip trailing #[cfg(test)] mod tests section.
            let prod = raw.split("#[cfg(test)]\nmod tests").next().unwrap_or(&raw);
            for pattern in forbidden_patterns {
                assert!(
                    !prod.contains(pattern),
                    "RG-30 violation: {} contains duplicate budget constant pattern `{pattern}`; read manifest via registry::viewer_budget instead",
                    path.display()
                );
            }
        }
    }

    #[test]
    fn rg31_content_sniffing_routes_extensionless_magic_and_utf8_without_overriding_extensions_or_executing_html()
     {
        let sniff_viewer = |path: &str, head: &[u8]| -> &'static str {
            resolve_with_head(&EditorDocument::local(path), Some(head))
                .viewer
                .id
        };
        // Magic numbers on extensionless files.
        assert_eq!(
            sniff_viewer("README_IMAGE", b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"),
            "image-preview"
        );
        assert_eq!(
            sniff_viewer("photo_blob", b"\xFF\xD8\xFF\xE0\x00\x10JFIF"),
            "image-preview"
        );
        assert_eq!(
            sniff_viewer("anim_blob", b"GIF89a\x01\x00"),
            "image-preview"
        );
        assert_eq!(
            sniff_viewer("webp_blob", b"RIFF\x24\x00\x00\x00WEBPVP8 "),
            "image-preview"
        );
        assert_eq!(sniff_viewer("manual_blob", b"%PDF-1.7\n%"), "pdf-preview");
        assert_eq!(
            sniff_viewer("cache_data", b"SQLite format 3\x00\x10\x00"),
            "database-preview"
        );
        assert_eq!(
            sniff_viewer("track_blob", b"ID3\x04\x00\x00\x00\x00\x00\x00"),
            "audio-preview"
        );
        assert_eq!(sniff_viewer("ogg_blob", b"OggS\x00\x02"), "audio-preview");
        assert_eq!(
            sniff_viewer("wav_blob", b"RIFF\x24\x00\x00\x00WAVEfmt "),
            "audio-preview"
        );
        assert_eq!(
            sniff_viewer("clip_blob", b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00"),
            "video-preview"
        );
        assert_eq!(
            sniff_viewer("gzip_blob", b"\x1f\x8b\x08\x00\x00\x00\x00\x00"),
            "document-placeholder"
        );
        assert_eq!(
            sniff_viewer("wasm_blob", b"\0asm\x01\x00\x00\x00"),
            "document-placeholder"
        );
        assert_eq!(
            sniff_viewer("archive_blob", b"PK\x03\x04\x14\x00\x00\x00"),
            "document-placeholder"
        );

        // UTF-8 text vs non-UTF-8 / NUL binary.
        assert_eq!(
            sniff_viewer("AUTHORS_NOTES", "Hello 世界!\nLine two.\n".as_bytes()),
            "text"
        );
        assert_eq!(
            sniff_viewer("raw_dump", b"\x00\xFF\xFE\x80\x01\x02"),
            "document-placeholder"
        );

        // Known extensions are NEVER overridden by sniffing (disguised extension).
        assert_eq!(
            sniff_viewer("disguised.txt", b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"),
            "text"
        );
        assert_eq!(sniff_viewer("notes.md", b"%PDF-1.7\n"), "markdown");

        // Sniffing NEVER selects executable HTML or App Preview viewers.
        let html_sniffed = sniff_viewer(
            "untrusted_payload",
            b"<!DOCTYPE html><html><body><script>alert(1)</script></body></html>",
        );
        assert_eq!(html_sniffed, "text");
        assert_ne!(html_sniffed, "html-artifact");
        assert_ne!(html_sniffed, "app-preview");
    }

    #[test]
    fn documents_resolve_to_the_product_viewers() {
        assert_eq!(viewer("notes/README.md"), "markdown");
        assert_eq!(viewer("data/people.csv"), "csv-table");
        assert_eq!(viewer("src/main.rs"), "text");
        assert_eq!(viewer("package.json"), "json");
        assert_eq!(viewer("assets/logo.png"), "image-preview");
        assert_eq!(viewer("paper.pdf"), "pdf-preview");
        assert_eq!(viewer("Report.docx"), "office-preview");
        assert_eq!(viewer("song.mp3"), "audio-preview");
        assert_eq!(viewer("index.html"), "html-artifact");
        assert_eq!(viewer("model.glb"), "document-placeholder");
        assert_eq!(viewer("blob.qqqq"), "document-placeholder");
    }

    #[test]
    fn the_source_requirement_decides_what_the_host_reads() {
        assert!(source_requirement("a.md").reads_content());
        assert!(source_requirement("a.html").reads_content());
        assert_eq!(source_requirement("a.png"), Source::Resource);
        assert_eq!(source_requirement("a.zip"), Source::None);
    }

    #[test]
    fn office_mime_routing_recovers_parser_dispatch_without_a_filename_extension() {
        for (mime, extension) in [
            ("application/msword", "doc"),
            (
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "docx",
            ),
            (
                "application/vnd.ms-excel.sheet.binary.macroEnabled.12",
                "xlsb",
            ),
            ("application/vnd.ms-excel.sheet.macroEnabled.12", "xlsm"),
            (
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "xlsx",
            ),
            (
                "application/vnd.openxmlformats-officedocument.presentationml.slideshow",
                "ppsx",
            ),
            (
                "application/vnd.oasis.opendocument.spreadsheet-template",
                "ots",
            ),
        ] {
            let mut document = EditorDocument::local("download");
            document.mime = Some(mime.into());
            let resolved = resolve(&document);
            assert_eq!(resolved.viewer.id, "office-preview", "{mime}");
            assert_eq!(resolved.resolved_extension.as_deref(), Some(extension));
            assert_eq!(resolved.viewer.source(), Source::Resource);
        }
        let mut document = EditorDocument::local("download");
        document.mime = Some("application/vnd.example.untrusted-office-lookalike".into());
        let resolved = resolve(&document);
        assert_eq!(resolved.viewer.id, "document-placeholder");
        assert_eq!(resolved.viewer.source(), Source::None);
        assert_eq!(resolved.resolved_extension, None);
    }

    #[test]
    fn only_editable_viewers_on_editable_formats_edit() {
        let md = EditorDocument::local("a.md");
        let resolved = resolve(&md);
        assert!(resolved.viewer.editable(&resolved.view_match(&md), "# x"));
        let png = EditorDocument::local("a.png");
        let resolved = resolve(&png);
        assert!(!resolved.viewer.editable(&resolved.view_match(&png), ""));
    }

    #[test]
    fn csv_semantics_do_not_override_format_policy_or_make_office_editable() {
        let mut csv = EditorDocument::local("Untitled.csv");
        csv.kind = "spreadsheet".into();
        csv.mime = Some("text/csv; charset=utf-8".into());
        let resolved = resolve(&csv);
        assert_eq!(resolved.viewer.id, "csv-table");
        assert!(
            resolved
                .viewer
                .editable(&resolved.view_match(&csv), "one,two")
        );
        let readonly = resolve(&EditorDocument::local("book.xlsx"));
        assert!(!resolved.viewer.editable(
            &ViewerMatch {
                document: &csv,
                format: readonly.format
            },
            "one,two"
        ));
        for name in ["book.xlsx", "report.docx", "slides.pptx", "table.ods"] {
            let doc = EditorDocument::local(name);
            let resolved = resolve(&doc);
            assert_eq!(resolved.viewer.id, "office-preview", "{name}");
            assert!(
                !resolved
                    .viewer
                    .editable(&resolved.view_match(&doc), "some text"),
                "{name}"
            );
        }
    }

    /// The product's pane fixture matrix (`EDITOR_PANE_CASES`): each fixture
    /// resolves to its declared viewer, and together they cover every
    /// registered viewer and the fallback.
    #[test]
    fn every_pane_fixture_selects_its_declared_viewer_and_all_viewers_are_covered() {
        const CASES: [(&str, &str, &str, &str, Option<&str>); 20] = [
            (
                "context-map",
                "context-map",
                "map.contextmap",
                "context-map",
                None,
            ),
            ("app", "app-preview", "demo.puppyoneapp", "app", None),
            ("markdown", "markdown", "note.md", "markdown", None),
            ("puppyflow", "puppyflow", "flow.puppyflow", "workflow", None),
            ("json", "json", "settings.json", "json", None),
            (
                "whiteboard",
                "excalidraw",
                "board.excalidraw",
                "whiteboard",
                None,
            ),
            (
                "csv",
                "csv-table",
                "table.csv",
                "spreadsheet",
                Some("text/csv"),
            ),
            (
                "tsv",
                "csv-table",
                "table.tsv",
                "spreadsheet",
                Some("text/tab-separated-values"),
            ),
            ("html", "html-artifact", "page.html", "html", None),
            ("image", "image-preview", "image.png", "image", None),
            ("pdf", "pdf-preview", "document.pdf", "pdf", None),
            ("database", "database-preview", "sample.db", "file", None),
            ("word", "office-preview", "document.docx", "document", None),
            (
                "spreadsheet",
                "office-preview",
                "workbook.xlsx",
                "spreadsheet",
                None,
            ),
            (
                "presentation",
                "office-preview",
                "slides.pptx",
                "presentation",
                None,
            ),
            ("audio", "audio-preview", "tone.wav", "audio", None),
            ("video", "video-preview", "clip.webm", "video", None),
            ("text", "text", "plain.txt", "text", None),
            ("code", "text", "worker.py", "code", None),
            (
                "fallback",
                "document-placeholder",
                "unknown.pane-binary",
                "file",
                None,
            ),
        ];
        for (id, expected, name, kind, mime) in CASES {
            let mut document = EditorDocument::local(name);
            document.kind = kind.into();
            document.mime = mime.map(str::to_owned);
            assert_eq!(resolve(&document).viewer.id, expected, "{id}");
        }
        let mut covered: Vec<&str> = CASES.iter().map(|case| case.1).collect();
        covered.sort_unstable();
        covered.dedup();
        let mut registered: Vec<&str> = registry()
            .contributions
            .iter()
            .map(|viewer| viewer.id)
            .chain([registry().fallback().id])
            .collect();
        registered.sort_unstable();
        assert_eq!(covered, registered);
        let mut ids: Vec<&str> = CASES.iter().map(|case| case.0).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), CASES.len());
    }

    #[test]
    fn registries_breaking_the_contract_are_refused() {
        let all = builtin::contributions();
        // Incomplete: a declared viewer without an implementation.
        let partial = all
            .iter()
            .copied()
            .filter(|c| c.id != "pdf-preview")
            .collect();
        let error = ViewerRegistry::new(partial, builtin::fallback(), manifest())
            .err()
            .unwrap();
        assert!(error.contains("pdf-preview"), "{error}");
        // Duplicate ids.
        let mut twice = all.clone();
        twice.push(all[0]);
        assert!(ViewerRegistry::new(twice, builtin::fallback(), manifest()).is_err());
        // An editable viewer without its veto, and the wrong fallback.
        let mut vetoless = all.clone();
        let markdown = vetoless.iter_mut().find(|c| c.id == "markdown").unwrap();
        markdown.editable = None;
        assert!(ViewerRegistry::new(vetoless, builtin::fallback(), manifest()).is_err());
        let markdown = *all.iter().find(|c| c.id == "markdown").unwrap();
        assert!(ViewerRegistry::new(all.clone(), markdown, manifest()).is_err());
        // The shipped one is valid.
        assert_eq!(registry().fallback().id, "document-placeholder");
    }
}
