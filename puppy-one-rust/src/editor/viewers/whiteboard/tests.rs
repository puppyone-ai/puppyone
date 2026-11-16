use super::*;
use core::prelude::v1::test;

const BLANK: &str = r#"{"type":"excalidraw","version":2,"elements":[],"appState":{},"files":{}}"#;

#[test]
fn the_page_carries_the_board_and_names_the_sdk_assets() {
    let boot = serde_json::json!({ "text": "{\"type\":\"</script>\"}" });
    let html = page(&boot, true);
    assert!(html.contains(r#"class="dark" data-initial-theme="dark""#));
    assert!(html.contains("color-scheme:dark"));
    assert!(html.contains(r#"new URL("__assets__/excalidraw/",document.baseURI)"#));
    assert!(html.contains(r#"id="desktop-overlay-root" class="desktop-overlay-root dark""#));
    assert!(!html.contains("\"</script>"));
    for body in [
        r#"{"type":"ready"}"#,
        r#"{"type":"content","text":"x"}"#,
        r#"{"type":"link","link":"https://example.com"}"#,
    ] {
        assert!(
            serde_json::from_str::<Inbound>(body).is_err(),
            "unowned message: {body}"
        );
    }
}

fn surface(cx: &mut VisualTestContext, text: &str, pack: bool, dir: &Path) -> WhiteboardSurface {
    cx.update(|window, cx| {
        let request = SurfaceRequest {
            id: "whiteboard-test",
            name: "boards/plan.excalidraw",
            input: SurfaceInput::Text(text),
            format: crate::formats::of("boards/plan.excalidraw"),
            resolved_extension: Some("excalidraw"),
            dark: false,
            scale: Scale::default(),
            workspace: None,
            file_mode: false,
        };
        // These tests qualify the host protocol and source editor. The separate
        // required real-pack test qualifies the full SDK assets.
        let pack = pack.then(|| ExcalidrawPack {
            version: "fixture".into(),
            script: Arc::from([]),
            style: Arc::from([]),
            dir: dir.into(),
        });
        open_with_pack(&request, pack, window, cx)
    })
}
fn generation(s: &WhiteboardSurface, cx: &VisualTestContext) -> u64 {
    s.board.read_with(cx, |v, _| v.generation)
}
fn message(s: &WhiteboardSurface, cx: &mut VisualTestContext, value: serde_json::Value) {
    let inbound = serde_json::from_value(value).unwrap();
    s.board.update(cx, |v, cx| v.receive(inbound, cx));
}
fn ready(s: &WhiteboardSurface, cx: &mut VisualTestContext) {
    let g = generation(s, cx);
    message(s, cx, serde_json::json!({"type":"ready", "generation":g}));
}
fn content(s: &WhiteboardSurface, cx: &mut VisualTestContext, g: u64, text: &str) {
    message(
        s,
        cx,
        serde_json::json!({"type":"content", "generation":g, "text":text}),
    );
}
fn text(s: &WhiteboardSurface, cx: &mut VisualTestContext) -> String {
    cx.update(|_, cx| s.text(cx).unwrap())
}

#[gpui::test]
fn an_external_replacement_rejects_content_already_queued_by_the_previous_scene(
    app: &mut TestAppContext,
) {
    let (_window, cx) = app.add_window_view(|_, _| EmptyView);
    let dir = tempfile::tempdir().unwrap();
    let s = surface(cx, BLANK, true, dir.path());
    let scripts = Rc::new(std::cell::RefCell::new(Vec::new()));
    let log = scripts.clone();
    let frame = s.board.read_with(cx, |v, _| v.frame.clone().unwrap());
    frame.update(cx, |f, _| {
        f.record_evaluations(move |script| log.borrow_mut().push(script.to_owned()))
    });
    ready(&s, cx);
    let old = generation(&s, cx);
    let external = format!("\n{BLANK}\n");
    cx.update(|w, cx| s.replace_text(&external, w, cx));
    content(&s, cx, old, "obsolete queued scene");
    assert_eq!(text(&s, cx), external);
    assert_eq!(
        s.board.read_with(cx, |v, _| v.frame.clone().unwrap()),
        frame,
        "ready-page resets must not recreate the frame"
    );
    assert!(s.board.read_with(cx, |v, _| v.ready));
    let scripts = scripts.borrow();
    assert_eq!(scripts.len(), 1);
    let payload = scripts[0]
        .strip_prefix("window.__puppyoneWhiteboard&&window.__puppyoneWhiteboard(")
        .unwrap()
        .strip_suffix(')')
        .unwrap();
    let payload: serde_json::Value = serde_json::from_str(payload).unwrap();
    assert_eq!(
        payload,
        serde_json::json!({"type":"reset", "text":external, "generation":generation(&s,cx)})
    );
    let current = generation(&s, cx);
    assert_ne!(old, current);
    let changed = BLANK.replace("{}", "{\"viewBackgroundColor\":\"#ff0000\"}");
    content(&s, cx, current, &changed);
    assert_eq!(text(&s, cx), changed);
}

#[gpui::test]
fn original_bytes_and_read_only_transitions_keep_one_owned_document(app: &mut TestAppContext) {
    let (_window, cx) = app.add_window_view(|_, _| EmptyView);
    let dir = tempfile::tempdir().unwrap();
    let original = format!("\n{BLANK}\n");
    let s = surface(cx, &original, true, dir.path());
    let seen = Rc::new(std::cell::RefCell::new(Vec::new()));
    let log = seen.clone();
    let _subscription =
        cx.update(|_, cx| s.subscribe(Rc::new(move |e, _| log.borrow_mut().push(e)), cx));
    let before_ready = generation(&s, cx);
    content(&s, cx, before_ready, "not ready");
    ready(&s, cx);
    content(&s, cx, before_ready, &original);
    assert_eq!(text(&s, cx), original);
    cx.run_until_parked();
    assert!(seen.borrow().is_empty());
    content(&s, cx, before_ready, BLANK);
    cx.run_until_parked();
    assert_eq!(*seen.borrow(), [SurfaceEvent::Changed]);
    cx.update(|w, cx| s.apply(true, false, Scale::default(), w, cx));
    ready(&s, cx);
    let readonly = generation(&s, cx);
    content(&s, cx, readonly, "read only");
    cx.update(|w, cx| s.apply(false, false, Scale::default(), w, cx));
    ready(&s, cx);
    content(&s, cx, before_ready, "queued before freeze");
    content(&s, cx, readonly, "queued during freeze");
    assert_eq!(text(&s, cx), BLANK);
    cx.run_until_parked();
    assert_eq!(seen.borrow().len(), 1);
}

#[gpui::test]
fn source_mode_retires_board_writes_and_returns_the_latest_json(app: &mut TestAppContext) {
    let (_window, cx) = app.add_window_view(|_, _| EmptyView);
    let dir = tempfile::tempdir().unwrap();
    let s = surface(cx, BLANK, true, dir.path());
    ready(&s, cx);
    let old = generation(&s, cx);
    cx.update(|w, cx| s.pane_segment("source", w, cx));
    assert_eq!(s.mode.get(), Mode::Source);
    assert!(!s.board.read_with(cx, |v, _| v.active));
    content(&s, cx, old, "late board");
    let edited = format!("\n{BLANK}\n");
    cx.update(|w, cx| s.source.replace_text(&edited, w, cx));
    assert_eq!(text(&s, cx), edited);
    cx.update(|w, cx| s.pane_segment("live", w, cx));
    ready(&s, cx);
    content(&s, cx, old, "late after returning");
    assert_eq!(s.mode.get(), Mode::Board);
    assert_eq!(text(&s, cx), edited);
}

#[gpui::test]
fn missing_packs_still_allow_source_repair_and_never_admit_page_messages(app: &mut TestAppContext) {
    let (_window, cx) = app.add_window_view(|_, _| EmptyView);
    let dir = tempfile::tempdir().unwrap();
    for invalid in [
        "",
        "{",
        "{}",
        r#"{"type":"excalidraw","version":99,"elements":[]}"#,
        r#"{"type":"excalidraw","version":2,"elements":[null]}"#,
    ] {
        let s = surface(cx, invalid, false, dir.path());
        ready(&s, cx);
        let g = generation(&s, cx);
        content(&s, cx, g, BLANK);
        assert_eq!(text(&s, cx), invalid);
        cx.update(|w, cx| s.pane_segment("source", w, cx));
        assert_eq!(text(&s, cx), invalid);
        cx.update(|w, cx| s.source.replace_text(BLANK, w, cx));
        cx.update(|w, cx| s.pane_segment("live", w, cx));
        assert_eq!(text(&s, cx), BLANK);
        assert!(!s.board.read_with(cx, |v, _| v.ready));
    }
}

struct EmptyView;
impl Render for EmptyView {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
    }
}

#[test]
fn the_bundled_bridge_and_real_product_model_preserve_scene_acceptance() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let result = crate::platform::process::run(
        Path::new("node"),
        &["tools/verify-whiteboard-bridge.mjs"],
        &root,
        None,
        std::time::Duration::from_secs(30),
        &std::sync::atomic::AtomicBool::new(false),
    )
    .expect("the actual product model and native bridge must execute");
    let result: serde_json::Value =
        serde_json::from_slice(&result).expect("structured bridge receipt");
    assert_eq!(result["passed"], true);
    let expected = [
        "original-bytes-semantic-edit-detach",
        "external-reset-and-stale-scene",
        "invalid-scene-0-source-repair",
        "invalid-scene-1-source-repair",
        "invalid-scene-2-source-repair",
        "invalid-scene-3-source-repair",
        "invalid-scene-4-source-repair",
        "embedded-image-properties",
        "read-only-owner-replacement-links",
    ];
    assert_eq!(result["checks"], serde_json::json!(expected));
}

#[gpui::test]
fn only_the_current_ready_board_can_open_workspace_links(app: &mut TestAppContext) {
    let (_window, cx) = app.add_window_view(|_, _| EmptyView);
    let dir = tempfile::tempdir().unwrap();
    let s = surface(cx, BLANK, true, dir.path());
    let seen = Rc::new(std::cell::RefCell::new(Vec::new()));
    let log = seen.clone();
    let _subscription = cx.update(|_, cx| {
        s.set_reference_context(
            Some(ReferenceContext {
                source: "boards/plan.excalidraw".into(),
                index: Arc::new(navigation::ReferenceIndex::new(vec![
                    navigation::Document {
                        path: "notes/a.md".into(),
                        name: "a.md".into(),
                    },
                ])),
            }),
            cx,
        );
        s.subscribe(Rc::new(move |event, _| log.borrow_mut().push(event)), cx)
    });
    let old = generation(&s, cx);
    message(
        &s,
        cx,
        serde_json::json!({"type":"link","generation":old,"link":"../notes/a.md"}),
    );
    // A pre-ready theme change retires the old frame and its handshake.
    cx.update(|w, cx| s.apply(false, true, Scale::default(), w, cx));
    message(&s, cx, serde_json::json!({"type":"ready","generation":old}));
    assert!(!s.board.read_with(cx, |v, _| v.ready));
    ready(&s, cx);
    message(
        &s,
        cx,
        serde_json::json!({"type":"link","generation":old,"link":"../notes/a.md"}),
    );
    let current = generation(&s, cx);
    message(
        &s,
        cx,
        serde_json::json!({"type":"link","generation":current,"link":"javascript:alert(1)"}),
    );
    message(
        &s,
        cx,
        serde_json::json!({"type":"link","generation":current,"link":"../notes/a.md"}),
    );
    cx.run_until_parked();
    assert_eq!(
        *seen.borrow(),
        [SurfaceEvent::OpenPaths(vec!["notes/a.md".into()])]
    );
    cx.update(|w, cx| s.pane_segment("source", w, cx));
    let inactive = generation(&s, cx);
    ready(&s, cx);
    message(
        &s,
        cx,
        serde_json::json!({"type":"link","generation":inactive,"link":"../notes/a.md"}),
    );
    cx.run_until_parked();
    assert_eq!(seen.borrow().len(), 1);
}

#[gpui::test]
fn ready_theme_and_history_commands_keep_the_same_frame_and_read_only_fences(
    app: &mut TestAppContext,
) {
    let (_window, cx) = app.add_window_view(|_, _| EmptyView);
    let dir = tempfile::tempdir().unwrap();
    let s = surface(cx, BLANK, true, dir.path());
    let scripts = Rc::new(std::cell::RefCell::new(Vec::<serde_json::Value>::new()));
    let log = scripts.clone();
    let frame = s.board.read_with(cx, |v, _| v.frame.clone().unwrap());
    frame.update(cx, |f, _| {
        f.record_evaluations(move |script| {
            let body = script
                .strip_prefix("window.__puppyoneWhiteboard&&window.__puppyoneWhiteboard(")
                .unwrap()
                .strip_suffix(')')
                .unwrap();
            log.borrow_mut().push(serde_json::from_str(body).unwrap());
        })
    });
    ready(&s, cx);
    let old = generation(&s, cx);
    cx.update(|w, cx| {
        s.apply(false, true, Scale::default(), w, cx);
        s.undo(false, w, cx);
        s.undo(true, w, cx);
        s.apply(true, true, Scale::default(), w, cx);
        s.undo(false, w, cx);
    });
    assert_eq!(
        s.board.read_with(cx, |v, _| v.frame.clone().unwrap()),
        frame
    );
    assert_eq!(
        scripts
            .borrow()
            .iter()
            .map(|v| v["type"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["theme", "history", "history", "enabled"]
    );
    assert_eq!(scripts.borrow()[1]["direction"], "undo");
    assert_eq!(scripts.borrow()[2]["direction"], "redo");
    assert_eq!(scripts.borrow()[3]["value"], false);
    assert_eq!(text(&s, cx), BLANK);
    cx.update(|w, cx| s.apply(false, true, Scale::default(), w, cx));
    content(&s, cx, old, "queued before read-only");
    assert_eq!(text(&s, cx), BLANK);
}
