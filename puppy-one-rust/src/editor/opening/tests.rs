use super::*;
use crate::plugin_contract::{
    CatalogHandlerSummary, CatalogPlugin, CatalogVersion, DocumentPermission, Handles,
    LicenseEntry, MANIFEST_SCHEMA_VERSION, ManifestFile, PackageLimits, Permissions,
    PluginHandlerManifest, SourceScope, catalog::CATALOG_SCHEMA_VERSION,
};
use core::prelude::v1::test;

#[allow(clippy::too_many_arguments)]
fn sample_plugin(
    plugin_id: &str,
    handler_id: &str,
    format_ids: &[&str],
    extensions: &[&str],
    kind: HandlerKind,
    runtime: RuntimeKind,
    sources: Vec<SourceScope>,
    output: Option<&str>,
    platforms: Vec<Platform>,
    host_api: u32,
    min_app_version: &str,
) -> PluginManifest {
    PluginManifest {
        schema_version: MANIFEST_SCHEMA_VERSION,
        id: plugin_id.to_owned(),
        version: "1.0.0".to_owned(),
        publisher: "puppyone".to_owned(),
        host_api,
        min_app_version: min_app_version.to_owned(),
        platforms,
        handlers: vec![PluginHandlerManifest {
            id: handler_id.to_owned(),
            label: format!("Plugin {handler_id}"),
            handles: Handles {
                format_ids: format_ids.iter().map(|s| (*s).to_owned()).collect(),
                extensions: extensions.iter().map(|s| (*s).to_owned()).collect(),
                mime_types: vec![],
            },
            kind,
            runtime,
            loading: crate::plugin_contract::LoadingPolicy::Lazy,
            entry: Some("index.html".to_owned()),
            sources,
            permissions: Permissions {
                current_document: vec![DocumentPermission::Read],
                ..Permissions::default()
            },
            output: output.map(str::to_owned),
            capability: crate::plugin_contract::HandlerCapability::Preview,
            source: if kind == HandlerKind::Converter {
                crate::plugin_contract::HandlerSource::Resource
            } else {
                crate::plugin_contract::HandlerSource::Content
            },
            surface_isolation: Default::default(),
            compute_isolation: Default::default(),
            content_sandbox: Default::default(),
            resource_policy: Default::default(),
            recovery_policy: Default::default(),
            surface_preparation: Default::default(),
            readiness_signal: Default::default(),
            surface_family: Default::default(),
            surface_traits: vec![],
        }],
        files: vec![ManifestFile {
            path: "index.html".to_owned(),
            size: 512,
            sha256: "a".repeat(64),
        }],
        permissions: Permissions {
            current_document: vec![DocumentPermission::Read],
            ..Permissions::default()
        },
        licenses: vec![LicenseEntry {
            spdx: "MIT".to_owned(),
            path: "LICENSE".to_owned(),
        }],
        limits: PackageLimits {
            max_archive_bytes: 1024 * 1024,
            max_extracted_bytes: 2 * 1024 * 1024,
        },
    }
}

#[allow(clippy::too_many_arguments)]
fn sample_catalog(
    plugin_id: &str,
    handler_id: &str,
    format_ids: &[&str],
    extensions: &[&str],
    kind: HandlerKind,
    runtime: RuntimeKind,
    sources: Vec<SourceScope>,
    output: Option<&str>,
    platforms: Vec<Platform>,
    host_api: u32,
    min_app_version: &str,
) -> Catalog {
    Catalog {
        schema_version: CATALOG_SCHEMA_VERSION,
        generated_at: "2026-11-20T00:00:00Z".to_owned(),
        plugins: vec![CatalogPlugin {
            id: plugin_id.to_owned(),
            publisher: "puppyone".to_owned(),
            name: format!("Plugin {plugin_id}"),
            description: "Official test plugin".to_owned(),
            versions: vec![CatalogVersion {
                version: "1.2.0".to_owned(),
                host_api,
                min_app_version: min_app_version.to_owned(),
                platforms,
                archive_url: format!(
                    "https://downloads.puppyone.ai/desktop/viewer-packs/{plugin_id}/1.2.0/pack.tar.gz"
                ),
                archive_sha256: "b".repeat(64),
                archive_size_bytes: 4_500_000,
                extracted_size_bytes: 9_000_000,
                handlers: vec![CatalogHandlerSummary {
                    id: handler_id.to_owned(),
                    label: format!("Catalog {handler_id}"),
                    kind,
                    runtime,
                    handles: Handles {
                        format_ids: format_ids.iter().map(|s| (*s).to_owned()).collect(),
                        extensions: extensions.iter().map(|s| (*s).to_owned()).collect(),
                        mime_types: vec![],
                    },
                    sources,
                    output: output.map(str::to_owned),
                }],
            }],
        }],
    }
}

/// Step 2 acceptance gate: with no preferences and no plugins installed,
/// `open_plan` MUST return the exact same built-in viewer as
/// `editor::registry::resolve` for EVERY format in `assets/formats/file-formats.json`
/// (plus `unknown`).
#[test]
fn empty_preferences_and_plugins_match_registry_resolve_for_every_format() {
    let prefs = OpenPreferences::default();
    let catalog = Catalog::empty();
    let ctx = OpeningContext::with_defaults(&prefs, &[], &catalog);

    let all_formats: Vec<&'static FileFormat> = formats::all()
        .iter()
        .chain(std::iter::once(formats::unknown()))
        .collect();
    assert!(
        all_formats.len() > 100,
        "expected full imported file-formats.json table"
    );

    for format in all_formats {
        let sample_name = format
            .extensions
            .first()
            .map(|ext| format!("fixture{ext}"))
            .or_else(|| format.filenames.first().cloned())
            .unwrap_or_else(|| format!("{}.bin", format.id));
        let doc = EditorDocument {
            path: sample_name.clone(),
            name: sample_name,
            kind: format.semantic_kind().to_owned(),
            mime: format.mime_types.first().cloned(),
            source_kind: SourceKind::Local,
        };

        let expected = registry::resolve_with_format(&doc, format);
        let plan = open_plan(
            &OpenRequest {
                document: &doc,
                resource_id: Some("file:///workspace/fixture"),
                format: Some(format),
                head: None,
                sniffed: false,
                explicit_handler: None,
            },
            &ctx,
        );

        assert_eq!(
            plan.handler,
            HandlerId::builtin(expected.viewer.id),
            "format `{}` (`{}`) diverged from editor::registry::resolve",
            format.id,
            doc.name
        );
        assert_eq!(plan.format_id, format.id);
        assert!(
            plan.preference_notice.is_none(),
            "empty preferences must never emit preference_notice for `{}`",
            format.id
        );
        let expected_reason = if expected.viewer.capability() == Capability::Placeholder {
            OpenReason::Fallback
        } else {
            OpenReason::BuiltinDefault
        };
        assert_eq!(
            plan.reason, expected_reason,
            "unexpected OpenReason for `{}`",
            format.id
        );
    }
}

#[test]
fn selection_order_covers_all_five_steps_and_converter_chain() {
    let libreoffice = sample_plugin(
        "puppyone.libreoffice",
        "pptx-preview",
        &["pptx"],
        &[".pptx"],
        HandlerKind::Converter,
        RuntimeKind::Process,
        vec![SourceScope::Local],
        Some("pdf"),
        vec![Platform::MacosArm64],
        HOST_API_VERSION,
        "0.1.0",
    );
    let catalog = sample_catalog(
        "puppyone.duckdb",
        "duckdb-viewer",
        &["binary"],
        &[".duckdb"],
        HandlerKind::Viewer,
        RuntimeKind::Process,
        vec![SourceScope::Local],
        None,
        vec![Platform::MacosArm64],
        HOST_API_VERSION,
        "0.1.0",
    );

    // Step 1: per-file override beats per-type default and built-in default.
    let mut prefs = OpenPreferences::default();
    prefs.set_type_default(
        "pptx",
        HandlerId::plugin("puppyone.libreoffice", "pptx-preview"),
    );
    prefs.set_file_override("file:///ws/deck.pptx", HandlerId::builtin("office-preview"));
    let ctx = OpeningContext {
        preferences: &prefs,
        installed: std::slice::from_ref(&libreoffice),
        catalog: &catalog,
        platform: Platform::MacosArm64,
        host_api: HOST_API_VERSION,
        app_version: "1.0.0",
    };
    let pptx = EditorDocument::local("deck.pptx");
    let plan = open_plan(
        &OpenRequest {
            document: &pptx,
            resource_id: Some("file:///ws/deck.pptx"),
            ..OpenRequest::for_document(&pptx)
        },
        &ctx,
    );
    assert_eq!(plan.handler, HandlerId::builtin("office-preview"));
    assert_eq!(plan.reason, OpenReason::UserFile);
    assert!(
        plan.alternatives
            .iter()
            .any(|a| a.handler == HandlerId::plugin("puppyone.libreoffice", "pptx-preview"))
    );

    // Step 2: per-type default beats built-in default and produces a conversion chain.
    let plan2 = open_plan(
        &OpenRequest {
            document: &pptx,
            resource_id: Some("file:///ws/other.pptx"),
            ..OpenRequest::for_document(&pptx)
        },
        &ctx,
    );
    assert_eq!(
        plan2.handler,
        HandlerId::plugin("puppyone.libreoffice", "pptx-preview")
    );
    assert_eq!(plan2.reason, OpenReason::UserType);
    assert_eq!(plan2.fallback, HandlerId::builtin("office-preview"));
    assert_eq!(
        plan2.chain,
        Some(ConversionChain {
            converter: HandlerId::plugin("puppyone.libreoffice", "pptx-preview"),
            source_format: "pptx".into(),
            target_format: "pdf".into(),
            target_viewer: HandlerId::builtin("pdf-preview"),
        })
    );

    // Step 3: built-in default wins over installed plugins when no preference is set.
    let empty_prefs = OpenPreferences::default();
    let ctx_no_prefs = OpeningContext {
        preferences: &empty_prefs,
        ..ctx.clone()
    };
    let plan3 = open_plan(&OpenRequest::for_document(&pptx), &ctx_no_prefs);
    assert_eq!(plan3.handler, HandlerId::builtin("office-preview"));
    assert_eq!(plan3.reason, OpenReason::BuiltinDefault);
    assert!(plan3.alternatives.iter().any(|a| {
        a.handler == HandlerId::plugin("puppyone.libreoffice", "pptx-preview")
            && a.status == CandidateStatus::Available
    }));

    // Step 4: suggested installable catalog plugin for a placeholder-grade file.
    let duckdb = EditorDocument::local("analytics.duckdb");
    let plan4 = open_plan(&OpenRequest::for_document(&duckdb), &ctx_no_prefs);
    assert_eq!(
        plan4.handler,
        HandlerId::plugin("puppyone.duckdb", "duckdb-viewer")
    );
    assert_eq!(plan4.reason, OpenReason::Suggested);
    assert_eq!(plan4.fallback, HandlerId::builtin("document-placeholder"));

    // Step 5: placeholder fallback when nothing handles the format.
    let unknown_bin = EditorDocument::local("mystery.qqqq");
    let plan5 = open_plan(&OpenRequest::for_document(&unknown_bin), &ctx_no_prefs);
    assert_eq!(plan5.handler, HandlerId::builtin("document-placeholder"));
    assert_eq!(plan5.reason, OpenReason::Fallback);
    assert_eq!(plan5.fallback, HandlerId::builtin("document-placeholder"));
}

#[test]
fn records_every_unavailable_reason_and_falls_through_with_preference_notice() {
    let catalog = Catalog::empty();
    let md = EditorDocument::local("notes.md");

    // 1. NotInstalled
    let mut prefs = OpenPreferences::default();
    let missing_plugin = HandlerId::plugin("puppyone.missing", "viewer");
    prefs.set_file_override("res:notes", missing_plugin.clone());
    let ctx = OpeningContext {
        preferences: &prefs,
        installed: &[],
        catalog: &catalog,
        platform: Platform::MacosArm64,
        host_api: HOST_API_VERSION,
        app_version: "1.0.0",
    };
    let plan = open_plan(
        &OpenRequest {
            document: &md,
            resource_id: Some("res:notes"),
            ..OpenRequest::for_document(&md)
        },
        &ctx,
    );
    assert_eq!(plan.handler, HandlerId::builtin("markdown"));
    assert_eq!(plan.reason, OpenReason::BuiltinDefault);
    assert_eq!(
        plan.preference_notice,
        Some(SkippedCandidate {
            handler: missing_plugin,
            reason: UnavailableReason::NotInstalled,
        })
    );

    // 2. SourceNotAllowed (local-only plugin on a Cloud file)
    let local_plugin = sample_plugin(
        "puppyone.local-only",
        "viewer",
        &["markdown"],
        &[".md"],
        HandlerKind::Viewer,
        RuntimeKind::Process,
        vec![SourceScope::Local],
        None,
        vec![Platform::Any],
        HOST_API_VERSION,
        "0.1.0",
    );
    let mut cloud_prefs = OpenPreferences::default();
    let local_handler = HandlerId::plugin("puppyone.local-only", "viewer");
    cloud_prefs.set_type_default("markdown", local_handler.clone());
    let cloud_md = EditorDocument::with_source("notes.md", SourceKind::Cloud);
    let ctx_cloud = OpeningContext {
        preferences: &cloud_prefs,
        installed: &[local_plugin],
        catalog: &catalog,
        platform: Platform::MacosArm64,
        host_api: HOST_API_VERSION,
        app_version: "1.0.0",
    };
    let plan_cloud = open_plan(&OpenRequest::for_document(&cloud_md), &ctx_cloud);
    assert_eq!(plan_cloud.handler, HandlerId::builtin("markdown"));
    assert_eq!(
        plan_cloud.preference_notice,
        Some(SkippedCandidate {
            handler: local_handler,
            reason: UnavailableReason::SourceNotAllowed,
        })
    );
    // Cloud files must also exclude `app:default` from alternatives and record SourceNotAllowed.
    assert!(
        !plan_cloud
            .alternatives
            .iter()
            .any(|a| a.handler == HandlerId::system_default_app())
    );
    assert!(plan_cloud.skipped.contains(&SkippedCandidate {
        handler: HandlerId::system_default_app(),
        reason: UnavailableReason::SourceNotAllowed,
    }));

    // 3. PlatformUnsupported
    let win_only = sample_plugin(
        "puppyone.win-only",
        "viewer",
        &["markdown"],
        &[".md"],
        HandlerKind::Viewer,
        RuntimeKind::Process,
        vec![SourceScope::Local],
        None,
        vec![Platform::WindowsX64],
        HOST_API_VERSION,
        "0.1.0",
    );
    let mut p_prefs = OpenPreferences::default();
    p_prefs.set_type_default("markdown", HandlerId::plugin("puppyone.win-only", "viewer"));
    let plan_plat = open_plan(
        &OpenRequest::for_document(&md),
        &OpeningContext {
            preferences: &p_prefs,
            installed: &[win_only],
            catalog: &catalog,
            platform: Platform::MacosArm64,
            host_api: HOST_API_VERSION,
            app_version: "1.0.0",
        },
    );
    assert_eq!(
        plan_plat.preference_notice.as_ref().map(|s| s.reason),
        Some(UnavailableReason::PlatformUnsupported)
    );

    // 4. HostApiIncompatible
    let future_api = sample_plugin(
        "puppyone.future-api",
        "viewer",
        &["markdown"],
        &[".md"],
        HandlerKind::Viewer,
        RuntimeKind::Web,
        vec![SourceScope::Local],
        None,
        vec![Platform::Any],
        HOST_API_VERSION + 2,
        "0.1.0",
    );
    let mut api_prefs = OpenPreferences::default();
    api_prefs.set_type_default(
        "markdown",
        HandlerId::plugin("puppyone.future-api", "viewer"),
    );
    let plan_api = open_plan(
        &OpenRequest::for_document(&md),
        &OpeningContext {
            preferences: &api_prefs,
            installed: &[future_api],
            catalog: &catalog,
            platform: Platform::MacosArm64,
            host_api: HOST_API_VERSION,
            app_version: "1.0.0",
        },
    );
    assert_eq!(
        plan_api.preference_notice.as_ref().map(|s| s.reason),
        Some(UnavailableReason::HostApiIncompatible)
    );

    // 5. AppVersionIncompatible
    let newer_app = sample_plugin(
        "puppyone.newer-app",
        "viewer",
        &["markdown"],
        &[".md"],
        HandlerKind::Viewer,
        RuntimeKind::Web,
        vec![SourceScope::Local],
        None,
        vec![Platform::Any],
        HOST_API_VERSION,
        "9.0.0",
    );
    let mut ver_prefs = OpenPreferences::default();
    ver_prefs.set_type_default(
        "markdown",
        HandlerId::plugin("puppyone.newer-app", "viewer"),
    );
    let plan_ver = open_plan(
        &OpenRequest::for_document(&md),
        &OpeningContext {
            preferences: &ver_prefs,
            installed: &[newer_app],
            catalog: &catalog,
            platform: Platform::MacosArm64,
            host_api: HOST_API_VERSION,
            app_version: "1.0.0",
        },
    );
    assert_eq!(
        plan_ver.preference_notice.as_ref().map(|s| s.reason),
        Some(UnavailableReason::AppVersionIncompatible)
    );

    // 6. NotFound (unknown built-in id)
    let mut bad_prefs = OpenPreferences::default();
    bad_prefs.set_type_default("markdown", HandlerId::builtin("retired-viewer"));
    let plan_nf = open_plan(
        &OpenRequest::for_document(&md),
        &OpeningContext {
            preferences: &bad_prefs,
            installed: &[],
            catalog: &catalog,
            platform: Platform::MacosArm64,
            host_api: HOST_API_VERSION,
            app_version: "1.0.0",
        },
    );
    assert_eq!(
        plan_nf.preference_notice.as_ref().map(|s| s.reason),
        Some(UnavailableReason::NotFound)
    );
}

#[test]
fn sniffed_formats_never_select_content_executing_handlers() {
    let catalog = Catalog::empty();
    let mut prefs = OpenPreferences::default();
    prefs.set_type_default("text-unknown", HandlerId::builtin("html-artifact"));
    prefs.set_type_default("html", HandlerId::builtin("html-artifact"));
    prefs.set_file_override("res:payload", HandlerId::builtin("app-preview"));
    let ctx = OpeningContext::with_defaults(&prefs, &[], &catalog);

    // Extensionless HTML payload sniffed from head bytes: must open in `builtin:text`,
    // never `html-artifact` or `app-preview`.
    let untrusted = EditorDocument::local("untrusted_payload");
    let plan = open_plan(
        &OpenRequest {
            document: &untrusted,
            resource_id: Some("res:payload"),
            format: None,
            head: Some(b"<!DOCTYPE html><html><script>alert(1)</script></html>"),
            sniffed: false,
            explicit_handler: None,
        },
        &ctx,
    );
    assert_eq!(plan.handler, HandlerId::builtin("text"));
    assert!(plan.skipped.contains(&SkippedCandidate {
        handler: HandlerId::builtin("app-preview"),
        reason: UnavailableReason::SniffedExecutableDisallowed,
    }));
    assert!(plan.skipped.contains(&SkippedCandidate {
        handler: HandlerId::builtin("html-artifact"),
        reason: UnavailableReason::SniffedExecutableDisallowed,
    }));

    // Even if a caller passes `format = html` with `sniffed = true`, defense-in-depth
    // still refuses `html-artifact` and opens `builtin:text`.
    let forced_sniff = open_plan(
        &OpenRequest {
            document: &untrusted,
            resource_id: None,
            format: Some(formats::of("index.html")),
            head: None,
            sniffed: true,
            explicit_handler: None,
        },
        &ctx,
    );
    assert_eq!(forced_sniff.handler, HandlerId::builtin("text"));
    assert!(
        !forced_sniff
            .alternatives
            .iter()
            .any(|a| is_content_executing_handler(&a.handler))
    );
}

#[test]
fn cloud_source_excludes_local_only_plugins_and_external_default_app() {
    let catalog = sample_catalog(
        "puppyone.local-cad",
        "cad-viewer",
        &["binary"],
        &[".step"],
        HandlerKind::Viewer,
        RuntimeKind::Process,
        vec![SourceScope::Local],
        None,
        vec![Platform::Any],
        HOST_API_VERSION,
        "0.1.0",
    );
    let mut prefs = OpenPreferences::default();
    prefs.set_file_override("cloud://proj/a.md", HandlerId::system_default_app());
    let ctx = OpeningContext {
        preferences: &prefs,
        installed: &[],
        catalog: &catalog,
        platform: Platform::MacosArm64,
        host_api: HOST_API_VERSION,
        app_version: "1.0.0",
    };

    // Cloud .md with `app:default` override must fall back to `builtin:markdown`.
    let cloud_md = EditorDocument::with_source("a.md", SourceKind::Cloud);
    let plan = open_plan(
        &OpenRequest {
            document: &cloud_md,
            resource_id: Some("cloud://proj/a.md"),
            ..OpenRequest::for_document(&cloud_md)
        },
        &ctx,
    );
    assert_eq!(plan.handler, HandlerId::builtin("markdown"));
    assert_eq!(
        plan.preference_notice,
        Some(SkippedCandidate {
            handler: HandlerId::system_default_app(),
            reason: UnavailableReason::SourceNotAllowed,
        })
    );

    // Cloud .step must NOT suggest the local-only catalog plugin; falls back to placeholder.
    let cloud_step = EditorDocument::with_source("part.step", SourceKind::Cloud);
    let plan_step = open_plan(&OpenRequest::for_document(&cloud_step), &ctx);
    assert_eq!(
        plan_step.handler,
        HandlerId::builtin("document-placeholder")
    );
    assert_eq!(plan_step.reason, OpenReason::Fallback);
    assert!(plan_step.skipped.contains(&SkippedCandidate {
        handler: HandlerId::plugin("puppyone.local-cad", "cad-viewer"),
        reason: UnavailableReason::SourceNotAllowed,
    }));
}

#[test]
fn preferences_invalidate_uninstalled_incompatible_and_unknown_handlers_and_rebase() {
    let compatible = sample_plugin(
        "puppyone.ok",
        "viewer",
        &["markdown"],
        &[".md"],
        HandlerKind::Viewer,
        RuntimeKind::Web,
        vec![SourceScope::Local],
        None,
        vec![Platform::MacosArm64],
        HOST_API_VERSION,
        "0.1.0",
    );
    let incompatible = sample_plugin(
        "puppyone.future",
        "viewer",
        &["markdown"],
        &[".md"],
        HandlerKind::Viewer,
        RuntimeKind::Web,
        vec![SourceScope::Local],
        None,
        vec![Platform::MacosArm64],
        HOST_API_VERSION + 3,
        "0.1.0",
    );

    let mut prefs = OpenPreferences::default();
    prefs.set_type_default("markdown", HandlerId::builtin("text"));
    prefs.set_type_default("csv", HandlerId::builtin("does-not-exist"));
    prefs.set_type_default("pdf", HandlerId::plugin("puppyone.removed", "pdf"));
    prefs.set_file_override("res:keep", HandlerId::plugin("puppyone.ok", "viewer"));
    prefs.set_file_override(
        "res:old-api",
        HandlerId::plugin("puppyone.future", "viewer"),
    );
    prefs.set_file_override("res:app", HandlerId::system_default_app());

    let report = prefs.invalidate(
        &[compatible, incompatible],
        &Catalog::empty(),
        "1.0.0",
        HOST_API_VERSION,
        Platform::MacosArm64,
    );

    assert_eq!(report.removed_type_defaults.len(), 2);
    assert_eq!(report.removed_file_overrides.len(), 1);
    assert_eq!(
        prefs.type_default("markdown"),
        Some(&HandlerId::builtin("text"))
    );
    assert!(prefs.type_default("csv").is_none());
    assert!(prefs.type_default("pdf").is_none());
    assert_eq!(
        prefs.file_override("res:keep"),
        Some(&HandlerId::plugin("puppyone.ok", "viewer"))
    );
    assert!(prefs.file_override("res:old-api").is_none());
    assert_eq!(
        prefs.file_override("res:app"),
        Some(&HandlerId::system_default_app())
    );

    // Rebase override on file rename.
    assert!(prefs.rebase_file_override("res:keep", "res:renamed"));
    assert!(prefs.file_override("res:keep").is_none());
    assert_eq!(
        prefs.file_override("res:renamed"),
        Some(&HandlerId::plugin("puppyone.ok", "viewer"))
    );

    // Invalidate a specific plugin cleanly.
    let removed = prefs.invalidate_plugin("puppyone.ok");
    assert_eq!(removed.removed_file_overrides.len(), 1);
    assert!(prefs.file_override("res:renamed").is_none());

    // Resilient JSON round-trip skips malformed entries without failing.
    let raw = serde_json::json!({
        "markdown": "builtin:text",
        "bad": "not-a-handler",
        "num": 42,
        "": "builtin:text"
    });
    let parsed = parse_handler_map_json(&raw);
    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed.get("markdown"), Some(&HandlerId::builtin("text")));
    assert_eq!(
        serialize_handler_map_json(&parsed),
        serde_json::json!({"markdown": "builtin:text"})
    );
}

#[test]
fn builtin_handlers_project_all_sixteen_preset_viewers_and_configurable_types() {
    let defs = builtin_handlers();
    assert_eq!(defs.len(), registry::manifest().viewers.len());
    assert!(defs.iter().any(|d| d.id == HandlerId::builtin("markdown")));
    assert!(
        defs.iter()
            .any(|d| d.id == HandlerId::builtin("document-placeholder"))
    );

    let prefs = OpenPreferences::default();
    let catalog = Catalog::empty();
    let ctx = OpeningContext::with_defaults(&prefs, &[], &catalog);
    let types = configurable_file_types(&ctx);
    assert!(types.iter().any(|t| t.format_id == "markdown"));
    assert!(types.iter().any(|t| t.format_id == "csv"));
    assert!(types.iter().any(|t| t.format_id == "svg"));
    assert!(types.iter().any(|t| t.format_id == "pdf"));
    let svg = types.iter().find(|t| t.format_id == "svg").unwrap();
    assert!(
        svg.options
            .iter()
            .any(|o| o.handler == HandlerId::builtin("image-preview"))
    );
    assert!(
        svg.options
            .iter()
            .any(|o| o.handler == HandlerId::builtin("text"))
    );
    assert!(
        svg.options
            .iter()
            .any(|o| o.handler == HandlerId::system_default_app())
    );
}
