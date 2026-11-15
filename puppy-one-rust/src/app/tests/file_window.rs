//! A file window.
use super::*;
use core::prelude::v1::test;

/// W-2, qubits `822dbe7b2`, `68ab98d83`, `b012ce39e`, `919fb02db`: a file
/// window shows its one file under the product Header with `Edit` and
/// `Source code` controls, with no project around it. Edits are saved as
/// they are made, an outside change shows, and closing asks nothing.
#[gpui::test]
fn a_file_window_shows_one_file_and_saves_it_as_it_is_edited(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    std::fs::write(root.join("notes.md"), "# Notes\n").unwrap();
    std::fs::write(root.join("other.md"), "# Other\n").unwrap();
    let (view, cx) = setup(cx);
    view.update_in(cx, |s, w, cx| {
        let file = file_mode::FileTarget::of(root.join("notes.md")).unwrap();
        s.session
            .project
            .update(cx, |p, _| p.record.fixture = false);
        s.bind_file(file, false, w, cx);
    });
    settle_cloud(&view, cx, "the file", &|s, cx| {
        s.files(cx)
            .opened()
            .is_some_and(|(_, p)| p == std::path::Path::new("notes.md"))
    });
    view.read_with(cx, |s, cx| {
        assert!(!s.home_visible(cx));
        assert!(!s.opening(cx));
        // The document spans the window under the Header.
        assert_eq!(s.frame.layout.editor.x, 0.);
        assert_eq!(s.frame.layout.explorer.w, 0.);
        // Not remembered as a project, never shared or put in the Cloud.
        assert!(s.prefs.store.read(cx).state.recent_projects.is_empty());
        assert!(s.cloud.read(cx).local_folder_notice(cx).is_none());
        // The one file is watched, so an Agent's edits show.
        assert!(s.files(cx).watching());
    });
    std::fs::write(root.join("notes.md"), "# Notes, changed\n").unwrap();
    settle_cloud(&view, cx, "the reread", &|s, cx| {
        s.files(cx)
            .document
            .as_ref()
            .is_some_and(|d| d.text == "# Notes, changed\n")
    });
    // Project commands, Settings, Help and Close File do nothing here.
    command(&view, cx, Command::Home);
    view.read_with(cx, |s, cx| {
        assert!(!s.session.project.read(cx).home && !s.home_visible(cx))
    });
    for c in [
        Command::Settings,
        Command::Feedback,
        Command::CloseFile,
        Command::NextEditor,
    ] {
        command(&view, cx, c);
    }
    cx.run_until_parked();
    view.read_with(cx, |s, cx| {
        assert!(s.dialogs.read(cx).is_empty());
        assert!(s.files(cx).opened().is_some());
    });
    // A link to a neighbour opens nothing: the file has none.
    let slot = view.read_with(cx, |s, cx| s.files(cx).active_slot());
    view.update(cx, |s, cx| {
        s.session.docs.update(cx, |d, _| {
            d.client_for(
                slot,
                crate::documents::ClientMessage::OpenPaths {
                    paths: vec!["other.md".into()],
                },
            )
        })
    });
    cx.run_until_parked();
    view.read_with(cx, |s, cx| {
        assert_eq!(
            s.files(cx).opened().map(|(_, p)| p.to_owned()),
            Some(PathBuf::from("notes.md"))
        )
    });
    draw(cx);
    let editor = view.read_with(cx, |s, cx| {
        s.file.as_ref().unwrap().read(cx).file_editor(cx).unwrap()
    });
    // In File Mode, Markdown starts with `Edit` and `Source code` off, and
    // typing on the rendered page is ignored until `Edit` is turned on.
    view.read_with(cx, |_, cx| {
        let controls = editor.read(cx).title_controls(cx);
        assert!(controls.segmented.is_none());
        assert_eq!(
            controls
                .toggles
                .iter()
                .map(|t| (t.id, t.checked))
                .collect::<Vec<_>>(),
            vec![
                ("document-editing", false),
                ("document-source-panel", false)
            ]
        );
    });
    editor.update_in(cx, |e, w, cx| {
        e.run_title_action(
            crate::editor::workbench::pane::Action::Item("document-editing"),
            w,
            cx,
        );
    });
    view.read_with(cx, |_, cx| {
        let controls = editor.read(cx).title_controls(cx);
        assert!(controls.toggles[0].checked);
    });
    // Typing saves: no save step, no unsaved mark, no question on close.
    editor.update_in(cx, |e, w, cx| e.lab_type("Hello ", w, cx));
    settle_cloud(&view, cx, "the autosave", &|s, cx| {
        !s.files(cx).busy()
            && !s.files(cx).saving()
            && !s.files(cx).dirty
            && std::fs::read_to_string(root.join("notes.md"))
                .is_ok_and(|text| text.contains("Hello "))
    });
    view.read_with(cx, |s, _| {
        assert_eq!(s.session.title.as_ref().map(|t| t.2), Some(false))
    });
    view.update_in(cx, |s, w, cx| {
        s.command(Command::Quit, w, cx);
        s.receive(w, cx);
    });
    cx.run_until_parked();
    assert!(!cx.has_pending_prompt());
    if !cx.read(|app| app.windows().is_empty()) {
        view.read_with(cx, |s, cx| {
            assert!(s.dialogs.read(cx).is_empty());
            assert!(s.files(cx).allow_quit);
        });
    }
}

/// Companion source panel in File Mode opens via `document-source-panel` or
/// `Cmd/Ctrl+/` (`source` command) and stays in sync with the document.
#[gpui::test]
fn file_window_markdown_source_panel_toggles_and_syncs(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    std::fs::write(root.join("notes.md"), "# Notes\n").unwrap();
    let (view, cx) = setup(cx);
    view.update_in(cx, |s, w, cx| {
        let file = file_mode::FileTarget::of(root.join("notes.md")).unwrap();
        s.session
            .project
            .update(cx, |p, _| p.record.fixture = false);
        s.bind_file(file, false, w, cx);
    });
    settle_cloud(&view, cx, "the file", &|s, cx| {
        s.files(cx).opened().is_some() && !s.files(cx).busy()
    });
    draw(cx);
    let editor = view.read_with(cx, |s, cx| {
        s.file.as_ref().unwrap().read(cx).file_editor(cx).unwrap()
    });
    editor.update_in(cx, |e, w, cx| e.command("source", w, cx));
    draw(cx);
    view.read_with(cx, |_, cx| {
        let controls = editor.read(cx).title_controls(cx);
        assert_eq!(
            controls
                .toggles
                .iter()
                .map(|t| (t.id, t.checked))
                .collect::<Vec<_>>(),
            vec![("document-editing", false), ("document-source-panel", true)]
        );
    });
}

/// An HTML file opened in a File Mode window still gets folder access for its
/// parent directory (`FileModeApp` with `createLocalDataPort(target.rootPath)`).
#[gpui::test]
fn file_window_html_page_asks_for_folder_access(cx: &mut TestAppContext) {
    use crate::editor::workbench::pane::ItemKind;
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    std::fs::write(root.join("tasks.md"), "- [ ] ship\n").unwrap();
    std::fs::write(
        root.join("gantt.html"),
        "<!doctype html><html><head></head><body><script>window.showDirectoryPicker()</script></body></html>",
    )
    .unwrap();
    let (view, cx) = setup(cx);
    view.update_in(cx, |s, w, cx| {
        let file = file_mode::FileTarget::of(root.join("gantt.html")).unwrap();
        s.session
            .project
            .update(cx, |p, _| p.record.fixture = false);
        s.bind_file(file, false, w, cx);
    });
    settle_cloud(&view, cx, "the html file", &|s, cx| {
        s.files(cx).opened().is_some() && !s.files(cx).busy()
    });
    cx.run_until_parked();
    draw(cx);
    view.read_with(cx, |s, cx| {
        assert!(s.dialogs.read(cx).contains(DialogKey::Question));
    });
    let accept = cx.debug_bounds("viewer-question-accept").unwrap().center();
    cx.simulate_click(accept, Modifiers::none());
    cx.run_until_parked();
    draw(cx);
    let editor = view.read_with(cx, |s, cx| {
        s.file.as_ref().unwrap().read(cx).file_editor(cx).unwrap()
    });
    view.read_with(cx, |_, cx| {
        let controls = editor.read(cx).title_controls(cx);
        let toggle = controls
            .items
            .iter()
            .find(|i| i.id == "html-folder-access")
            .map(|i| i.kind.clone());
        assert_eq!(toggle, Some(ItemKind::Toggle(true)));
    });
}

/// HTML File Mode toggles the 380px Local Agent Chat drawer without leaking
/// into PreferencesStore, and resets cleanly.
#[gpui::test]
fn file_window_html_chat_drawer_splits_without_affecting_project_panes(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    std::fs::write(
        root.join("report.html"),
        "<!doctype html><html><body><h1>Q4 Revenue</h1></body></html>\n",
    )
    .unwrap();
    let (view, cx) = setup(cx);
    cx.update(|_, cx| cx.set_reduce_motion(true));
    view.update_in(cx, |s, w, cx| {
        let file = file_mode::FileTarget::of(root.join("report.html")).unwrap();
        s.session
            .project
            .update(cx, |p, _| p.record.fixture = false);
        s.bind_file(file, false, w, cx);
    });
    settle_cloud(&view, cx, "the html file", &|s, cx| {
        s.files(cx).opened().is_some() && !s.files(cx).busy()
    });
    draw(cx);
    let fw = view.read_with(cx, |s, _| s.file.clone().unwrap());
    view.read_with(cx, |s, cx| {
        assert!(fw.read(cx).is_html());
        assert_eq!(s.frame.layout.explorer.w, 0.);
        assert_eq!(s.frame.layout.auxiliary.w, 0.);
        assert!(!s.panes.read(cx).right().open);
    });

    // The Header is quiet: pointing the Agent at the page belongs to Chat.
    assert!(cx.debug_bounds("html-tool-chat").is_some());
    assert!(cx.debug_bounds("html-tool-pick").is_none());

    // Open Local Agent Chat drawer -> 380px split on the right, no Explorer,
    // and the page tools beside Chat.
    fw.update_in(cx, |f, w, cx| f.toggle_chat(w, cx));
    cx.run_until_parked();
    draw(cx);
    assert!(cx.debug_bounds("html-tool-pick").is_some());
    view.read_with(cx, |s, cx| {
        assert!(s.panes.read(cx).right().open);
        assert_eq!(s.frame.layout.explorer.w, 0.);
        assert_eq!(s.frame.layout.auxiliary.w, 380.);
        assert_eq!(s.frame.layout.editor.w, s.frame.layout.header.w - 380.);
        assert!(s.prefs.store.read(cx).state.recent_projects.is_empty());
    });

    // Toggle Chat closed -> full document width restored.
    fw.update_in(cx, |f, w, cx| f.toggle_chat(w, cx));
    cx.run_until_parked();
    draw(cx);
    view.read_with(cx, |s, cx| {
        assert!(!s.panes.read(cx).right().open);
        assert_eq!(s.frame.layout.auxiliary.w, 0.);
        assert_eq!(s.frame.layout.editor.w, s.frame.layout.header.w);
    });
}

/// HTML File Mode DOM Element Picker (`指哪改哪`) maps clicked DOM nodes to
/// exact 1-based HTML source line ranges and stages `@report.html` + selector +
/// line range into the Local Agent Chat composer; JS runtime error self-heal
/// stages captured errors into Chat.
#[gpui::test]
fn file_window_html_dom_picker_and_js_error_self_heal_stage_into_local_agent_chat(
    cx: &mut TestAppContext,
) {
    use crate::editor::viewers::html_tools::HtmlToolMode;
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    let html_src = concat!(
        "<!doctype html>\n",
        "<html>\n",
        "<body>\n",
        "  <h1>Dashboard</h1>\n",
        "  <section id=\"revenue-chart\" class=\"chart-card\">\n",
        "    <h2>Monthly Revenue</h2>\n",
        "    <p>ARR Growth</p>\n",
        "  </section>\n",
        "</body>\n",
        "</html>\n",
    );
    std::fs::write(root.join("report.html"), html_src).unwrap();
    let (view, cx) = setup(cx);
    cx.update(|_, cx| cx.set_reduce_motion(true));
    view.update_in(cx, |s, w, cx| {
        let file = file_mode::FileTarget::of(root.join("report.html")).unwrap();
        s.session
            .project
            .update(cx, |p, _| p.record.fixture = false);
        s.bind_file(file, false, w, cx);
    });
    settle_cloud(&view, cx, "the html file", &|s, cx| {
        s.files(cx).opened().is_some() && !s.files(cx).busy()
    });
    draw(cx);
    let fw = view.read_with(cx, |s, _| s.file.clone().unwrap());
    let editor = view.read_with(cx, |_, cx| fw.read(cx).file_editor(cx).unwrap());

    // Enter PickElement mode.
    fw.update_in(cx, |f, w, cx| {
        f.toggle_html_tool(HtmlToolMode::PickElement, w, cx)
    });
    view.read_with(cx, |_, cx| {
        assert_eq!(
            editor.read(cx).html_tool_state().unwrap().mode,
            HtmlToolMode::PickElement
        );
    });

    // Deliver simulated WebView DOM picker payload for `<section#revenue-chart.chart-card>` (L5–L8).
    let picked_msg = serde_json::json!({
        "type": "po-tool",
        "kind": "picked",
        "selector": "section#revenue-chart.chart-card",
        "tag": "section",
        "id": "revenue-chart",
        "classes": ["chart-card"],
        "index": 0,
        "text": "Monthly Revenue ARR Growth",
        "html": "<section id=\"revenue-chart\" class=\"chart-card\"><h2>Monthly Revenue</h2></section>",
    })
    .to_string();
    editor.update(cx, |e, cx| e.lab_deliver_html_ipc(&picked_msg, cx));
    cx.run_until_parked();
    draw(cx);

    let panel = view.update_in(cx, |s, w, cx| {
        assert!(s.panes.read(cx).right().open);
        assert_eq!(
            editor.read(cx).html_tool_state().unwrap().mode,
            HtmlToolMode::None
        );
        let sb = s.sidebar.clone();
        sb.update(cx, |sb, cx| sb.ensure_active_chat(w, cx).unwrap())
    });
    // The page is staged once its workspace reference resolves, off the
    // main thread.
    let staged = panel.clone();
    settle_cloud(&view, cx, "the picked element staged", &move |_, cx| {
        let (draft, refs) = staged.read(cx).debug_staged_summary();
        refs.iter().any(|r| r == "report.html") && draft.contains("L5–L8")
    });
    view.read_with(cx, |_, cx| {
        let (draft, refs) = panel.read(cx).debug_staged_summary();
        assert!(
            refs.iter().any(|r| r == "report.html"),
            "expected report.html in staged references, got {refs:?}"
        );
        assert!(
            draft.contains("section#revenue-chart.chart-card") && draft.contains("L5–L8"),
            "expected selector + L5–L8 in draft, got: {draft}"
        );
    });

    // Deliver simulated JS runtime error and click self-heal pill action.
    let err_msg = serde_json::json!({
        "type": "po-tool",
        "kind": "js-error",
        "message": "Uncaught ReferenceError: renderRevenueSeries is not defined",
        "line": 7,
        "col": 12,
    })
    .to_string();
    editor.update(cx, |e, cx| e.lab_deliver_html_ipc(&err_msg, cx));
    cx.run_until_parked();
    draw(cx);
    view.read_with(cx, |_, cx| {
        let state = editor.read(cx).html_tool_state().unwrap();
        assert_eq!(state.js_errors.len(), 1);
        assert_eq!(state.js_errors[0].line, Some(7));
    });
    fw.update_in(cx, |f, w, cx| f.stage_js_errors_to_chat(w, cx));
    cx.run_until_parked();
    draw(cx);
    view.read_with(cx, |_, cx| {
        let (draft, _) = panel.read(cx).debug_staged_summary();
        assert!(
            draft.contains("[L7:12] Uncaught ReferenceError: renderRevenueSeries is not defined"),
            "expected formatted JS error in draft, got: {draft}"
        );
    });
}

/// Interactive screenshot copies Retina-cropped PNG bytes to the clipboard,
/// surfaces the in-flow toast banner (`贴入 Chat`), and annotation send-to-Agent
/// stages the PNG attachment directly into `AgentChatTabPanel`.
#[gpui::test]
fn file_window_html_screenshot_and_annotations_copy_png_and_stage_to_chat(cx: &mut TestAppContext) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    std::fs::write(
        root.join("report.html"),
        "<!doctype html><html><body><div class=\"card\">KPI</div></body></html>\n",
    )
    .unwrap();
    let (view, cx) = setup(cx);
    cx.update(|_, cx| cx.set_reduce_motion(true));
    view.update_in(cx, |s, w, cx| {
        let file = file_mode::FileTarget::of(root.join("report.html")).unwrap();
        s.session
            .project
            .update(cx, |p, _| p.record.fixture = false);
        s.bind_file(file, false, w, cx);
    });
    settle_cloud(&view, cx, "the html file", &|s, cx| {
        s.files(cx).opened().is_some() && !s.files(cx).busy()
    });
    draw(cx);
    let fw = view.read_with(cx, |s, _| s.file.clone().unwrap());
    let editor = view.read_with(cx, |_, cx| fw.read(cx).file_editor(cx).unwrap());

    // 1. Trigger region/card screenshot (`copy-screenshot`).
    let snap_msg = serde_json::json!({
        "type": "po-tool",
        "kind": "snapshot",
        "purpose": "copy-screenshot",
        "crop": [10.0, 12.0, 80.0, 50.0],
        "viewport": [400.0, 300.0],
        "label": "div.card",
    })
    .to_string();
    editor.update(cx, |e, cx| e.lab_deliver_html_ipc(&snap_msg, cx));
    cx.run_until_parked();
    draw(cx);

    view.read_with(cx, |_, cx| {
        assert!(fw.read(cx).has_screenshot_toast());
        let clip = cx.read_from_clipboard().expect("clipboard item");
        let has_png = clip.entries().iter().any(|entry| {
            matches!(
                entry,
                gpui::ClipboardEntry::Image(img)
                    if img.format == gpui::ImageFormat::Png && !img.bytes.is_empty()
            )
        });
        assert!(has_png, "expected PNG image on clipboard");
    });

    // Clicking `贴入 Chat` on the toast clears the banner and stages `html-screenshot.png`.
    fw.update_in(cx, |f, w, cx| f.paste_toast_to_chat(w, cx));
    cx.run_until_parked();
    draw(cx);
    let panel = view.update_in(cx, |s, w, cx| {
        let sb = s.sidebar.clone();
        sb.update(cx, |sb, cx| sb.ensure_active_chat(w, cx).unwrap())
    });
    // Attachments stage off the main thread.
    let staged = panel.clone();
    settle_cloud(&view, cx, "the screenshot staged", &move |_, cx| {
        let (_, refs) = staged.read(cx).debug_staged_summary();
        refs.iter().any(|r| r == "html-screenshot.png")
    });
    view.read_with(cx, |_, cx| {
        assert!(!fw.read(cx).has_screenshot_toast());
        let (_, refs) = panel.read(cx).debug_staged_summary();
        assert!(
            refs.iter().any(|r| r == "html-screenshot.png"),
            "expected html-screenshot.png staged in Chat, got {refs:?}"
        );
    });

    // A copy left alone is offered for a moment, then goes.
    editor.update(cx, |e, cx| e.lab_deliver_html_ipc(&snap_msg, cx));
    cx.run_until_parked();
    view.read_with(cx, |_, cx| assert!(fw.read(cx).has_screenshot_toast()));
    cx.executor()
        .advance_clock(std::time::Duration::from_secs(7));
    cx.run_until_parked();
    view.read_with(cx, |_, cx| assert!(!fw.read(cx).has_screenshot_toast()));

    // 2. Trigger `send-annotated` from the pen toolbar -> stages `annotated-page.png`.
    let ann_msg = serde_json::json!({
        "type": "po-tool",
        "kind": "snapshot",
        "purpose": "send-annotated",
        "viewport": [400.0, 300.0],
        "strokeCount": 3,
    })
    .to_string();
    editor.update(cx, |e, cx| e.lab_deliver_html_ipc(&ann_msg, cx));
    let staged = panel.clone();
    settle_cloud(&view, cx, "the annotated page staged", &move |_, cx| {
        let (draft, refs) = staged.read(cx).debug_staged_summary();
        refs.iter().any(|r| r == "annotated-page.png") && !draft.is_empty()
    });
    view.read_with(cx, |_, cx| {
        let (draft, refs) = panel.read(cx).debug_staged_summary();
        assert!(
            refs.iter().any(|r| r == "annotated-page.png"),
            "expected annotated-page.png staged in Chat, got {refs:?}"
        );
        assert!(!draft.is_empty());
    });
}
