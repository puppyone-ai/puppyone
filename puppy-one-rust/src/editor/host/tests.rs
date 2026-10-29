//! The native pane (GPUI test platform): what each editor contributes to the
//! pane menu, running its entries, and find routing.
use super::DocumentEditor;
use crate::{
    documents::{ClientMessage, HostMessage},
    editor::{
        markdown::MarkdownExtension,
        view::style,
        workbench::{
            find::FindEvent,
            pane::{Action, ItemKind},
        },
    },
};
use gpui::{Entity, TestAppContext, VisualTestContext};
use std::{cell::RefCell, rc::Rc};

fn setup<'a>(
    cx: &'a mut TestAppContext,
    name: &str,
    text: &str,
) -> (
    Entity<DocumentEditor>,
    Rc<RefCell<Vec<ClientMessage>>>,
    &'a mut VisualTestContext,
) {
    cx.update(|cx| {
        if cx.try_global::<gpui_kit::component::Theme>().is_none() {
            gpui_kit::init(cx);
        }
        cx.text_system().add_fonts(style::font_bytes()).unwrap();
        crate::editor::view::bind_keys(cx);
        crate::editor::csv::bind_keys(cx);
        super::bind_keys(cx);
        crate::ui::form_input::bind_keys(cx);
    });
    let (view, cx) = cx.add_window_view(|_, cx| DocumentEditor::new(cx));
    let messages = Rc::new(RefCell::new(Vec::new()));
    let sink = messages.clone();
    cx.update(|_, cx| {
        cx.subscribe(&view, move |_, m: &ClientMessage, _| {
            sink.borrow_mut().push(m.clone())
        })
        .detach()
    });
    let open = HostMessage::Open {
        id: "doc-1".into(),
        name: name.into(),
        text: text.into(),
        revision: 0,
        external: false,
    };
    view.update_in(cx, |v, w, cx| {
        v.receive(&open, w, cx);
    });
    cx.run_until_parked();
    (view, messages, cx)
}

#[gpui::test]
fn csv_contributes_view_items_and_find(cx: &mut TestAppContext) {
    let (view, messages, cx) = setup(cx, "data/table.csv", "id,name\n1,anna\n2,bob\n");
    view.update_in(cx, |v, w, cx| {
        let c = v.contribution(cx);
        assert!(c.segmented.is_none() && c.find && c.open_external);
        assert_eq!(
            c.items.iter().map(|i| i.id).collect::<Vec<_>>(),
            vec![
                "csv-header-row",
                "csv-row-numbers",
                "csv-fit-columns-to-viewport",
                "csv-reset-column-widths"
            ]
        );
        assert_eq!(c.items[1].kind, ItemKind::Toggle(true));
        // A toggle keeps the menu open and flips.
        v.toggle_pane_menu(w, cx);
        v.run_pane_action(Action::Item("csv-row-numbers"), w, cx);
        assert!(v.chrome.open);
        assert_eq!(v.contribution(cx).items[1].kind, ItemKind::Toggle(false));
        // Close is the shell's command and closes the menu.
        v.run_pane_action(Action::Close, w, cx);
        assert!(!v.chrome.open);
        assert_eq!(
            v.session.as_ref().map(|s| s.name.as_str()),
            Some("table.csv")
        );
    });
    assert!(
        messages
            .borrow()
            .iter()
            .any(|m| matches!(m, ClientMessage::Action { action } if action == "close-file"))
    );
    // Find routes the query to the table and reports its result.
    view.update_in(cx, |v, w, cx| v.open_find(w, cx));
    let bar = view
        .update(cx, |v, cx| v.find_bar(cx))
        .expect("find bar open");
    bar.update(cx, |_, cx| cx.emit(FindEvent::Query("b".into())));
    cx.run_until_parked();
    bar.update(cx, |b, _| assert_eq!((b.current, b.total), (1, 1)));
    bar.update(cx, |_, cx| cx.emit(FindEvent::Close));
    cx.run_until_parked();
    assert!(view.update(cx, |v, cx| v.find_bar(cx)).is_none());
}

#[gpui::test]
fn markdown_contributes_its_mode_segments(cx: &mut TestAppContext) {
    let (view, _, cx) = setup(cx, "notes.md", "# Title\n");
    view.update_in(cx, |v, w, cx| {
        let c = v.contribution(cx);
        assert_eq!(c.segmented.as_ref().map(|s| s.value), Some("live"));
        assert!(c.items.is_empty() && c.find);
        v.toggle_pane_menu(w, cx);
        v.run_pane_action(Action::Segment("source"), w, cx);
        // Segments keep the menu open.
        assert!(v.chrome.open);
        assert_eq!(
            v.contribution(cx).segmented.map(|s| s.value),
            Some("source")
        );
        let editor = v.surface.as_ref().and_then(|s| s.editor_view()).unwrap();
        assert!(
            !editor
                .read(cx)
                .extension::<MarkdownExtension>()
                .unwrap()
                .live
        );
    });
}

#[gpui::test]
fn find_marks_and_selects_matches_in_text_editors(cx: &mut TestAppContext) {
    let (view, _, cx) = setup(cx, "notes.md", "alpha beta\nAlpha gamma\nalphabet\n");
    view.update_in(cx, |v, w, cx| v.open_find(w, cx));
    let bar = view
        .update(cx, |v, cx| v.find_bar(cx))
        .expect("find bar open");
    bar.update(cx, |_, cx| cx.emit(FindEvent::Query("ALPHA".into())));
    cx.run_until_parked();
    bar.update(cx, |b, _| assert_eq!((b.current, b.total), (1, 3)));
    let editor = view.update(cx, |v, _| {
        v.surface.as_ref().and_then(|s| s.editor_view()).unwrap()
    });
    editor.update(cx, |e, _| {
        assert_eq!(e.find_marks().matches, vec![0..5, 11..16, 23..28]);
        assert_eq!(
            (e.state().selection.from(), e.state().selection.to()),
            (0, 5)
        );
    });
    bar.update(cx, |_, cx| cx.emit(FindEvent::Move { forward: false }));
    cx.run_until_parked();
    bar.update(cx, |b, _| assert_eq!(b.current, 3));
    editor.update(cx, |e, _| assert_eq!(e.state().selection.from(), 23));
    bar.update(cx, |_, cx| cx.emit(FindEvent::Close));
    cx.run_until_parked();
    editor.update(cx, |e, _| assert!(e.find_marks().matches.is_empty()));
}

#[gpui::test]
fn a_snapshot_waits_for_the_composition_and_resumes_when_it_ends(cx: &mut TestAppContext) {
    use gpui::EntityInputHandler;
    let (view, messages, cx) = setup(cx, "notes.md", "a");
    let editor = view.update(cx, |v, _| {
        v.surface.as_ref().and_then(|s| s.editor_view()).unwrap()
    });
    let dirty = |messages: &Rc<RefCell<Vec<ClientMessage>>>| {
        messages
            .borrow()
            .iter()
            .filter_map(|m| {
                if let ClientMessage::Dirty { dirty, .. } = m {
                    Some(*dirty)
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
    };
    editor.update_in(cx, |e, w, cx| {
        e.set_selection(crate::editor::text::selection::Selection::cursor(1), cx);
        e.replace_and_mark_text_in_range(None, "ni", Some(2..2), w, cx);
    });
    cx.run_until_parked();
    assert!(
        dirty(&messages).is_empty(),
        "provisional text is not reported"
    );
    let snapshot = HostMessage::Snapshot {
        request: 7,
        freeze: true,
    };
    let replies = view.update_in(cx, |v, w, cx| v.receive(&snapshot, w, cx));
    assert!(
        matches!(
            replies.as_slice(),
            [ClientMessage::Deferred { request: 7, .. }]
        ),
        "{replies:?}"
    );
    // Cancelling changes nothing but still reports, so the host proceeds.
    editor.update_in(cx, |e, w, cx| {
        e.replace_and_mark_text_in_range(None, "", Some(0..0), w, cx)
    });
    cx.run_until_parked();
    assert_eq!(dirty(&messages), vec![false]);
    // A committed composition reports once.
    editor.update_in(cx, |e, w, cx| {
        e.replace_and_mark_text_in_range(None, "ni", Some(2..2), w, cx);
        e.replace_text_in_range(None, "你", w, cx);
    });
    cx.run_until_parked();
    assert_eq!(dirty(&messages), vec![false, true]);
    let replies = view.update_in(cx, |v, w, cx| v.receive(&snapshot, w, cx));
    assert!(
        matches!(replies.as_slice(), [ClientMessage::Snapshot { request: 7, text, .. }] if text == "a你"),
        "{replies:?}"
    );
}

#[gpui::test]
fn the_registry_picks_each_documents_surface(cx: &mut TestAppContext) {
    let (view, messages, cx) = setup(cx, "notes.md", "# Title\n");
    let open = |view: &Entity<DocumentEditor>, cx: &mut VisualTestContext, message: HostMessage| {
        view.update_in(cx, |v, w, cx| v.receive(&message, w, cx))
    };
    view.update(cx, |v, _| {
        let session = v.session.as_ref().unwrap();
        assert_eq!((session.viewer.id, session.editable), ("markdown", true));
    });
    // An image: a resource surface, read only, with nothing to snapshot.
    let replies = open(
        &view,
        cx,
        HostMessage::OpenResource {
            id: "img".into(),
            name: "assets/logo.png".into(),
            path: crate::workspace::testing::preview("logo.png"),
        },
    );
    assert!(matches!(replies.as_slice(), [ClientMessage::Loaded { id }] if id == "img"));
    view.update(cx, |v, cx| {
        let session = v.session.as_ref().unwrap();
        assert_eq!(
            (session.viewer.id, session.editable, session.name.as_str()),
            ("image-preview", false, "logo.png")
        );
        assert!(v.surface.as_ref().unwrap().text(cx).is_none());
        let c = v.contribution(cx);
        assert!(!c.find && c.segmented.is_none() && c.open_external);
    });
    let replies = open(
        &view,
        cx,
        HostMessage::Snapshot {
            request: 3,
            freeze: true,
        },
    );
    assert!(replies.is_empty());
    // A file no viewer renders, and a product viewer the native build lacks.
    open(
        &view,
        cx,
        HostMessage::OpenResource {
            id: "bin".into(),
            name: "model.qqqq".into(),
            path: crate::workspace::testing::preview("model.qqqq"),
        },
    );
    view.update(cx, |v, _| {
        assert_eq!(
            v.session.as_ref().unwrap().viewer.id,
            "document-placeholder"
        )
    });
    open(
        &view,
        cx,
        HostMessage::OpenResource {
            id: "pdf".into(),
            name: "paper.pdf".into(),
            path: crate::workspace::testing::preview("paper.pdf"),
        },
    );
    view.update(cx, |v, _| {
        assert_eq!(v.session.as_ref().unwrap().viewer.id, "pdf-preview")
    });
    // Source text keeps its editor; nothing reported dirty along the way.
    open(
        &view,
        cx,
        HostMessage::Open {
            id: "rs".into(),
            name: "src/main.rs".into(),
            text: "fn main() {}\n".into(),
            revision: 0,
            external: false,
        },
    );
    view.update(cx, |v, cx| {
        let session = v.session.as_ref().unwrap();
        assert_eq!((session.viewer.id, session.editable), ("text", true));
        assert_eq!(
            v.surface.as_ref().unwrap().text(cx).as_deref(),
            Some("fn main() {}\n")
        );
    });
    assert!(
        !messages
            .borrow()
            .iter()
            .any(|m| matches!(m, ClientMessage::Dirty { .. }))
    );
}

#[gpui::test]
fn code_snapshot_defers_during_ime_and_freezes_until_thawed(cx: &mut TestAppContext) {
    use gpui::EntityInputHandler;
    let (view, messages, cx) = setup(cx, "data.json", "");
    let editor = view.update(cx, |v, _| {
        v.surface.as_ref().unwrap().code_editor().unwrap()
    });
    editor.update_in(cx, |e, w, cx| {
        e.replace_and_mark_text_in_range(None, "ni", Some(2..2), w, cx)
    });
    cx.run_until_parked();
    let snapshot = HostMessage::Snapshot {
        request: 21,
        freeze: true,
    };
    let replies = view.update_in(cx, |v, w, cx| v.receive(&snapshot, w, cx));
    assert!(matches!(
        replies.as_slice(),
        [ClientMessage::Deferred { request: 21, .. }]
    ));
    assert!(
        !messages
            .borrow()
            .iter()
            .any(|m| matches!(m, ClientMessage::Dirty { .. }))
    );
    editor.update_in(cx, |e, w, cx| e.unmark_text(w, cx));
    cx.run_until_parked();
    assert!(
        messages
            .borrow()
            .iter()
            .any(|m| matches!(m, ClientMessage::Dirty { dirty: true, .. }))
    );
    let replies = view.update_in(cx, |v, w, cx| v.receive(&snapshot, w, cx));
    assert!(
        matches!(replies.as_slice(), [ClientMessage::Snapshot {request:21,text,..}] if text=="ni")
    );
    editor.update_in(cx, |e, w, cx| {
        e.replace_text_in_range(None, "blocked", w, cx)
    });
    view.update(cx, |v, cx| assert_eq!(v.text(cx).as_deref(), Some("ni")));
    view.update_in(cx, |v, w, cx| v.receive(&HostMessage::Thaw, w, cx));
    editor.update_in(cx, |e, w, cx| e.replace_text_in_range(None, "好", w, cx));
    cx.run_until_parked();
    view.update(cx, |v, cx| assert_eq!(v.text(cx).as_deref(), Some("ni好")));
}

#[gpui::test]
fn code_search_shortcut_opens_the_product_find_bar(cx: &mut TestAppContext) {
    let (view, _, cx) = setup(cx, "main.ts", "const answer = 42;");
    view.update_in(cx, |v, w, cx| v.focus_document(w, cx));
    cx.run_until_parked();
    cx.simulate_keystrokes("cmd-f");
    cx.run_until_parked();
    assert!(view.update(cx, |v, cx| v.find_bar(cx)).is_some());
}

thread_local! {
    static PACK_SURFACES: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
}
struct PackProbe;
impl crate::editor::registry::ViewerSurface for PackProbe {
    fn element(&self) -> gpui::AnyElement {
        use gpui::IntoElement;
        gpui::div().into_any_element()
    }
}
fn pack_surface(
    _: &crate::editor::registry::SurfaceRequest,
    pack: &crate::editor::registry::packs::PackContribution,
    _: &mut gpui::Window,
    _: &mut gpui::App,
) -> Box<dyn crate::editor::registry::ViewerSurface> {
    PACK_SURFACES.with(|s| s.borrow_mut().push(pack.plugin_id.clone()));
    Box::new(PackProbe)
}

#[gpui::test]
fn installed_packs_render_placeholder_documents_through_the_host_port(cx: &mut TestAppContext) {
    use crate::editor::registry::packs::{ExtensionHost, Snapshot, route::tests::pack};
    let (view, _, cx) = setup(cx, "notes.md", "# Title\n");
    let open = |view: &Entity<DocumentEditor>, cx: &mut VisualTestContext, id: &str, name: &str| {
        let message = HostMessage::OpenResource {
            id: id.into(),
            name: name.into(),
            path: crate::workspace::testing::preview(name),
        };
        view.update_in(cx, |v, w, cx| v.receive(&message, w, cx));
    };
    let rendered = || PACK_SURFACES.with(|s| s.borrow().clone());
    // A pack without a host surface changes nothing.
    view.update(cx, |v, _| {
        v.set_extension_host(Some(ExtensionHost {
            snapshot: Snapshot {
                sequence: 1,
                contributions: vec![pack("a.glb", &[".glb"], &[])],
            },
            surface: None,
        }))
    });
    open(&view, cx, "1", "scene/model.glb");
    assert!(rendered().is_empty());
    // With one: the matching pack renders the placeholder-grade file.
    view.update(cx, |v, _| {
        v.set_extension_host(Some(ExtensionHost {
            snapshot: Snapshot {
                sequence: 2,
                contributions: vec![
                    pack("a.glb", &[".glb"], &[]),
                    pack("md.pack", &[".md"], &[]),
                ],
            },
            surface: Some(pack_surface),
        }))
    });
    open(&view, cx, "2", "scene/model.glb");
    assert_eq!(rendered(), vec!["a.glb"]);
    // A preset viewer always wins.
    view.update_in(cx, |v, w, cx| {
        v.receive(
            &HostMessage::Open {
                id: "3".into(),
                name: "readme.md".into(),
                text: "# x\n".into(),
                revision: 0,
                external: false,
            },
            w,
            cx,
        )
    });
    view.update(cx, |v, _| {
        assert_eq!(v.session.as_ref().unwrap().viewer.id, "markdown")
    });
    // Two equal candidates: the chooser opens, nothing renders until a pick.
    view.update(cx, |v, _| {
        v.set_extension_host(Some(ExtensionHost {
            snapshot: Snapshot {
                sequence: 3,
                contributions: vec![pack("a.glb", &[".glb"], &[]), pack("b.glb", &[".glb"], &[])],
            },
            surface: Some(pack_surface),
        }))
    });
    open(&view, cx, "4", "scene/model.glb");
    assert_eq!(rendered(), vec!["a.glb"]);
}

#[gpui::test]
fn json_shows_formatted_but_saves_only_after_an_edit(cx: &mut TestAppContext) {
    let raw = r#"{"name":"puppyone","count":42}"#;
    let (view, _, cx) = setup(cx, "data/sample.json", raw);
    let snapshot = |view: &Entity<DocumentEditor>, cx: &mut VisualTestContext, request| {
        view.update_in(cx, |v, w, cx| {
            v.receive(
                &HostMessage::Snapshot {
                    request,
                    freeze: false,
                },
                w,
                cx,
            )
        })
    };
    view.update_in(cx, |v, _, cx| {
        let shown = v.surface.as_ref().unwrap().text(cx).unwrap();
        assert_eq!(shown, "{\n  \"name\": \"puppyone\",\n  \"count\": 42\n}");
        // The untouched view stands for the raw text: nothing to save.
        assert_eq!(v.text(cx).as_deref(), Some(raw));
    });
    let replies = snapshot(&view, cx, 3);
    assert!(matches!(replies.as_slice(), [ClientMessage::Snapshot { text, .. }] if text == raw));
    // The same document re-sent (after a save elsewhere) keeps the view.
    view.update_in(cx, |v, w, cx| {
        v.receive(
            &HostMessage::Open {
                id: "doc-1".into(),
                name: "data/sample.json".into(),
                text: raw.into(),
                revision: 0,
                external: false,
            },
            w,
            cx,
        );
    });
    // An edit makes the formatted text the document.
    view.update_in(cx, |v, w, cx| {
        let formatted = v.surface.as_ref().unwrap().text(cx).unwrap();
        v.surface
            .as_ref()
            .unwrap()
            .replace_text(&formatted.replace("42", "43"), w, cx);
    });
    let replies = snapshot(&view, cx, 4);
    assert!(matches!(
        replies.as_slice(),
        [ClientMessage::Snapshot { text, .. }] if text == "{\n  \"name\": \"puppyone\",\n  \"count\": 43\n}"
    ));
}
