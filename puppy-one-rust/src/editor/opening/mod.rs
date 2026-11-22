//! Layer ②: Pure file-opening resolution (`open_plan`, §4.3).
//!
//! No I/O, no UI, and never starts a plugin. Layer ① (menus, Settings) and
//! Layer ③ (`editor::handlers`) consume [`OpenPlan`] produced here.

pub mod candidates;
pub mod preferences;

#[cfg(test)]
mod tests;

pub use candidates::{
    builtin_handler_label, builtin_handlers, external_default_app_handler,
    handler_definition_from_preset, is_content_executing_handler,
};
pub use preferences::{
    FileOverrides, FileTypeDefaults, InvalidationReport, OpenPreferences, parse_handler_map_json,
    rebase_override_map, serialize_handler_map_json,
};

use crate::{
    editor::registry::{self, EditorDocument, SourceKind, manifest::Capability},
    formats::{self, Category, FileFormat},
    plugin_contract::{
        Alternative, CandidateStatus, Catalog, ConversionChain, Distribution, HOST_API_VERSION,
        HandlerId, HandlerKind, OpenPlan, OpenReason, Platform, PluginManifest, RuntimeKind,
        SkippedCandidate, UnavailableReason,
    },
};
use std::collections::BTreeSet;

/// Environment inputs to [`open_plan`].
#[derive(Clone, Debug)]
pub struct OpeningContext<'a> {
    pub preferences: &'a OpenPreferences,
    pub installed: &'a [PluginManifest],
    pub catalog: &'a Catalog,
    pub platform: Platform,
    pub host_api: u32,
    pub app_version: &'a str,
}

impl<'a> OpeningContext<'a> {
    /// Context using the running build's platform, host API version, and
    /// package version.
    pub fn with_defaults(
        preferences: &'a OpenPreferences,
        installed: &'a [PluginManifest],
        catalog: &'a Catalog,
    ) -> Self {
        Self {
            preferences,
            installed,
            catalog,
            platform: crate::platform::os::plugin_platform(),
            host_api: HOST_API_VERSION,
            app_version: env!("CARGO_PKG_VERSION"),
        }
    }
}

/// Document inputs to [`open_plan`].
#[derive(Clone, Debug)]
pub struct OpenRequest<'a> {
    pub document: &'a EditorDocument,
    /// Stable resource key (`Workspace::resource_id` formatted via `resource_key`)
    /// used to look up `fileOverrides`.
    pub resource_id: Option<&'a str>,
    /// Pre-computed format, if already resolved by the caller.
    pub format: Option<&'static FileFormat>,
    /// Leading bytes for bounded content sniffing when `format` is `None` and
    /// name/MIME resolves to `unknown` (`RG-01`).
    pub head: Option<&'a [u8]>,
    /// Set `true` when `format` was obtained through content sniffing so the
    /// content-executing handler guard remains active.
    pub sniffed: bool,
    /// Optional explicit handler requested for this open (e.g. a workbench
    /// restore record or user click on an installable plugin). Evaluated ahead
    /// of stored preferences when present.
    pub explicit_handler: Option<&'a HandlerId>,
}

impl<'a> OpenRequest<'a> {
    pub fn for_document(document: &'a EditorDocument) -> Self {
        Self {
            document,
            resource_id: None,
            format: None,
            head: None,
            sniffed: false,
            explicit_handler: None,
        }
    }
}

/// Computes the deterministic [`OpenPlan`] for a document following §4.3:
/// 1. per-file override (`fileOverrides[resourceId]`)
/// 2. per-type default (`fileTypeDefaults[formatId]`)
/// 3. built-in default (`editor::registry::resolve`, when non-placeholder)
/// 4. matching installed plugin or suggested installable catalog plugin
/// 5. built-in placeholder (`builtin:document-placeholder`)
pub fn open_plan(request: &OpenRequest<'_>, ctx: &OpeningContext<'_>) -> OpenPlan {
    let (format, was_sniffed) = resolve_format(request);
    let builtin_resolved = registry::resolve_with_format(request.document, format);
    let resolved_ext = builtin_resolved.resolved_extension.as_deref();
    let placeholder_id = HandlerId::builtin(&registry::manifest().fallback_viewer_id);
    let builtin_default_id = HandlerId::builtin(builtin_resolved.viewer.id);
    let builtin_is_placeholder = builtin_resolved.viewer.capability() == Capability::Placeholder;

    let mut skipped: Vec<SkippedCandidate> = Vec::new();
    let mut preference_notice: Option<SkippedCandidate> = None;

    let mut record_skip = |handler: HandlerId, reason: UnavailableReason, is_preference: bool| {
        let entry = SkippedCandidate { handler, reason };
        if is_preference && preference_notice.is_none() {
            preference_notice = Some(entry.clone());
        }
        if !skipped.iter().any(|existing| existing == &entry) {
            skipped.push(entry);
        }
    };

    let installed_matches = candidates::matching_installed_handlers(
        ctx.installed,
        request.document,
        format,
        resolved_ext,
        ctx.app_version,
        ctx.host_api,
        ctx.platform,
    );
    let catalog_matches = candidates::matching_catalog_handlers(
        ctx.catalog,
        ctx.installed,
        request.document,
        format,
        resolved_ext,
        ctx.app_version,
        ctx.host_api,
        ctx.platform,
    );

    let mut chosen: Option<(HandlerId, OpenReason)> = None;

    // Optional explicit request (e.g. restore record or direct "Open with" click
    // on an installable catalog plugin).
    if let Some(explicit) = request.explicit_handler {
        match evaluate_preferred(explicit, request.document, was_sniffed, ctx, true) {
            Ok(()) => chosen = Some((explicit.clone(), OpenReason::UserFile)),
            Err(reason) => record_skip(explicit.clone(), reason, false),
        }
    }

    // Step 1: per-file override (`fileOverrides`).
    if chosen.is_none()
        && let Some(resource_id) = request.resource_id
        && let Some(override_handler) = ctx.preferences.file_override(resource_id)
    {
        match evaluate_preferred(override_handler, request.document, was_sniffed, ctx, false) {
            Ok(()) => chosen = Some((override_handler.clone(), OpenReason::UserFile)),
            Err(reason) => record_skip(override_handler.clone(), reason, true),
        }
    }

    // Step 2: per-type default (`fileTypeDefaults`).
    if chosen.is_none()
        && let Some(type_handler) = ctx.preferences.type_default(&format.id)
    {
        match evaluate_preferred(type_handler, request.document, was_sniffed, ctx, false) {
            Ok(()) => chosen = Some((type_handler.clone(), OpenReason::UserType)),
            Err(reason) => record_skip(type_handler.clone(), reason, true),
        }
    }

    // Step 3: built-in default (non-placeholder), enforcing sniffing security.
    if chosen.is_none() && !builtin_is_placeholder {
        if was_sniffed && is_content_executing_handler(&builtin_default_id) {
            record_skip(
                builtin_default_id.clone(),
                UnavailableReason::SniffedExecutableDisallowed,
                false,
            );
            if format.is_text_like() || format.category == Category::Code {
                chosen = Some((HandlerId::builtin("text"), OpenReason::Fallback));
            }
        } else {
            chosen = Some((builtin_default_id.clone(), OpenReason::BuiltinDefault));
        }
    }

    // Step 4: installed compatible plugin or suggested installable catalog plugin
    // (reached for placeholder-grade files or when earlier steps fell through).
    if chosen.is_none() {
        for candidate in &installed_matches {
            match candidate.availability {
                Ok(()) => {
                    chosen = Some((candidate.definition.id.clone(), OpenReason::Suggested));
                    break;
                }
                Err(reason) => record_skip(candidate.definition.id.clone(), reason, false),
            }
        }
    }
    if chosen.is_none() {
        for candidate in &catalog_matches {
            match candidate.availability {
                Ok(()) => {
                    chosen = Some((candidate.handler_id.clone(), OpenReason::Suggested));
                    break;
                }
                Err(reason) => record_skip(candidate.handler_id.clone(), reason, false),
            }
        }
    }

    // Step 5: honest built-in placeholder fallback.
    let (handler, reason) =
        chosen.unwrap_or_else(|| (placeholder_id.clone(), OpenReason::Fallback));

    // Record skipped reasons for any remaining matching installed/catalog candidates
    // that were unavailable.
    for candidate in &installed_matches {
        if let Err(skip_reason) = candidate.availability {
            record_skip(candidate.definition.id.clone(), skip_reason, false);
        }
    }
    for candidate in &catalog_matches {
        if let Err(skip_reason) = candidate.availability {
            record_skip(candidate.handler_id.clone(), skip_reason, false);
        }
    }

    let fallback = compute_fallback(
        &handler,
        &builtin_default_id,
        &placeholder_id,
        was_sniffed,
        format,
    );
    let chain = compute_conversion_chain(&handler, format, ctx);
    let alternatives = collect_alternatives(
        &handler,
        request.document,
        format,
        builtin_resolved.viewer.id,
        builtin_is_placeholder,
        was_sniffed,
        &installed_matches,
        &catalog_matches,
        &mut record_skip,
    );

    OpenPlan {
        format_id: format.id.clone(),
        handler,
        reason,
        fallback,
        alternatives,
        skipped,
        preference_notice,
        chain,
    }
}

fn resolve_format(request: &OpenRequest<'_>) -> (&'static FileFormat, bool) {
    if let Some(format) = request.format {
        return (format, request.sniffed);
    }
    let format_path = if request.document.path.is_empty() {
        request.document.name.as_str()
    } else {
        request.document.path.as_str()
    };
    let by_name = formats::resolve(Some(format_path), request.document.mime.as_deref());
    if by_name.is_known() {
        return (by_name, false);
    }
    if let Some(sniffed) = request.head.and_then(formats::sniff) {
        return (sniffed, true);
    }
    (by_name, request.sniffed)
}

fn evaluate_preferred(
    handler: &HandlerId,
    document: &EditorDocument,
    was_sniffed: bool,
    ctx: &OpeningContext<'_>,
    allow_catalog_installable: bool,
) -> Result<(), UnavailableReason> {
    if was_sniffed && is_content_executing_handler(handler) {
        return Err(UnavailableReason::SniffedExecutableDisallowed);
    }

    match handler {
        HandlerId::Builtin(id) => {
            if registry::manifest().definition(id).is_some() {
                Ok(())
            } else {
                Err(UnavailableReason::NotFound)
            }
        }
        HandlerId::App(_) => {
            if document.source_kind.is_local() {
                Ok(())
            } else {
                Err(UnavailableReason::SourceNotAllowed)
            }
        }
        HandlerId::Plugin {
            plugin_id,
            handler_id,
        } => {
            if let Some(plugin) = ctx.installed.iter().find(|p| p.id == *plugin_id) {
                plugin.check_compatibility(ctx.app_version, ctx.host_api, ctx.platform)?;
                let Some(contrib) = plugin.handlers.iter().find(|h| h.id == *handler_id) else {
                    return Err(UnavailableReason::NotFound);
                };
                if !candidates::source_allowed(&contrib.sources, document.source_kind) {
                    return Err(UnavailableReason::SourceNotAllowed);
                }
                return Ok(());
            }

            if allow_catalog_installable
                && let Some(cat_plugin) = ctx.catalog.plugins.iter().find(|p| p.id == *plugin_id)
                && let Some(version) =
                    cat_plugin.newest_compatible(ctx.app_version, ctx.host_api, ctx.platform)
                && let Some(contrib) = version.handlers.iter().find(|h| h.id == *handler_id)
            {
                if !candidates::source_allowed(&contrib.sources, document.source_kind) {
                    return Err(UnavailableReason::SourceNotAllowed);
                }
                return Ok(());
            }

            Err(UnavailableReason::NotInstalled)
        }
    }
}

fn compute_fallback(
    chosen: &HandlerId,
    builtin_default: &HandlerId,
    placeholder: &HandlerId,
    was_sniffed: bool,
    format: &'static FileFormat,
) -> HandlerId {
    if chosen != builtin_default {
        if was_sniffed && is_content_executing_handler(builtin_default) {
            if format.is_text_like() || format.category == Category::Code {
                return HandlerId::builtin("text");
            }
            return placeholder.clone();
        }
        return builtin_default.clone();
    }
    placeholder.clone()
}

fn compute_conversion_chain(
    handler: &HandlerId,
    format: &'static FileFormat,
    ctx: &OpeningContext<'_>,
) -> Option<ConversionChain> {
    let (plugin_id, handler_id) = handler.plugin_parts()?;
    let output_format = ctx
        .installed
        .iter()
        .find(|p| p.id == plugin_id)
        .and_then(|p| p.handlers.iter().find(|h| h.id == handler_id))
        .filter(|h| h.kind == HandlerKind::Converter)
        .and_then(|h| h.output.as_deref())
        .or_else(|| {
            ctx.catalog
                .plugins
                .iter()
                .find(|p| p.id == plugin_id)
                .and_then(|p| p.newest_compatible(ctx.app_version, ctx.host_api, ctx.platform))
                .and_then(|v| v.handlers.iter().find(|h| h.id == handler_id))
                .filter(|h| h.kind == HandlerKind::Converter)
                .and_then(|h| h.output.as_deref())
        })?;

    let target_fmt = formats::all()
        .iter()
        .find(|f| f.id == output_format)
        .unwrap_or_else(formats::unknown);
    let synth_doc = EditorDocument {
        path: format!("converted.{}", target_fmt.id),
        name: format!("converted.{}", target_fmt.id),
        kind: target_fmt.semantic_kind().to_owned(),
        mime: target_fmt.mime_types.first().cloned(),
        source_kind: SourceKind::Local,
    };
    let target_viewer = HandlerId::builtin(
        registry::resolve_with_format(&synth_doc, target_fmt)
            .viewer
            .id,
    );

    Some(ConversionChain {
        converter: handler.clone(),
        source_format: format.id.clone(),
        target_format: output_format.to_owned(),
        target_viewer,
    })
}

#[allow(clippy::too_many_arguments)]
fn collect_alternatives(
    chosen: &HandlerId,
    document: &EditorDocument,
    format: &'static FileFormat,
    builtin_default_id: &str,
    builtin_is_placeholder: bool,
    was_sniffed: bool,
    installed_matches: &[candidates::EvaluatedInstalled],
    catalog_matches: &[candidates::EvaluatedCatalog<'_>],
    record_skip: &mut impl FnMut(HandlerId, UnavailableReason, bool),
) -> Vec<Alternative> {
    let mut alternatives = Vec::new();
    let mut seen = BTreeSet::new();
    seen.insert(chosen.clone());

    let placeholder_id = registry::manifest().fallback_viewer_id.as_str();

    // 1. Built-in candidates for this format.
    for def in candidates::builtin_candidates_for_format(document, format, builtin_default_id) {
        if def.id == placeholder_id && !builtin_is_placeholder {
            continue;
        }
        let id = HandlerId::builtin(&def.id);
        if was_sniffed && is_content_executing_handler(&id) {
            record_skip(id, UnavailableReason::SniffedExecutableDisallowed, false);
            continue;
        }
        if seen.insert(id.clone()) {
            alternatives.push(Alternative {
                handler: id,
                label: builtin_handler_label(&def.id).to_owned(),
                kind: match def.capability {
                    Capability::Edit => HandlerKind::Editor,
                    Capability::Preview | Capability::Placeholder => HandlerKind::Viewer,
                },
                runtime: RuntimeKind::Native,
                distribution: Distribution::Bundled,
                status: CandidateStatus::Available,
            });
        }
    }

    // 2. Matching installed plugins (available only).
    for item in installed_matches {
        if item.availability.is_ok() && seen.insert(item.definition.id.clone()) {
            alternatives.push(Alternative {
                handler: item.definition.id.clone(),
                label: item.definition.label.clone(),
                kind: item.definition.kind,
                runtime: item.definition.runtime,
                distribution: Distribution::OnDemand,
                status: CandidateStatus::Available,
            });
        }
    }

    // 3. Matching installable catalog plugins (compatible and source-allowed).
    for item in catalog_matches {
        if item.availability.is_ok() && seen.insert(item.handler_id.clone()) {
            alternatives.push(Alternative {
                handler: item.handler_id.clone(),
                label: item.handler.label.clone(),
                kind: item.handler.kind,
                runtime: item.handler.runtime,
                distribution: Distribution::OnDemand,
                status: CandidateStatus::Installable {
                    size_bytes: item.version.archive_size_bytes,
                },
            });
        }
    }

    // 4. External OS default app (`app:default`), local files only.
    let external_id = HandlerId::system_default_app();
    if seen.insert(external_id.clone()) {
        if document.source_kind.is_local() {
            alternatives.push(Alternative {
                handler: external_id,
                label: external_default_app_handler().label,
                kind: HandlerKind::External,
                runtime: RuntimeKind::Native,
                distribution: Distribution::Bundled,
                status: CandidateStatus::Available,
            });
        } else {
            record_skip(external_id, UnavailableReason::SourceNotAllowed, false);
        }
    }

    alternatives
}

/// Summary of one file type exposed to Layer ① (`Settings -> File types`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileTypeEntry {
    pub format_id: String,
    pub label: String,
    pub extensions: Vec<String>,
    pub default_handler: HandlerId,
    pub active_handler: HandlerId,
    pub is_custom: bool,
    pub options: Vec<Alternative>,
}

/// Builds the list of file types shown in Settings → File types using only
/// Layer ② resolution (so Layer ① never reads manifests or plugin stores directly).
pub fn configurable_file_types(ctx: &OpeningContext<'_>) -> Vec<FileTypeEntry> {
    let mut entries = Vec::new();
    for format in formats::all() {
        let sample_name = format
            .extensions
            .first()
            .map(|ext| format!("sample{ext}"))
            .or_else(|| format.filenames.first().cloned())
            .unwrap_or_else(|| format.id.clone());
        let doc = EditorDocument {
            path: sample_name.clone(),
            name: sample_name,
            kind: format.semantic_kind().to_owned(),
            mime: format.mime_types.first().cloned(),
            source_kind: SourceKind::Local,
        };
        let req = OpenRequest {
            document: &doc,
            resource_id: None,
            format: Some(format),
            head: None,
            sniffed: false,
            explicit_handler: None,
        };
        let plan = open_plan(&req, ctx);

        let builtin_default =
            HandlerId::builtin(registry::resolve_with_format(&doc, format).viewer.id);
        let is_custom = ctx.preferences.type_default(&format.id).is_some();

        // Build full option list starting with the active handler + alternatives.
        let mut options = Vec::with_capacity(plan.alternatives.len() + 1);
        options.push(active_as_alternative(&plan.handler, ctx));
        options.extend(plan.alternatives);

        let has_multiple_in_app = options
            .iter()
            .filter(|opt| opt.kind != HandlerKind::External)
            .count()
            > 1;
        let prominent_document = matches!(
            format.category,
            Category::Document | Category::Markdown | Category::App
        ) || matches!(
            format.id.as_str(),
            "csv" | "tsv" | "json" | "html" | "svg" | "excalidraw" | "context-map" | "puppyflow"
        );

        if is_custom || has_multiple_in_app || prominent_document {
            entries.push(FileTypeEntry {
                format_id: format.id.clone(),
                label: format.label.clone(),
                extensions: format.extensions.clone(),
                default_handler: builtin_default,
                active_handler: plan.handler,
                is_custom,
                options,
            });
        }
    }
    entries
}

/// Resolves a display label for any [`HandlerId`] using built-in definitions,
/// installed plugins, or catalog metadata.
pub fn handler_display_label(handler: &HandlerId, ctx: &OpeningContext<'_>) -> String {
    match handler {
        HandlerId::Builtin(id) => builtin_handler_label(id).to_owned(),
        HandlerId::App(id) if id == crate::plugin_contract::handler::SYSTEM_DEFAULT_APP_ID => {
            external_default_app_handler().label
        }
        HandlerId::App(id) => id.clone(),
        HandlerId::Plugin {
            plugin_id,
            handler_id,
        } => ctx
            .installed
            .iter()
            .find(|p| p.id == *plugin_id)
            .and_then(|p| p.handlers.iter().find(|h| h.id == *handler_id))
            .map(|h| h.label.clone())
            .or_else(|| {
                ctx.catalog
                    .plugins
                    .iter()
                    .find(|p| p.id == *plugin_id)
                    .and_then(|p| p.newest_compatible(ctx.app_version, ctx.host_api, ctx.platform))
                    .and_then(|v| v.handlers.iter().find(|h| h.id == *handler_id))
                    .map(|h| h.label.clone())
            })
            .unwrap_or_else(|| handler.to_string()),
    }
}

fn active_as_alternative(handler: &HandlerId, ctx: &OpeningContext<'_>) -> Alternative {
    match handler {
        HandlerId::Builtin(id) => {
            let kind = registry::manifest()
                .definition(id)
                .map(|def| match def.capability {
                    Capability::Edit => HandlerKind::Editor,
                    Capability::Preview | Capability::Placeholder => HandlerKind::Viewer,
                })
                .unwrap_or(HandlerKind::Viewer);
            Alternative {
                handler: handler.clone(),
                label: builtin_handler_label(id).to_owned(),
                kind,
                runtime: RuntimeKind::Native,
                distribution: Distribution::Bundled,
                status: CandidateStatus::Available,
            }
        }
        HandlerId::App(_) => Alternative {
            handler: handler.clone(),
            label: handler_display_label(handler, ctx),
            kind: HandlerKind::External,
            runtime: RuntimeKind::Native,
            distribution: Distribution::Bundled,
            status: CandidateStatus::Available,
        },
        HandlerId::Plugin {
            plugin_id,
            handler_id,
        } => {
            if let Some(contrib) = ctx
                .installed
                .iter()
                .find(|p| p.id == *plugin_id)
                .and_then(|p| p.handlers.iter().find(|h| h.id == *handler_id))
            {
                return Alternative {
                    handler: handler.clone(),
                    label: contrib.label.clone(),
                    kind: contrib.kind,
                    runtime: contrib.runtime,
                    distribution: Distribution::OnDemand,
                    status: CandidateStatus::Available,
                };
            }
            if let Some((ver, contrib)) = ctx
                .catalog
                .plugins
                .iter()
                .find(|p| p.id == *plugin_id)
                .and_then(|p| p.newest_compatible(ctx.app_version, ctx.host_api, ctx.platform))
                .and_then(|v| {
                    v.handlers
                        .iter()
                        .find(|h| h.id == *handler_id)
                        .map(|h| (v, h))
                })
            {
                return Alternative {
                    handler: handler.clone(),
                    label: contrib.label.clone(),
                    kind: contrib.kind,
                    runtime: contrib.runtime,
                    distribution: Distribution::OnDemand,
                    status: CandidateStatus::Installable {
                        size_bytes: ver.archive_size_bytes,
                    },
                };
            }
            Alternative {
                handler: handler.clone(),
                label: handler.to_string(),
                kind: HandlerKind::Viewer,
                runtime: RuntimeKind::Web,
                distribution: Distribution::OnDemand,
                status: CandidateStatus::Unavailable(UnavailableReason::NotInstalled),
            }
        }
    }
}
