use super::*;
use crate::{
    editor::{
        opening::{OpenRequest, open_plan},
        registry::{EditorDocument, SourceKind, SurfaceInput, SurfaceRequest},
        view::style,
    },
    formats,
    plugin_contract::{
        CatalogHandlerSummary, CatalogPlugin, CatalogVersion, HOST_API_VERSION, HandlerKind,
        Handles, OpenReason, Platform, RuntimeKind, SourceScope, catalog::CATALOG_SCHEMA_VERSION,
    },
    typography::Scale,
};
use gpui::TestAppContext;
use std::{cell::RefCell, rc::Rc};

fn init_test_window(cx: &mut TestAppContext) -> &mut gpui::VisualTestContext {
    cx.update(|cx| {
        if cx.try_global::<gpui_kit::component::Theme>().is_none() {
            gpui_kit::init(cx);
        }
        cx.text_system().add_fonts(style::font_bytes()).unwrap();
    });
    let (_, visual) = cx.add_window_view(|_, _| gpui::Empty);
    visual
}

#[gpui::test]
fn handler_factory_opens_builtin_external_and_install_card_and_falls_back(cx: &mut TestAppContext) {
    let visual = init_test_window(cx);
    let launched = Rc::new(RefCell::new(Vec::<PathBuf>::new()));
    let launched_clone = launched.clone();
    let factory = HandlerFactory::with_external_launcher(Rc::new(move |path| {
        launched_clone.borrow_mut().push(path.to_path_buf());
        Ok(())
    }));

    // 1. Built-in markdown opened via `builtin:text` preference override.
    let md_doc = EditorDocument::local("notes.md");
    let mut prefs = OpenPreferences::default();
    prefs.set_type_default("markdown", HandlerId::builtin("text"));
    let empty_catalog = Catalog::empty();
    let ctx = OpeningContext::with_defaults(&prefs, &[], &empty_catalog);
    let md_plan = open_plan(&OpenRequest::for_document(&md_doc), &ctx);
    assert_eq!(md_plan.handler, HandlerId::builtin("text"));
    assert_eq!(md_plan.reason, OpenReason::UserType);

    visual.update(|window, cx| {
        let surface_req = SurfaceRequest {
            id: "doc-md",
            name: "notes.md",
            input: SurfaceInput::Text("# hello\n"),
            format: formats::of("notes.md"),
            resolved_extension: Some("md"),
            dark: false,
            scale: Scale::Medium,
            workspace: None,
            file_mode: false,
            folder: None,
            web_source: None,
            assets: None,
            references: None,
            source_kind: SourceKind::Local,
            models: Default::default(),
        };
        let opened = factory
            .open(
                &HandlerOpenRequest {
                    plan: &md_plan,
                    document: &md_doc,
                    surface: &surface_req,
                    local_path: Some(PathBuf::from("/tmp/notes.md")),
                    on_fallback: None,
                    installed: &[],
                    catalog: &empty_catalog,
                },
                window,
                cx,
            )
            .expect("open builtin:text");
        assert_eq!(opened.handler, HandlerId::builtin("text"));
        assert_eq!(opened.viewer.id, "text");
        assert!(opened.editable);
        assert!(!opened.used_fallback);
        assert!(opened.notice.is_none());
    });

    // 2. External app handler launches local file once and refuses Cloud files.
    let mut app_prefs = OpenPreferences::default();
    app_prefs.set_file_override("res:local", HandlerId::system_default_app());
    let app_ctx = OpeningContext::with_defaults(&app_prefs, &[], &empty_catalog);
    let local_plan = open_plan(
        &OpenRequest {
            document: &md_doc,
            resource_id: Some("res:local"),
            ..OpenRequest::for_document(&md_doc)
        },
        &app_ctx,
    );
    assert_eq!(local_plan.handler, HandlerId::system_default_app());

    visual.update(|window, cx| {
        let surface_req = SurfaceRequest {
            id: "doc-ext",
            name: "notes.md",
            input: SurfaceInput::None,
            format: formats::of("notes.md"),
            resolved_extension: Some("md"),
            dark: false,
            scale: Scale::Medium,
            workspace: None,
            file_mode: false,
            folder: None,
            web_source: None,
            assets: None,
            references: None,
            source_kind: SourceKind::Local,
            models: Default::default(),
        };
        let opened = factory
            .open(
                &HandlerOpenRequest {
                    plan: &local_plan,
                    document: &md_doc,
                    surface: &surface_req,
                    local_path: Some(PathBuf::from("/tmp/notes.md")),
                    on_fallback: None,
                    installed: &[],
                    catalog: &empty_catalog,
                },
                window,
                cx,
            )
            .expect("open app:default");
        assert_eq!(opened.handler, HandlerId::system_default_app());
        assert!(!opened.editable);
    });
    assert_eq!(
        launched.borrow().as_slice(),
        &[PathBuf::from("/tmp/notes.md")]
    );

    // Cloud document forced to `app:default` must NOT invoke launcher.
    let cloud_doc = EditorDocument::with_source("notes.md", SourceKind::Cloud);
    visual.update(|window, cx| {
        let surface_req = SurfaceRequest {
            id: "doc-cloud",
            name: "notes.md",
            input: SurfaceInput::None,
            format: formats::of("notes.md"),
            resolved_extension: Some("md"),
            dark: false,
            scale: Scale::Medium,
            workspace: None,
            file_mode: false,
            folder: None,
            web_source: None,
            assets: None,
            references: None,
            source_kind: SourceKind::Cloud,
            models: Default::default(),
        };
        let _ = factory
            .open(
                &HandlerOpenRequest {
                    plan: &local_plan,
                    document: &cloud_doc,
                    surface: &surface_req,
                    local_path: Some(PathBuf::from("/should/not/launch.md")),
                    on_fallback: None,
                    installed: &[],
                    catalog: &empty_catalog,
                },
                window,
                cx,
            )
            .expect("cloud external app opens refusal card");
    });
    assert_eq!(
        launched.borrow().len(),
        1,
        "Cloud document must never trigger external OS app launcher"
    );

    // 3. Uninstalled catalog plugin opens stub install card.
    let catalog = Catalog {
        schema_version: CATALOG_SCHEMA_VERSION,
        generated_at: "2026-11-20T00:00:00Z".into(),
        plugins: vec![CatalogPlugin {
            id: "puppyone.duckdb".into(),
            publisher: "puppyone".into(),
            name: "DuckDB".into(),
            description: "DuckDB viewer".into(),
            versions: vec![CatalogVersion {
                version: "1.0.0".into(),
                host_api: HOST_API_VERSION,
                min_app_version: "0.1.0".into(),
                platforms: vec![Platform::Any],
                archive_url: "https://downloads.puppyone.ai/desktop/viewer-packs/puppyone.duckdb/1.0.0/pack.tar.gz".into(),
                archive_sha256: "a".repeat(64),
                archive_size_bytes: 55_000_000,
                extracted_size_bytes: 110_000_000,
                handlers: vec![CatalogHandlerSummary {
                    id: "duckdb-viewer".into(),
                    label: "DuckDB Viewer".into(),
                    kind: HandlerKind::Viewer,
                    runtime: RuntimeKind::Process,
                    handles: Handles {
                        format_ids: vec![],
                        extensions: vec![".duckdb".into()],
                        mime_types: vec![],
                    },
                    sources: vec![SourceScope::Local],
                    output: None,
                }],
            }],
        }],
    };
    let duck_doc = EditorDocument::local("sales.duckdb");
    let empty_prefs = OpenPreferences::default();
    let duck_ctx = OpeningContext::with_defaults(&empty_prefs, &[], &catalog);
    let duck_plan = open_plan(&OpenRequest::for_document(&duck_doc), &duck_ctx);
    assert_eq!(
        duck_plan.handler,
        HandlerId::plugin("puppyone.duckdb", "duckdb-viewer")
    );
    visual.update(|window, cx| {
        let surface_req = SurfaceRequest {
            id: "doc-duck",
            name: "sales.duckdb",
            input: SurfaceInput::None,
            format: formats::of("sales.duckdb"),
            resolved_extension: Some("duckdb"),
            dark: false,
            scale: Scale::Medium,
            workspace: None,
            file_mode: false,
            folder: None,
            web_source: None,
            assets: None,
            references: None,
            source_kind: SourceKind::Local,
            models: Default::default(),
        };
        let opened = factory
            .open(
                &HandlerOpenRequest {
                    plan: &duck_plan,
                    document: &duck_doc,
                    surface: &surface_req,
                    local_path: Some(PathBuf::from("/tmp/sales.duckdb")),
                    on_fallback: None,
                    installed: &[],
                    catalog: &catalog,
                },
                window,
                cx,
            )
            .expect("open install card stub");
        assert_eq!(
            opened.handler,
            HandlerId::plugin("puppyone.duckdb", "duckdb-viewer")
        );
        assert!(!opened.used_fallback);
    });

    // 4. Unknown built-in handler degrades cleanly to `plan.fallback` with notice.
    let bad_plan = OpenPlan {
        format_id: "markdown".into(),
        handler: HandlerId::builtin("missing-viewer"),
        reason: OpenReason::UserFile,
        fallback: HandlerId::builtin("markdown"),
        alternatives: vec![],
        skipped: vec![],
        preference_notice: None,
        chain: None,
    };
    visual.update(|window, cx| {
        let surface_req = SurfaceRequest {
            id: "doc-fb",
            name: "notes.md",
            input: SurfaceInput::Text("# hi\n"),
            format: formats::of("notes.md"),
            resolved_extension: Some("md"),
            dark: false,
            scale: Scale::Medium,
            workspace: None,
            file_mode: false,
            folder: None,
            web_source: None,
            assets: None,
            references: None,
            source_kind: SourceKind::Local,
            models: Default::default(),
        };
        let opened = factory
            .open(
                &HandlerOpenRequest {
                    plan: &bad_plan,
                    document: &md_doc,
                    surface: &surface_req,
                    local_path: None,
                    on_fallback: None,
                    installed: &[],
                    catalog: &empty_catalog,
                },
                window,
                cx,
            )
            .expect("degrade to fallback");
        assert_eq!(opened.handler, HandlerId::builtin("markdown"));
        assert!(opened.used_fallback);
        assert!(opened.notice.is_some());
    });
}
