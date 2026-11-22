//! The preset viewer manifest (`presetViewerManifest.json`, parsed like
//! `shared/presetViewerManifest.js`): the process-neutral contract of every
//! viewer that ships with the product. A viewer implementation only adds
//! behaviour; what it may do — capability, input, isolation, budgets — is
//! declared here.
use serde::Deserialize;
use std::sync::OnceLock;
mod validation;

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
    pub max_active_canvases: u64,
    pub max_workers: u64,
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
        let mut value: serde_json::Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
        validation::validate(&value)?;
        validation::normalize_numbers(&mut value);
        serde_json::from_value(value).map_err(|e| e.to_string())
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
    fn actual_typescript_characterization_oracle_preserves_acceptance_and_diagnostics() {
        let oracle: serde_json::Value = serde_json::from_str(include_str!(
            "../../../fixtures/preset-manifest-oracle.json"
        ))
        .unwrap();
        let cases = oracle["cases"].as_array().unwrap();
        assert_eq!(cases.len(), 112);
        let mut failures = Vec::new();
        for case in cases {
            let name = case["name"].as_str().unwrap();
            let result = ViewerManifest::parse(&case["input"].to_string());
            if case["main"]["accepted"] == true {
                let parsed = match result {
                    Ok(parsed) => parsed,
                    Err(error) => {
                        failures.push(format!("{name}: refused valid input: {error}"));
                        continue;
                    }
                };
                let mut expected = case["main"]["value"].clone();
                for viewer in expected["viewers"].as_array_mut().unwrap() {
                    viewer.as_object_mut().unwrap().remove("contractVersion");
                }
                let expected: ViewerManifest = serde_json::from_value(expected).unwrap();
                assert_eq!(parsed, expected, "{name}");
                for viewer in &parsed.viewers {
                    for id in std::iter::once(&viewer.id).chain(&viewer.format_viewer_ids) {
                        assert!(
                            std::ptr::eq(parsed.definition_for_viewer_id(id).unwrap(), viewer),
                            "{name}: {id}"
                        );
                    }
                }
                assert!(
                    parsed
                        .definition_for_viewer_id("unknown-fixture-viewer")
                        .is_none()
                );
            } else {
                match result {
                    Ok(_) => failures.push(format!("{name}: accepted rejected TS input")),
                    Err(error) if error == case["main"]["message"].as_str().unwrap() => (),
                    Err(error) => failures.push(format!(
                        "{name}: {error}; expected {}",
                        case["main"]["message"]
                    )),
                }
            }
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }

    #[test]
    fn javascript_safe_integer_budgets_and_whole_number_json_notation_are_preserved() {
        let oracle: serde_json::Value = serde_json::from_str(include_str!(
            "../../../fixtures/preset-manifest-oracle.json"
        ))
        .unwrap();
        let base = oracle["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|case| case["name"] == "valid worker")
            .unwrap()["input"]
            .clone();
        for field in [
            "maxSourceBytes",
            "maxCanvasPixels",
            "maxActiveCanvases",
            "maxWorkers",
        ] {
            for number in [4_294_967_296_u64, 9_007_199_254_740_991] {
                let mut input = base.clone();
                input["viewers"][0]["resourcePolicy"][field] = number.into();
                assert!(
                    ViewerManifest::parse(&input.to_string()).is_ok(),
                    "{field}: {number}"
                );
            }
            let mut input = base.clone();
            input["viewers"][0]["resourcePolicy"][field] = 9_007_199_254_740_992_u64.into();
            assert!(
                ViewerManifest::parse(&input.to_string())
                    .unwrap_err()
                    .contains("safe integer"),
                "{field}"
            );
        }
        let integer = ViewerManifest::parse(&base.to_string()).unwrap();
        let mut floating = base;
        floating["contractVersion"] = 8.0.into();
        floating["viewers"][0]["resourcePolicy"]["maxWorkers"] = 1.0.into();
        floating["viewers"][0]["recoveryPolicy"]["maxAutomaticRetries"] = 0.0.into();
        assert_eq!(
            ViewerManifest::parse(&floating.to_string()).unwrap(),
            integer
        );
    }

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

    /// `sharedPresetManifest.test.mjs`: `preserves index labels and
    /// unknown-field insertion order`; `preserves the first semantic
    /// violation`; the `formatViewerIds` and `surfaceTraits` diagnostics of
    /// the main contract.
    #[test]
    fn diagnostics_name_the_definition_and_its_first_violation() {
        let json = include_str!("../../../assets/formats/preset-viewers.json");
        let base: serde_json::Value = serde_json::from_str(json).unwrap();
        let refused = |edit: &dyn Fn(&mut serde_json::Value)| {
            let mut value = base.clone();
            edit(&mut value);
            ViewerManifest::parse(&value.to_string()).unwrap_err()
        };
        assert_eq!(
            refused(&|v| v["viewers"][7] = serde_json::Value::Null),
            "Preset viewer definition at index 7 must be an object."
        );
        assert_eq!(
            refused(&|v| v["viewers"][7] = serde_json::json!({"z": true, "a": true})),
            "Preset viewer definition at index 7 has unknown field(s): z, a."
        );
        let id = base["viewers"][0]["id"].as_str().unwrap().to_owned();
        assert_eq!(
            refused(&|v| {
                let viewer = &mut v["viewers"][0];
                viewer["capability"] = "edit".into();
                viewer["source"] = "none".into();
                viewer["computeIsolation"] = "worker".into();
            }),
            format!("Editable preset viewer {id} must receive content or a resource.")
        );
        for (key, value, message) in [
            (
                "formatViewerIds",
                serde_json::Value::Null,
                "has invalid or repeated format viewer ids.",
            ),
            (
                "formatViewerIds",
                serde_json::json!(["alias", "alias"]),
                "has invalid or repeated format viewer ids.",
            ),
            (
                "surfaceTraits",
                serde_json::Value::Null,
                "has unsupported or repeated surface traits.",
            ),
            (
                "surfaceTraits",
                serde_json::json!(["scrollable", "scrollable"]),
                "has unsupported or repeated surface traits.",
            ),
        ] {
            assert_eq!(
                refused(&|v| v["viewers"][0][key] = value.clone()),
                format!("Preset viewer {id} {message}"),
                "{key} {value}"
            );
        }
    }
}
