//! The viewer registry: a port of `packages/shared-ui/src/editor/registry`.
//!
//! ```text
//! formats            which format a file is (crate::formats)
//! manifest.rs        what each preset viewer may do (presetViewerManifest.json)
//! contribution.rs    what a viewer implementation adds, validated against it
//! surface.rs         the hooks an open viewer gives the document host
//! builtin.rs         the built-in contributions, in match order (the only list)
//! packs/             external Viewer Packs: manifests, routing, the host port
//! ```
//!
//! Resolution (`resolveEditorViewer`): the document's format, then the first
//! contribution whose `matches` accepts it, else the placeholder fallback.
//! The host (`editor::host`) opens the resolved viewer's surface and never
//! names a concrete viewer. Placeholder-grade documents are the surface an
//! external Viewer Pack may claim.
mod builtin;
mod contribution;
mod manifest;
pub mod normalize;
pub mod packs;
mod surface;

pub use contribution::{
    EditorDocument, Presentation, PresetViewer, ViewerImplementation, ViewerMatch,
};
pub use manifest::{Source, ViewerManifest, manifest};
pub use surface::{
    PaneEntries, SurfaceEvent, SurfaceEvents, SurfaceInput, SurfaceRequest, ViewerSurface,
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
    #[cfg_attr(not(test), allow(dead_code))]
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
            resolved_extension: self.resolved_extension.as_deref(),
        }
    }
}

/// `resolveEditorViewer`.
pub fn resolve(document: &EditorDocument) -> Resolved {
    let format_path = if document.path.is_empty() {
        &document.name
    } else {
        &document.path
    };
    let format = formats::resolve(Some(format_path), document.mime.as_deref());
    let resolved_extension =
        formats::resolved_extension(Some(&document.name), document.mime.as_deref(), format);
    let m = ViewerMatch {
        document,
        format,
        resolved_extension: resolved_extension.as_deref(),
    };
    Resolved {
        viewer: registry().resolve(&m),
        format,
        resolved_extension,
    }
}

thread_local! {
    static FOLDERS: std::cell::RefCell<std::collections::HashMap<String, std::path::PathBuf>> =
        std::cell::RefCell::new(Default::default());
}
/// The local folder a document's relative resources resolve in.
pub fn set_document_folder(id: &str, folder: Option<std::path::PathBuf>) {
    FOLDERS.with(|f| match folder {
        Some(folder) => {
            f.borrow_mut().insert(id.to_owned(), folder);
        }
        None => {
            f.borrow_mut().remove(id);
        }
    });
}
pub fn document_folder(id: &str) -> Option<std::path::PathBuf> {
    FOLDERS.with(|f| f.borrow().get(id).cloned())
}
/// The resolved viewer's `resourcePolicy.maxSourceBytes` for `path`.
pub fn source_budget(path: &str) -> u64 {
    resolve(&EditorDocument::local(path))
        .viewer
        .definition
        .resource_policy
        .max_source_bytes
}
/// `formatByteLimit`: whole MB when exact, otherwise rounded-up KB.
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
        assert_eq!(format_byte_limit(8 * 1024 * 1024), "8 MB");
        assert_eq!(format_byte_limit(1500), "2 KB");
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
    fn only_editable_viewers_on_editable_formats_edit() {
        let md = EditorDocument::local("a.md");
        let resolved = resolve(&md);
        assert!(resolved.viewer.editable(&resolved.view_match(&md), "# x"));
        let png = EditorDocument::local("a.png");
        let resolved = resolve(&png);
        assert!(!resolved.viewer.editable(&resolved.view_match(&png), ""));
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
