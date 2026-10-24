//! The preset viewer manifest (`presetViewerManifest.json`, parsed like
//! `shared/presetViewerManifest.js`): the process-neutral contract of every
//! viewer that ships with the product. A viewer implementation only adds
//! behaviour; what it may do — capability, input, isolation, budgets — is
//! declared here.
use serde::Deserialize;
use std::{collections::HashSet, sync::OnceLock};

pub const CONTRACT_VERSION: u32 = 8;

/// `CoreViewerCapability`: placeholder-grade documents are the surface a
/// Viewer Pack may claim.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Capability {
    Edit,
    Preview,
    Placeholder,
}
/// `PresetViewerSource`: what the host must hand the viewer.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Source {
    Content,
    Resource,
    ResourceSession,
    ContentAndResource,
    None,
}
impl Source {
    /// Whether the host reads the document's text for the viewer.
    pub fn reads_content(self) -> bool {
        matches!(self, Source::Content | Source::ContentAndResource)
    }
}
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Runtime {
    Eager,
    Lazy,
}
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SurfaceIsolation {
    Inline,
    IsolatedWebcontents,
}
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ComputeIsolation {
    MainThread,
    Worker,
    BrowserEngine,
    NativeProcess,
}
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ContentSandbox {
    None,
    SandboxedFrame,
}
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum MemoryClass {
    Small,
    Medium,
    Large,
}
/// `PresetViewerResourcePolicy`: the host-admitted budget of one surface.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResourcePolicy {
    pub memory_class: MemoryClass,
    /// Maximum UTF-8 source or declared resource bytes for one surface.
    pub max_source_bytes: u64,
    pub max_canvas_pixels: u64,
    pub max_active_canvases: u32,
    pub max_workers: u32,
}
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecoveryPolicy {
    pub max_automatic_retries: u32,
    pub supports_safe_mode: bool,
}
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SurfacePreparation {
    HiddenSafe,
    RequiresVisible,
}
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ReadinessSignal {
    DomStable,
    DecodedResource,
    FramePaint,
    FirstRenderedFrame,
    MediaMetadata,
}
/// `ViewerSurfaceFamily`: the visual family a surface belongs to.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SurfaceFamily {
    Document,
    Code,
    Grid,
    Canvas,
    Media,
    Embedded,
    Fallback,
}
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "kebab-case")]
pub enum SurfaceTrait {
    RichText,
    Monospace,
    Tabular,
    Scrollable,
    Zoomable,
    Paginated,
    Sandboxed,
}

/// `PresetViewerDefinition`.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ViewerDefinition {
    pub id: String,
    /// The format registry's `defaultViewer` ids this viewer answers to.
    pub format_viewer_ids: Vec<String>,
    pub capability: Capability,
    pub source: Source,
    pub runtime: Runtime,
    pub surface_isolation: SurfaceIsolation,
    pub compute_isolation: ComputeIsolation,
    pub content_sandbox: ContentSandbox,
    pub resource_policy: ResourcePolicy,
    pub recovery_policy: RecoveryPolicy,
    pub surface_preparation: SurfacePreparation,
    pub readiness_signal: ReadinessSignal,
    pub surface_family: SurfaceFamily,
    pub surface_traits: Vec<SurfaceTrait>,
}

/// `PresetViewerManifest`.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ViewerManifest {
    pub contract_version: u32,
    pub fallback_viewer_id: String,
    pub viewers: Vec<ViewerDefinition>,
}

impl ViewerManifest {
    /// `parsePresetViewerManifest`: structure, then the cross-entry rules.
    pub fn parse(json: &str) -> Result<Self, String> {
        let manifest: Self = serde_json::from_str(json).map_err(|e| e.to_string())?;
        if manifest.contract_version != CONTRACT_VERSION {
            return Err("Preset viewer manifest uses an unsupported contract version.".into());
        }
        if manifest.viewers.is_empty() {
            return Err("Preset viewer manifest must declare at least one viewer.".into());
        }
        let valid_id = |id: &str| {
            id.split('-').all(|part| {
                !part.is_empty()
                    && part
                        .bytes()
                        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
            }) && id.starts_with(|c: char| c.is_ascii_lowercase())
        };
        let (mut canonical, mut all) = (HashSet::new(), HashSet::new());
        for viewer in &manifest.viewers {
            if !valid_id(&viewer.id) {
                return Err(format!("Preset viewer id {} is not kebab-case.", viewer.id));
            }
            if !canonical.insert(viewer.id.as_str()) {
                return Err(format!(
                    "Preset viewer manifest declares {} more than once.",
                    viewer.id
                ));
            }
            for id in std::iter::once(&viewer.id).chain(&viewer.format_viewer_ids) {
                if !all.insert(id.as_str()) {
                    return Err(format!(
                        "Core viewer id {id} maps to more than one preset viewer."
                    ));
                }
            }
            let traits: HashSet<_> = viewer.surface_traits.iter().collect();
            if traits.len() != viewer.surface_traits.len() {
                return Err(format!(
                    "Preset viewer {} repeats a surface trait.",
                    viewer.id
                ));
            }
        }
        let fallback = manifest
            .viewers
            .iter()
            .find(|v| v.id == manifest.fallback_viewer_id);
        if !fallback
            .is_some_and(|f| f.capability == Capability::Placeholder && f.source == Source::None)
        {
            return Err(
                "Preset viewer fallback must be a declared placeholder with source 'none'.".into(),
            );
        }
        if manifest
            .viewers
            .iter()
            .filter(|v| v.capability == Capability::Placeholder)
            .count()
            != 1
        {
            return Err(
                "Preset viewer manifest must declare exactly one placeholder fallback.".into(),
            );
        }
        Ok(manifest)
    }
    /// The canonical definition of a viewer contribution id.
    pub fn definition(&self, id: &str) -> Option<&ViewerDefinition> {
        self.viewers.iter().find(|v| v.id == id)
    }
    /// `getPresetViewerDefinitionForViewerId`: canonical ids and the format
    /// registry's `defaultViewer` ids resolve through the same manifest.
    pub fn definition_for_viewer_id(&self, viewer_id: &str) -> Option<&ViewerDefinition> {
        self.viewers
            .iter()
            .find(|v| v.id == viewer_id || v.format_viewer_ids.iter().any(|f| f == viewer_id))
    }
}

/// The manifest that ships with this build.
pub fn manifest() -> &'static ViewerManifest {
    static MANIFEST: OnceLock<ViewerManifest> = OnceLock::new();
    MANIFEST.get_or_init(|| {
        ViewerManifest::parse(include_str!("../../../assets/formats/preset-viewers.json"))
            .expect("imported preset viewer manifest")
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn the_shipped_manifest_parses_and_maps_format_viewer_ids() {
        let m = manifest();
        assert_eq!(m.fallback_viewer_id, "document-placeholder");
        assert_eq!(
            m.definition_for_viewer_id("markdown-editor").unwrap().id,
            "markdown"
        );
        assert_eq!(
            m.definition_for_viewer_id("monaco-code").unwrap().id,
            "text"
        );
        assert_eq!(
            m.definition_for_viewer_id("binary-placeholder")
                .unwrap()
                .capability,
            Capability::Placeholder
        );
        assert_eq!(
            m.definition("image-preview").unwrap().source,
            Source::Resource
        );
        assert!(m.definition("csv-table").unwrap().source.reads_content());
    }

    #[test]
    fn manifests_breaking_the_contract_are_refused() {
        let json = include_str!("../../../assets/formats/preset-viewers.json");
        let mut value: serde_json::Value = serde_json::from_str(json).unwrap();
        value["contractVersion"] = 7.into();
        assert!(
            ViewerManifest::parse(&value.to_string())
                .unwrap_err()
                .contains("contract version")
        );
        let mut value: serde_json::Value = serde_json::from_str(json).unwrap();
        value["viewers"][1]["id"] = value["viewers"][0]["id"].clone();
        assert!(
            ViewerManifest::parse(&value.to_string())
                .unwrap_err()
                .contains("more than once")
        );
        let mut value: serde_json::Value = serde_json::from_str(json).unwrap();
        value["fallbackViewerId"] = "markdown".into();
        assert!(
            ViewerManifest::parse(&value.to_string())
                .unwrap_err()
                .contains("fallback")
        );
        let mut value: serde_json::Value = serde_json::from_str(json).unwrap();
        value["viewers"][0]["surprise"] = true.into();
        assert!(ViewerManifest::parse(&value.to_string()).is_err());
    }
}
