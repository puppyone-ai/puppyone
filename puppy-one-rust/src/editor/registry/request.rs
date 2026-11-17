//! Per-instance document context and [`SurfaceRequest`] (`RG-10`, `RG-11`).
//!
//! All per-document capabilities (local folder, hosted WebView asset source,
//! relative asset reader, reference graph context, and real [`SourceKind`])
//! travel with the open request and are owned by the surface instance so closing
//! a surface deterministically drops its resources without global/thread-local leaks.

use super::contribution::SourceKind;
use crate::{
    editor::navigation::ReferenceContext,
    formats::FileFormat,
    platform::webview,
    typography::Scale,
    workspace::{PreviewResource, Workspace},
};
use std::{
    borrow::Cow,
    path::{Path, PathBuf},
    sync::Arc,
};

/// Reads a workspace file by its workspace-relative path, refusing paths outside it.
pub type AssetReader = Arc<dyn Fn(&Path) -> Option<Vec<u8>> + Send + Sync>;

/// What a document's relative media/embeds resolve against (`RG-10`).
#[derive(Clone)]
pub struct DocumentAssets {
    /// The workspace's identity (its root's resource key).
    pub workspace: String,
    pub document: PathBuf,
    pub read: AssetReader,
}

impl DocumentAssets {
    /// Broker scope: preserve the host identity, or isolate standalone documents.
    /// The raw workspace remains the authority for local filesystem containment.
    pub fn workspace_identity(&self) -> Cow<'_, str> {
        if !self.workspace.is_empty() {
            return Cow::Borrowed(&self.workspace);
        }
        let document = self.document.to_string_lossy();
        let document = document.trim();
        if document.is_empty() {
            Cow::Borrowed("workspace:anonymous")
        } else {
            Cow::Owned(format!("doc:{document}"))
        }
    }
}

impl std::fmt::Debug for DocumentAssets {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DocumentAssets")
            .field("workspace", &self.workspace)
            .field("document", &self.document)
            .finish_non_exhaustive()
    }
}

impl PartialEq for DocumentAssets {
    fn eq(&self, other: &Self) -> bool {
        self.workspace == other.workspace
            && self.document == other.document
            && Arc::ptr_eq(&self.read, &other.read)
    }
}

/// Per-open-instance document context delivered from `Documents` to `DocumentEditor` (`RG-10`, `RG-11`).
#[derive(Clone, Default)]
pub struct DocumentContext {
    /// Local directory containing the document, when backed by a local folder.
    pub folder: Option<PathBuf>,
    /// Hosted/Cloud WebView relative asset source, when not backed by a local folder.
    pub web_source: Option<webview::Source>,
    /// Relative workspace asset reader (used by Markdown images and Excalidraw embeds).
    pub assets: Option<DocumentAssets>,
    /// Real origin of the document (`Local`, `Cloud`, `RemoteDevice`, `Unknown`).
    pub source_kind: SourceKind,
    /// Sniffed format when extension/MIME resolved to `unknown` (`RG-01`).
    pub sniffed_format: Option<&'static FileFormat>,
}

impl std::fmt::Debug for DocumentContext {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DocumentContext")
            .field("folder", &self.folder)
            .field("has_web_source", &self.web_source.is_some())
            .field("assets", &self.assets)
            .field("source_kind", &self.source_kind)
            .field(
                "sniffed_format",
                &self.sniffed_format.map(|fmt| fmt.id.as_str()),
            )
            .finish()
    }
}

impl PartialEq for DocumentContext {
    fn eq(&self, other: &Self) -> bool {
        let same_web_source = match (&self.web_source, &other.web_source) {
            (None, None) => true,
            (Some(a), Some(b)) => Arc::ptr_eq(&a.0, &b.0),
            _ => false,
        };
        let same_sniff = match (self.sniffed_format, other.sniffed_format) {
            (None, None) => true,
            (Some(a), Some(b)) => a.id == b.id,
            _ => false,
        };
        self.folder == other.folder
            && same_web_source
            && self.assets == other.assets
            && self.source_kind == other.source_kind
            && same_sniff
    }
}

/// What the host hands a viewer to open (`PresetViewerRenderContext`, `RG-10`).
pub struct SurfaceRequest<'a> {
    /// The document session id.
    pub id: &'a str,
    /// Workspace-relative path (or standalone file display path).
    pub name: &'a str,
    pub input: SurfaceInput<'a>,
    pub format: &'static FileFormat,
    /// The concrete registered extension, for viewers that pick a parser.
    pub resolved_extension: Option<&'a str>,
    pub dark: bool,
    pub scale: Scale,
    /// The document's workspace (`workspaceRoot`, `contextMapEnvironment`);
    /// `None` for a lone file.
    pub workspace: Option<Arc<Workspace>>,
    /// Standalone file window (`FileModeApp`): viewers use `edit-and-source-panel`
    /// Header controls instead of the workbench segmented switch.
    pub file_mode: bool,
    /// Local parent folder of the document (`RG-10`).
    pub folder: Option<PathBuf>,
    /// Hosted/Cloud WebView relative asset source (`RG-10`).
    pub web_source: Option<webview::Source>,
    /// Relative workspace asset reader (`RG-10`).
    pub assets: Option<DocumentAssets>,
    /// Hydrated workspace reference context (`RG-10`).
    pub references: Option<ReferenceContext>,
    /// Real origin of the document (`RG-11`).
    pub source_kind: SourceKind,
}

/// The viewer's input, as its manifest `source` asks.
#[derive(Clone, Copy, Debug)]
pub enum SurfaceInput<'a> {
    /// `content` / `content-and-resource`: the document text.
    Text(&'a str),
    /// `resource`: the file, read by the viewer itself.
    Resource(&'a PreviewResource),
    /// `none`: nothing but the document's identity.
    None,
}
