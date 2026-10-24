//! One viewer contribution: the behaviour a viewer adds to its manifest
//! definition (`definePresetViewer`), validated against that definition
//! (`normalizePresetViewerContribution`, `normalizeEditorProviderPolicy`).
use super::{
    manifest::{Capability, Source, SurfaceIsolation, ViewerDefinition, ViewerManifest},
    surface::{SurfaceRequest, ViewerSurface},
};
use crate::formats::FileFormat;
use gpui::{App, Window};

/// `DocumentSourceKind`: plugin routing fails closed for anything but local.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SourceKind {
    Local,
    /// Cloud workspaces are not native yet; routing already refuses them.
    #[cfg_attr(not(test), allow(dead_code))]
    Cloud,
    #[default]
    Unknown,
}

/// `EditorDocument`: what the host knows about a document before opening it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct EditorDocument {
    /// Workspace-relative path.
    pub path: String,
    /// Display name (the file name).
    pub name: String,
    /// The host's semantic node type (`markdown`, `image`, …).
    pub kind: String,
    pub mime: Option<String>,
    pub source_kind: SourceKind,
}
impl EditorDocument {
    /// A local workspace file, typed by the format registry.
    pub fn local(path: &str) -> Self {
        let name = path.rsplit(['/', '\\']).next().unwrap_or(path).to_owned();
        Self {
            kind: crate::formats::semantic_kind(path, None, None),
            path: path.to_owned(),
            name,
            mime: None,
            source_kind: SourceKind::Local,
        }
    }
}

/// `EditorViewerMatch`.
pub struct ViewerMatch<'a> {
    pub document: &'a EditorDocument,
    pub format: &'static FileFormat,
    /// The concrete registered extension (`docx` of the doc/docx family), so
    /// a viewer can pick its parser; no built-in match needs it yet.
    #[allow(dead_code)]
    pub resolved_extension: Option<&'a str>,
}

/// `EditorProviderPolicy.profile`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Profile {
    EditableDocument,
    ReadonlyPreview,
    AppRuntime,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SemanticInput {
    LinkGraph,
    AssetResolver,
}
/// `EditorProviderPolicy`: pane behaviour the contribution declares.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProviderPolicy {
    pub profile: Profile,
    /// The pane offers a live / source toggle.
    pub source_toggle: bool,
    pub semantic_inputs: &'static [SemanticInput],
    /// Resources next to the document are part of its input (`document-directory`).
    pub document_directory: bool,
}

/// Opens the viewer's surface for one document.
pub type SurfaceFactory = fn(&SurfaceRequest, &mut Window, &mut App) -> Box<dyn ViewerSurface>;

/// How the native build presents a viewer.
#[derive(Clone, Copy)]
pub enum Presentation {
    /// A native surface.
    Native(SurfaceFactory),
    /// Declared by the product, not yet available natively: the host shows
    /// an honest "preview unavailable" placeholder for the document.
    Unavailable,
}

/// What one viewer implementation provides (`PresetViewerImplementation`).
#[derive(Clone, Copy)]
pub struct ViewerImplementation {
    /// The manifest id.
    pub id: &'static str,
    /// Omitted: the profile the capability implies, without extras.
    pub policy: Option<ProviderPolicy>,
    pub matches: fn(&ViewerMatch) -> bool,
    /// Format-specific veto for an edit-capable viewer.
    pub editable: Option<fn(&ViewerMatch, &str) -> bool>,
    pub presentation: Presentation,
}

/// A validated contribution (`PresetViewerContribution`).
#[derive(Clone, Copy)]
pub struct PresetViewer {
    pub id: &'static str,
    pub definition: &'static ViewerDefinition,
    pub policy: ProviderPolicy,
    matches: fn(&ViewerMatch) -> bool,
    editable: Option<fn(&ViewerMatch, &str) -> bool>,
    pub presentation: Presentation,
}

impl PresetViewer {
    /// Validate an implementation against its canonical definition.
    pub fn define(
        implementation: ViewerImplementation,
        manifest: &'static ViewerManifest,
    ) -> Result<Self, String> {
        let id = implementation.id;
        let definition = manifest.definition(id).ok_or_else(|| {
            format!("Preset viewer {id} is not declared in the canonical manifest.")
        })?;
        let edit = definition.capability == Capability::Edit;
        if edit != implementation.editable.is_some() {
            return Err(if edit {
                format!("Editable preset viewer {id} must define isEditable.")
            } else {
                format!("Non-editable preset viewer {id} cannot define isEditable.")
            });
        }
        if definition.surface_isolation == SurfaceIsolation::IsolatedWebcontents
            && matches!(implementation.presentation, Presentation::Native(_))
        {
            return Err(format!(
                "Isolated-surface preset viewer {id} cannot ship an inline surface."
            ));
        }
        let expected = if edit {
            Profile::EditableDocument
        } else if definition.source == Source::None && definition.capability == Capability::Preview
        {
            Profile::AppRuntime
        } else {
            Profile::ReadonlyPreview
        };
        let policy = implementation.policy.unwrap_or(ProviderPolicy {
            profile: expected,
            source_toggle: false,
            semantic_inputs: &[],
            document_directory: false,
        });
        if policy.profile != expected {
            return Err(format!(
                "Viewer {id} has an invalid provider lifecycle policy."
            ));
        }
        if policy.source_toggle && expected != Profile::EditableDocument {
            return Err("A read-only provider cannot expose an editable source toggle.".into());
        }
        Ok(Self {
            id,
            definition,
            policy,
            matches: implementation.matches,
            editable: implementation.editable,
            presentation: implementation.presentation,
        })
    }
    pub fn matches(&self, m: &ViewerMatch) -> bool {
        (self.matches)(m)
    }
    /// The Host's edit gate: capability, the format's editability and the
    /// viewer's own veto (`isEditable`).
    pub fn editable(&self, m: &ViewerMatch, content: &str) -> bool {
        self.definition.capability == Capability::Edit
            && m.format.editable
            && self.editable.is_some_and(|veto| veto(m, content))
    }
    pub fn capability(&self) -> Capability {
        self.definition.capability
    }
    pub fn source(&self) -> Source {
        self.definition.source
    }
}
