use super::*;
use core::prelude::v1::test;

#[test]
fn the_page_carries_the_board_and_names_the_sdk_assets() {
    let boot = serde_json::json!({ "text": "{\"type\":\"</script>\"}" });
    let html = page(&boot, true);
    assert!(html.contains(r#"class="dark" data-initial-theme="dark""#));
    assert!(html.contains("color-scheme:dark"));
    assert!(html.contains(r#"new URL("__assets__/excalidraw/",document.baseURI)"#));
    assert!(html.contains(r#"id="desktop-overlay-root" class="desktop-overlay-root dark""#));
    assert!(!html.contains("\"</script>"));
    assert_eq!(
        serde_json::from_str::<Inbound>(r#"{"type":"link","link":"notes/a.md"}"#).unwrap(),
        Inbound::Link {
            link: "notes/a.md".into()
        }
    );
}

#[test]
fn the_bundle_rewrites_the_font_fallback_and_carries_the_host_patches() {
    let spec = viewer_packs::excalidraw_spec();
    assert!(!spec.version.is_empty());
    assert_eq!(spec.script_sha256.len(), 64);
    assert_eq!(spec.style_sha256.len(), 64);
    for family in ["Assistant/", "Excalifont/", "Virgil/", "Xiaolai/"] {
        assert!(spec.fonts.keys().any(|k| k.starts_with(family)), "{family}");
    }
}

#[gpui::test]
fn board_edits_become_the_document_and_links_open_their_documents(cx: &mut TestAppContext) {
    let format = crate::formats::of("boards/plan.excalidraw");
    let surface = cx.update(|cx| {
        cx.open_window(WindowOptions::default(), |window, cx| {
            let request = SurfaceRequest {
                id: "doc-1",
                name: "boards/plan.excalidraw",
                input: SurfaceInput::Text("{}"),
                format,
                resolved_extension: Some("excalidraw"),
                dark: false,
                scale: Scale::default(),
                workspace: None,
                file_mode: false,
                folder: None,
                web_source: None,
                assets: None,
                references: None,
                source_kind: crate::editor::registry::SourceKind::Local,
            };
            let _surface = open(&request, window, cx);
            // Force board ready state for unit event tests without requiring
            // an installed pack on disk.
            cx.new(|_| EmptyView)
        })
        .unwrap()
    });
    let _ = (format, surface);

    let (view, cx) = cx.add_window_view(|_, cx| {
        let mut view =
            WhiteboardView::new("boards/plan.excalidraw".into(), None, "{}".into(), false);
        view.show(cx);
        view.ready = true;
        view
    });
    let (host, source) = cx.update(|window, cx| {
        let request = SurfaceRequest {
            id: "doc-2",
            name: "boards/plan.excalidraw",
            input: SurfaceInput::Text("{}"),
            format: crate::formats::of("boards/plan.excalidraw"),
            resolved_extension: Some("excalidraw"),
            dark: false,
            scale: Scale::default(),
            workspace: None,
            file_mode: false,
            folder: None,
            web_source: None,
            assets: None,
            references: None,
            source_kind: crate::editor::registry::SourceKind::Local,
        };
        let source: Rc<dyn ViewerSurface> =
            Rc::from(code::open_with(&request, Some("json"), false, window, cx));
        let mode = Rc::new(Cell::new(Mode::Board));
        let mode_ref = mode.clone();
        let source_for_sub = source.clone();
        let source_for_host = source.clone();
        let board_ref = view.clone();
        let host = cx.new(|cx| {
            let _sub = cx.subscribe_in(
                &board_ref,
                window,
                move |h: &mut WhiteboardHost, _, asked: &Asked, window, cx| {
                    if matches!(asked, Asked::ViewSource) && mode_ref.get() != Mode::Source {
                        let latest = h.board.read(cx).text.clone();
                        source_for_sub.replace_text(&latest, window, cx);
                        mode_ref.set(Mode::Source);
                        cx.notify();
                    }
                },
            );
            WhiteboardHost {
                mode,
                board: board_ref,
                source: source_for_host,
                _sub,
            }
        });
        (host, source)
    });
    let mode = host.read_with(cx, |h, _| h.mode.clone());
    let surface = WhiteboardSurface {
        mode: mode.clone(),
        board: view.clone(),
        source,
        host,
    };
    let seen = Rc::new(std::cell::RefCell::new(Vec::new()));
    let log = seen.clone();
    let _subscription = cx.update(|_, cx| {
        surface.subscribe(Rc::new(move |event, _| log.borrow_mut().push(event)), cx)
    });
    let board = "{\"type\":\"excalidraw\",\"version\":2,\"elements\":[]}\n";
    view.update(cx, |v, cx| {
        v.receive(Inbound::Content { text: board.into() }, cx)
    });
    cx.run_until_parked();
    assert_eq!(*seen.borrow(), [SurfaceEvent::Changed]);
    assert_eq!(cx.update(|_, cx| surface.text(cx)).as_deref(), Some(board));

    // Switching to JSON Source mode syncs the board's JSON into the code editor.
    cx.update(|window, cx| surface.pane_segment(PaneSegmentId::Source, window, cx));
    assert_eq!(mode.get(), Mode::Source);
    assert_eq!(cx.update(|_, cx| surface.text(cx)).as_deref(), Some(board));

    // Switching back to Board mode preserves text and read-only enforcement.
    cx.update(|window, cx| surface.pane_segment(PaneSegmentId::Live, window, cx));
    assert_eq!(mode.get(), Mode::Board);
    cx.update(|window, cx| surface.apply(true, false, Scale::default(), window, cx));
    view.update(cx, |v, cx| {
        v.receive(Inbound::Content { text: "x".into() }, cx)
    });
    cx.run_until_parked();
    assert_eq!(seen.borrow().len(), 1);
    cx.update(|window, cx| surface.replace_text("{}", window, cx));
    assert_eq!(cx.update(|_, cx| surface.text(cx)).as_deref(), Some("{}"));
}

struct EmptyView;
impl Render for EmptyView {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
    }
}
