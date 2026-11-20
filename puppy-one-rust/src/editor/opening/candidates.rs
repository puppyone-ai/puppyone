//! Candidate projection and availability checks across built-in preset
//! viewers, installed official plugins, catalog installable plugins, and the
//! OS default application (§4.2, §4.3).

use crate::{
    editor::registry::{
        self, EditorDocument, SourceKind,
        manifest::{
            Capability, ComputeIsolation, ContentSandbox, MemoryClass, ReadinessSignal,
            Runtime as PresetRuntime, Source as PresetSource, SurfaceFamily, SurfaceIsolation,
            SurfacePreparation, SurfaceTrait, ViewerDefinition,
        },
    },
    formats::{self, FileFormat},
    plugin_contract::{
        Catalog, CatalogHandlerSummary, CatalogVersion, ComputeIsolation as ContractCompute,
        ContentSandbox as ContractSandbox, Distribution, HOST_API_VERSION, HandlerCapability,
        HandlerDefinition, HandlerId, HandlerKind, HandlerSource, Handles, LoadingPolicy,
        MemoryClass as ContractMemory, Permissions, Platform, PluginManifest,
        ReadinessSignal as ContractReadiness, RecoveryPolicy as ContractRecovery,
        ResourcePolicy as ContractResource, RuntimeKind, SourceScope,
        SurfaceFamily as ContractFamily, SurfaceIsolation as ContractSurfaceIso,
        SurfacePreparation as ContractPrep, SurfaceTrait as ContractTrait, UnavailableReason,
    },
};
use std::collections::BTreeSet;

/// Human-readable default label for a built-in preset viewer ID.
pub fn builtin_handler_label(viewer_id: &str) -> &'static str {
    match viewer_id {
        "markdown" => "Markdown",
        "text" => "Plain Text",
        "json" => "JSON",
        "csv-table" => "Table",
        "html-artifact" => "HTML Preview",
        "app-preview" => "App Preview",
        "image-preview" => "Image Preview",
        "pdf-preview" => "PDF Preview",
        "office-preview" => "Office Preview",
        "database-preview" => "Database Preview",
        "audio-preview" => "Audio Preview",
        "video-preview" => "Video Preview",
        "excalidraw" => "Whiteboard",
        "context-map" => "Context Map",
        "puppyflow" => "PuppyFlow",
        "document-placeholder" => "File Summary",
        _ => "Viewer",
    }
}

/// Projects a built-in [`ViewerDefinition`] from `assets/formats/preset-viewers.json`
/// into the unified [`HandlerDefinition`] without altering the imported manifest (§4.2).
pub fn handler_definition_from_preset(def: &ViewerDefinition) -> HandlerDefinition {
    let mut format_ids = BTreeSet::new();
    let mut extensions = BTreeSet::new();
    let mut mime_types = BTreeSet::new();

    for fmt in formats::all() {
        let matches_default =
            fmt.default_viewer == def.id || def.format_viewer_ids.contains(&fmt.default_viewer);
        let matches_available = fmt
            .available_viewers
            .iter()
            .any(|v| v == &def.id || def.format_viewer_ids.contains(v));
        let matches_special = (def.id == "json" && matches!(fmt.id.as_str(), "json" | "jsonl"))
            || (def.id == "context-map" && fmt.id == "context-map")
            || (def.id == "puppyflow" && fmt.id == "puppyflow")
            || (def.id == "excalidraw" && fmt.id == "excalidraw");
        if matches_default || matches_available || matches_special {
            format_ids.insert(fmt.id.clone());
            for ext in &fmt.extensions {
                extensions.insert(ext.to_lowercase());
            }
            for mime in &fmt.mime_types {
                mime_types.insert(mime.to_lowercase());
            }
        }
    }

    HandlerDefinition {
        id: HandlerId::builtin(&def.id),
        label: builtin_handler_label(&def.id).to_owned(),
        handles: Handles {
            format_ids: format_ids.into_iter().collect(),
            extensions: extensions.into_iter().collect(),
            mime_types: mime_types.into_iter().collect(),
        },
        kind: match def.capability {
            Capability::Edit => HandlerKind::Editor,
            Capability::Preview | Capability::Placeholder => HandlerKind::Viewer,
        },
        runtime: RuntimeKind::Native,
        loading: match def.runtime {
            PresetRuntime::Eager => LoadingPolicy::Eager,
            PresetRuntime::Lazy => LoadingPolicy::Lazy,
        },
        distribution: Distribution::Bundled,
        host_api: HOST_API_VERSION,
        size_bytes: 0,
        permissions: Permissions::default(),
        output: None,
        sources: vec![
            SourceScope::Local,
            SourceScope::Cloud,
            SourceScope::RemoteDevice,
        ],
        capability: match def.capability {
            Capability::Edit => HandlerCapability::Edit,
            Capability::Preview => HandlerCapability::Preview,
            Capability::Placeholder => HandlerCapability::Placeholder,
        },
        source: match def.source {
            PresetSource::Content => HandlerSource::Content,
            PresetSource::Resource => HandlerSource::Resource,
            PresetSource::ResourceSession => HandlerSource::ResourceSession,
            PresetSource::ContentAndResource => HandlerSource::ContentAndResource,
            PresetSource::None => HandlerSource::None,
        },
        surface_isolation: match def.surface_isolation {
            SurfaceIsolation::Inline => ContractSurfaceIso::Inline,
            SurfaceIsolation::IsolatedWebcontents => ContractSurfaceIso::IsolatedWebcontents,
        },
        compute_isolation: match def.compute_isolation {
            ComputeIsolation::MainThread => ContractCompute::MainThread,
            ComputeIsolation::Worker => ContractCompute::Worker,
            ComputeIsolation::BrowserEngine => ContractCompute::BrowserEngine,
            ComputeIsolation::NativeProcess => ContractCompute::NativeProcess,
        },
        content_sandbox: match def.content_sandbox {
            ContentSandbox::None => ContractSandbox::None,
            ContentSandbox::SandboxedFrame => ContractSandbox::SandboxedFrame,
        },
        resource_policy: ContractResource {
            memory_class: match def.resource_policy.memory_class {
                MemoryClass::Small => ContractMemory::Small,
                MemoryClass::Medium => ContractMemory::Medium,
                MemoryClass::Large => ContractMemory::Large,
            },
            max_source_bytes: def.resource_policy.max_source_bytes,
            max_canvas_pixels: def.resource_policy.max_canvas_pixels,
            max_active_canvases: def.resource_policy.max_active_canvases,
            max_workers: def.resource_policy.max_workers,
        },
        recovery_policy: ContractRecovery {
            max_automatic_retries: def.recovery_policy.max_automatic_retries,
            supports_safe_mode: def.recovery_policy.supports_safe_mode,
        },
        surface_preparation: match def.surface_preparation {
            SurfacePreparation::HiddenSafe => ContractPrep::HiddenSafe,
            SurfacePreparation::RequiresVisible => ContractPrep::RequiresVisible,
        },
        readiness_signal: match def.readiness_signal {
            ReadinessSignal::DomStable => ContractReadiness::DomStable,
            ReadinessSignal::DecodedResource => ContractReadiness::DecodedResource,
            ReadinessSignal::FramePaint => ContractReadiness::FramePaint,
            ReadinessSignal::FirstRenderedFrame => ContractReadiness::FirstRenderedFrame,
            ReadinessSignal::MediaMetadata => ContractReadiness::MediaMetadata,
        },
        surface_family: match def.surface_family {
            SurfaceFamily::Document => ContractFamily::Document,
            SurfaceFamily::Code => ContractFamily::Code,
            SurfaceFamily::Grid => ContractFamily::Grid,
            SurfaceFamily::Canvas => ContractFamily::Canvas,
            SurfaceFamily::Media => ContractFamily::Media,
            SurfaceFamily::Embedded => ContractFamily::Embedded,
            SurfaceFamily::Fallback => ContractFamily::Fallback,
        },
        surface_traits: def
            .surface_traits
            .iter()
            .map(|t| match t {
                SurfaceTrait::RichText => ContractTrait::RichText,
                SurfaceTrait::Monospace => ContractTrait::Monospace,
                SurfaceTrait::Tabular => ContractTrait::Tabular,
                SurfaceTrait::Scrollable => ContractTrait::Scrollable,
                SurfaceTrait::Zoomable => ContractTrait::Zoomable,
                SurfaceTrait::Paginated => ContractTrait::Paginated,
                SurfaceTrait::Sandboxed => ContractTrait::Sandboxed,
            })
            .collect(),
    }
}

/// All built-in preset viewers projected to [`HandlerDefinition`]s.
pub fn builtin_handlers() -> Vec<HandlerDefinition> {
    registry::manifest()
        .viewers
        .iter()
        .map(handler_definition_from_preset)
        .collect()
}

/// The external "Open in default app" handler (`app:default`), backed by
/// `platform::desktop::open` for local files only.
pub fn external_default_app_handler() -> HandlerDefinition {
    HandlerDefinition {
        id: HandlerId::system_default_app(),
        label: "Default App".to_owned(),
        handles: Handles::default(),
        kind: HandlerKind::External,
        runtime: RuntimeKind::Native,
        loading: LoadingPolicy::Eager,
        distribution: Distribution::Bundled,
        host_api: HOST_API_VERSION,
        size_bytes: 0,
        permissions: Permissions::default(),
        output: None,
        sources: vec![SourceScope::Local],
        capability: HandlerCapability::Placeholder,
        source: HandlerSource::None,
        surface_isolation: ContractSurfaceIso::Inline,
        compute_isolation: ContractCompute::NativeProcess,
        content_sandbox: ContractSandbox::None,
        resource_policy: ContractResource::default(),
        recovery_policy: ContractRecovery::default(),
        surface_preparation: ContractPrep::HiddenSafe,
        readiness_signal: ContractReadiness::DomStable,
        surface_family: ContractFamily::Fallback,
        surface_traits: Vec::new(),
    }
}

/// Whether `handler` executes active document content and must therefore never
/// be selected for a format inferred solely by content sniffing (§4.3, `RG-01`).
pub fn is_content_executing_handler(handler: &HandlerId) -> bool {
    matches!(
        handler,
        HandlerId::Builtin(id) if matches!(id.as_str(), "html-artifact" | "app-preview")
    )
}

/// Checks whether a handler's allowed [`SourceScope`] list permits the document's
/// real [`SourceKind`]. Unknown sources fail closed.
pub fn source_allowed(sources: &[SourceScope], source_kind: SourceKind) -> bool {
    match source_kind {
        SourceKind::Local => sources.contains(&SourceScope::Local),
        SourceKind::Cloud => sources.contains(&SourceScope::Cloud),
        SourceKind::RemoteDevice => sources.contains(&SourceScope::RemoteDevice),
        SourceKind::Unknown => false,
    }
}

/// Checks whether a plugin's [`Handles`] specification matches the document and
/// its resolved format.
pub fn handles_document(
    handles: &Handles,
    document: &EditorDocument,
    format: &'static FileFormat,
    resolved_extension: Option<&str>,
) -> bool {
    if handles.format_ids.iter().any(|id| id == &format.id) {
        return true;
    }

    let matched_ext = resolved_extension
        .map(str::to_lowercase)
        .or_else(|| formats::matched_extension(&document.name));
    if let Some(ext) = matched_ext.as_deref() {
        let dotted = format!(".{ext}");
        if handles
            .extensions
            .iter()
            .any(|candidate| candidate.eq_ignore_ascii_case(&dotted))
        {
            return true;
        }
    }

    if let Some(mime) = document.mime.as_deref() {
        let normalized = mime
            .split(';')
            .next()
            .unwrap_or_default()
            .trim()
            .to_lowercase();
        if !normalized.is_empty()
            && handles
                .mime_types
                .iter()
                .any(|candidate| candidate.eq_ignore_ascii_case(&normalized))
        {
            return true;
        }
    }

    false
}

/// Built-in handlers applicable to `format`, ordered with the built-in default
/// first, followed by declared `availableViewers` (mapped through the canonical
/// preset manifest), and `builtin:text` for text-like formats.
pub fn builtin_candidates_for_format(
    document: &EditorDocument,
    format: &'static FileFormat,
    builtin_default_id: &str,
) -> Vec<&'static ViewerDefinition> {
    let manifest = registry::manifest();
    let mut out: Vec<&'static ViewerDefinition> = Vec::new();
    let mut seen = BTreeSet::new();

    let mut push_id = |viewer_id: &str| {
        if let Some(def) = manifest.definition_for_viewer_id(viewer_id)
            && seen.insert(def.id.as_str())
        {
            out.push(def);
        }
    };

    // Keep the built-in default first.
    push_id(builtin_default_id);

    // Add every available viewer declared in `file-formats.json` (mapped to canonical ID).
    for viewer_id in &format.available_viewers {
        push_id(viewer_id);
    }

    // Text-like formats and editable content-based built-ins can always be inspected
    // in `builtin:text` (e.g. JSON, CSV, Markdown, HTML, SVG, Whiteboard source).
    if format.is_text_like() || matches!(document.kind.as_str(), "markdown" | "json" | "html") {
        push_id("text");
    }

    out
}

/// Evaluates whether an installed plugin matches `document` and is usable.
pub struct EvaluatedInstalled {
    pub definition: HandlerDefinition,
    pub availability: Result<(), UnavailableReason>,
}

pub fn matching_installed_handlers(
    installed: &[PluginManifest],
    document: &EditorDocument,
    format: &'static FileFormat,
    resolved_extension: Option<&str>,
    app_version: &str,
    host_api: u32,
    platform: Platform,
) -> Vec<EvaluatedInstalled> {
    let mut results = Vec::new();
    for plugin in installed {
        let compat = plugin.check_compatibility(app_version, host_api, platform);
        for def in plugin.handler_definitions() {
            if !handles_document(&def.handles, document, format, resolved_extension) {
                continue;
            }
            let availability = match compat {
                Err(reason) => Err(reason),
                Ok(()) if !source_allowed(&def.sources, document.source_kind) => {
                    Err(UnavailableReason::SourceNotAllowed)
                }
                Ok(()) => Ok(()),
            };
            results.push(EvaluatedInstalled {
                definition: def,
                availability,
            });
        }
    }
    results
}

/// One matching handler entry discovered from the signed catalog.
pub struct EvaluatedCatalog<'a> {
    pub plugin_id: &'a str,
    pub version: &'a CatalogVersion,
    pub handler: &'a CatalogHandlerSummary,
    pub handler_id: HandlerId,
    pub availability: Result<(), UnavailableReason>,
}

/// Evaluates catalog plugins that are NOT already installed and match `document`.
#[allow(clippy::too_many_arguments)]
pub fn matching_catalog_handlers<'a>(
    catalog: &'a Catalog,
    installed: &[PluginManifest],
    document: &EditorDocument,
    format: &'static FileFormat,
    resolved_extension: Option<&str>,
    app_version: &str,
    host_api: u32,
    platform: Platform,
) -> Vec<EvaluatedCatalog<'a>> {
    let installed_ids: BTreeSet<&str> = installed.iter().map(|p| p.id.as_str()).collect();
    let mut results = Vec::new();

    for plugin in &catalog.plugins {
        if installed_ids.contains(plugin.id.as_str()) {
            continue;
        }
        if let Some(version) = plugin.newest_compatible(app_version, host_api, platform) {
            for handler in &version.handlers {
                if !handles_document(&handler.handles, document, format, resolved_extension) {
                    continue;
                }
                let availability = if !source_allowed(&handler.sources, document.source_kind) {
                    Err(UnavailableReason::SourceNotAllowed)
                } else {
                    Ok(())
                };
                results.push(EvaluatedCatalog {
                    plugin_id: &plugin.id,
                    version,
                    handler,
                    handler_id: HandlerId::plugin(&plugin.id, &handler.id),
                    availability,
                });
            }
        } else if let Some(newest_any) = plugin
            .versions
            .iter()
            .filter_map(|v| semver::Version::parse(&v.version).ok().map(|sv| (sv, v)))
            .max_by(|(a, _), (b, _)| a.cmp(b))
            .map(|(_, v)| v)
        {
            let reason = newest_any
                .check_compatibility(app_version, host_api, platform)
                .err()
                .unwrap_or(UnavailableReason::PlatformUnsupported);
            for handler in &newest_any.handlers {
                if !handles_document(&handler.handles, document, format, resolved_extension) {
                    continue;
                }
                results.push(EvaluatedCatalog {
                    plugin_id: &plugin.id,
                    version: newest_any,
                    handler,
                    handler_id: HandlerId::plugin(&plugin.id, &handler.id),
                    availability: Err(reason),
                });
            }
        }
    }

    results
}
