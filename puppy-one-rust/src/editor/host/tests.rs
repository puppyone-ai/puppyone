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

mod external_consistency;

fn setup<'a>(
    cx: &'a mut TestAppContext,
    name: &str,
    text: &str,
) -> (
    Entity<DocumentEditor>,
    Rc<RefCell<Vec<ClientMessage>>>,
    &'a mut VisualTestContext,
) {
    setup_with(cx, "doc-1", None, name, text)
}
fn setup_with<'a>(
    cx: &'a mut TestAppContext,
    id: &str,
    workspace: Option<std::sync::Arc<crate::workspace::Workspace>>,
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
    view.update(cx, |v, _| v.set_workspace(workspace));
    let open = HostMessage::Open {
        id: id.into(),
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
fn a_host_without_persistence_never_accepts_user_input(cx: &mut TestAppContext) {
    use crate::workspace::{Workspace, testing::Memory};
    use gpui::EntityInputHandler;
    for writable in [false, true] {
        let mut provider = Memory::new("memory://editor-access/project/");
        provider.descriptor.capabilities.write = writable;
        let workspace = Workspace::from_provider(std::sync::Arc::new(provider)).unwrap();
        let (view, messages, visual) =
            setup_with(cx, "access", Some(workspace), "note.md", "original");
        let editor = view.read_with(visual, |view, _| {
            view.surface
                .as_ref()
                .unwrap()
                .as_test_probe()
                .unwrap()
                .editor_view()
                .unwrap()
        });
        editor.update_in(visual, |editor, window, cx| {
            editor.replace_text_in_range(None, "x", window, cx)
        });
        visual.run_until_parked();
        view.read_with(visual, |view, cx| {
            assert_eq!(
                view.surface.as_ref().unwrap().text(cx).unwrap(),
                if writable { "xoriginal" } else { "original" }
            );
        });
        assert_eq!(
            messages
                .borrow()
                .iter()
                .any(|message| matches!(message, ClientMessage::Dirty { dirty: true, .. })),
            writable
        );
    }
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

/// `Editor pane actions menu`: a resource-only pane offers just Open in
/// default app and Close, with no segments, find or items; Close is the
/// shell's command and closes the menu. An image keeps that pair first
/// and adds its zoom items after it.
#[gpui::test]
fn a_resource_only_pane_menu_is_open_externally_and_close(cx: &mut TestAppContext) {
    let (view, messages, cx) = setup(cx, "archive.zip", "");
    view.update_in(cx, |v, w, cx| {
        let c = v.contribution(cx);
        assert!(c.segmented.is_none() && !c.find && c.items.is_empty());
        assert_eq!(c.entries(), [Action::OpenExternal, Action::Close]);
        v.toggle_pane_menu(w, cx);
        v.run_pane_action(Action::Close, w, cx);
        assert!(!v.chrome.open);
    });
    assert!(
        messages
            .borrow()
            .iter()
            .any(|m| matches!(m, ClientMessage::Action { action } if action == "close-file"))
    );
    let (image, _, cx) = setup_with(cx, "image", None, "009_Bauhaus.png", "");
    image.update(cx, |v, cx| {
        let c = v.contribution(cx);
        assert!(c.segmented.is_none() && !c.find);
        assert_eq!(c.entries()[..2], [Action::OpenExternal, Action::Close]);
        assert_eq!(
            c.items.iter().map(|i| i.id).collect::<Vec<_>>(),
            [
                "image-zoom-fit",
                "image-zoom-actual",
                "image-zoom-in",
                "image-zoom-out"
            ]
        );
    });
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
        let editor = v
            .surface
            .as_ref()
            .and_then(|s| s.as_test_probe())
            .and_then(|p| p.editor_view())
            .unwrap();
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
        v.surface
            .as_ref()
            .and_then(|s| s.as_test_probe())
            .and_then(|p| p.editor_view())
            .unwrap()
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
        v.surface
            .as_ref()
            .and_then(|s| s.as_test_probe())
            .and_then(|p| p.editor_view())
            .unwrap()
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
        matches!(replies.as_slice(), [ClientMessage::Snapshot { request: 7, text, .. }] if text.eq_str("a你")),
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
        v.surface
            .as_ref()
            .unwrap()
            .as_test_probe()
            .unwrap()
            .code_editor()
            .unwrap()
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
        matches!(replies.as_slice(), [ClientMessage::Snapshot {request:21,text,..}] if text.eq_str("ni"))
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
    request: &crate::editor::registry::SurfaceRequest,
    pack: &crate::editor::registry::packs::PackContribution,
    _: &mut gpui::Window,
    _: &mut gpui::App,
) -> Box<dyn crate::editor::registry::ViewerSurface> {
    // A pack never reaches the working copy: no models to attach to.
    assert!(
        request
            .models
            .attach::<()>(
                crate::editor::document_session::models::ModelKind::Text,
                |_| true
            )
            .is_none()
    );
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
    // The working copy hands the host its document models; the pack still
    // never receives them (`pack_surface` asserts).
    let models = crate::editor::document_session::models::DocumentModels::default();
    view.update_in(cx, |v, w, cx| {
        v.receive(
            &HostMessage::Context {
                id: "2".into(),
                context: crate::editor::registry::DocumentContext {
                    source_kind: crate::editor::registry::SourceKind::Local,
                    models: models.handle(),
                    ..Default::default()
                },
            },
            w,
            cx,
        )
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
    assert!(
        matches!(replies.as_slice(), [ClientMessage::Snapshot { text, .. }] if text.eq_str(raw))
    );
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
        [ClientMessage::Snapshot { text, .. }] if text.eq_str("{\n  \"name\": \"puppyone\",\n  \"count\": 43\n}")
    ));
}

#[gpui::test]
fn html_edit_mode_applies_page_edits_to_the_source_and_its_history(cx: &mut TestAppContext) {
    let text = "<!doctype html><html><head></head><body><h1>Hello</h1></body></html>";
    let (view, messages, cx) = setup(cx, "site/page.html", text);
    let deliver = |view: &Entity<DocumentEditor>, cx: &mut VisualTestContext, body: &str| {
        let delivered = view.update(cx, |v, _| {
            v.surface
                .as_ref()
                .unwrap()
                .as_test_probe()
                .unwrap()
                .html_visual_deliver(body)
        });
        cx.run_until_parked();
        delivered
    };
    let text_of = |view: &Entity<DocumentEditor>, cx: &mut VisualTestContext| {
        view.update(cx, |v, cx| v.surface.as_ref().unwrap().text(cx).unwrap())
    };
    view.update_in(cx, |v, w, cx| {
        let c = v.contribution(cx);
        let segmented = c.segmented.expect("html modes");
        assert_eq!(
            segmented.options.iter().map(|o| o.id).collect::<Vec<_>>(),
            ["preview", "edit", "source"]
        );
        v.run_pane_action(Action::Segment("edit"), w, cx);
        assert_eq!(v.contribution(cx).segmented.unwrap().value, "edit");
    });
    // Edits wait for the page to boot; then one replaces "Hello" (UTF-16
    // offsets of the mirror) and joins the source history.
    let from = text.find("Hello").unwrap();
    let edit = |generation: u64| {
        format!(
            r#"{{"type":"edit","generation":{generation},"edits":[{{"from":{from},"to":{},"insert":"Hi 😀"}}]}}"#,
            from + 5
        )
    };
    assert!(deliver(&view, cx, &edit(1)));
    assert_eq!(text_of(&view, cx), text);
    assert!(deliver(&view, cx, r#"{"type":"ready"}"#));
    assert!(deliver(&view, cx, &edit(1)));
    let edited = text.replace("Hello", "Hi 😀");
    assert_eq!(text_of(&view, cx), edited);
    assert!(
        messages
            .borrow()
            .iter()
            .any(|m| matches!(m, ClientMessage::Dirty { dirty: true, .. }))
    );
    // Undo from the page runs the source history and resets the mirror
    // under a new generation; edits on the old one are dropped.
    assert!(deliver(
        &view,
        cx,
        r#"{"type":"history","direction":"undo"}"#
    ));
    assert_eq!(text_of(&view, cx), text);
    assert!(deliver(&view, cx, &edit(1)));
    assert_eq!(text_of(&view, cx), text);
    // A source change while editing reaches the page the same way.
    view.update_in(cx, |v, w, cx| {
        v.surface
            .as_ref()
            .unwrap()
            .replace_text("<p>From disk</p>", w, cx)
    });
    cx.run_until_parked();
    assert_eq!(text_of(&view, cx), "<p>From disk</p>");
    // A page that cannot map the document returns to Interact.
    assert!(deliver(&view, cx, r#"{"type":"unavailable"}"#));
    view.update(cx, |v, cx| {
        assert_eq!(v.contribution(cx).segmented.unwrap().value, "preview")
    });
}

/// v0.4.4 `useHtmlFolderAccessDecision`: a page naming the folder picker is
/// asked about before it runs; the answer belongs to that page text, the
/// pane menu changes it, and an allowed page cannot follow links.
#[gpui::test]
fn an_html_page_asks_before_it_uses_its_folder(cx: &mut TestAppContext) {
    use crate::localization::t;
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
    let folder = root.join("site");
    std::fs::create_dir(&folder).unwrap();
    std::fs::write(folder.join("tasks.md"), "- a\n").unwrap();
    let workspace = crate::workspace::Workspace::open(&root).unwrap();
    let page = "<!doctype html><html><head></head><body><a href=\"https://example.test/\">x</a>\
        <script>showDirectoryPicker()</script></body></html>";
    let (view, messages, cx) = setup_with(
        cx,
        "doc-html-folder",
        Some(workspace),
        "site/tracker.html",
        page,
    );
    let toggle = |view: &Entity<DocumentEditor>, cx: &mut VisualTestContext| {
        view.update(cx, |v, cx| {
            v.contribution(cx)
                .items
                .iter()
                .find(|i| i.id == "html-folder-access")
                .map(|i| i.kind.clone())
        })
    };
    // The page waits for the answer; "Don't allow" is the default.
    cx.run_until_parked();
    assert_eq!(
        cx.pending_prompt().map(|p| p.0),
        Some(t("editor.html.folderAccessTitle").to_owned())
    );
    cx.simulate_prompt_answer(t("editor.html.folderAccessAllow"));
    cx.run_until_parked();
    assert_eq!(toggle(&view, cx), Some(ItemKind::Toggle(true)));
    // Allowed, it runs offline: a clicked link only says why it stays.
    let link = r#"{"type":"link","href":"https://example.test/"}"#;
    let notice = view.update(cx, |v, cx| {
        v.surface
            .as_ref()
            .unwrap()
            .as_test_probe()
            .unwrap()
            .html_page_deliver(link, cx)
    });
    assert_eq!(
        notice.as_deref(),
        Some(t("editor.html.linkFailure.offline"))
    );
    assert_eq!(cx.opened_url(), None);
    // The pane menu stops it; the page runs as any other and its link opens.
    view.update_in(cx, |v, w, cx| {
        v.run_pane_action(Action::Item("html-folder-access"), w, cx)
    });
    cx.run_until_parked();
    assert_eq!(toggle(&view, cx), Some(ItemKind::Toggle(false)));
    view.update(cx, |v, cx| {
        v.surface
            .as_ref()
            .unwrap()
            .as_test_probe()
            .unwrap()
            .html_page_deliver(link, cx)
    });
    assert_eq!(cx.opened_url().as_deref(), Some("https://example.test/"));
    // A file the Explorer has not loaded yet still opens; nothing there
    // says the linked file is missing.
    view.update(cx, |v, cx| {
        let index = crate::editor::navigation::ReferenceIndex::new(vec![]);
        v.surface.as_ref().unwrap().set_reference_context(
            Some(crate::editor::navigation::ReferenceContext {
                source: "site/tracker.html".into(),
                index: std::sync::Arc::new(index),
            }),
            cx,
        )
    });
    let follow = |view: &Entity<DocumentEditor>, cx: &mut VisualTestContext, href: &str| {
        let body = format!(r#"{{"type":"link","href":"{href}"}}"#);
        view.update(cx, |v, cx| {
            v.surface
                .as_ref()
                .unwrap()
                .as_test_probe()
                .unwrap()
                .html_page_deliver(&body, cx)
        });
        cx.run_until_parked();
        view.update(cx, |v, cx| {
            v.surface
                .as_ref()
                .unwrap()
                .as_test_probe()
                .unwrap()
                .html_page_deliver("{}", cx)
        })
    };
    follow(&view, cx, "tasks.md");
    assert!(messages.borrow().iter().any(|m| matches!(
        m,
        ClientMessage::OpenPaths { paths } if paths == &vec!["site/tasks.md".to_string()]
    )));
    assert_eq!(
        follow(&view, cx, "gone.md").as_deref(),
        Some(t("editor.html.linkFailure.missing"))
    );
    // Declined, the same page is not asked again; once allowed, an edit
    // to it asks again, saying it changed.
    view.update_in(cx, |v, w, cx| {
        v.run_pane_action(Action::Item("html-folder-access"), w, cx)
    });
    cx.run_until_parked();
    assert!(!cx.has_pending_prompt());
    assert_eq!(toggle(&view, cx), Some(ItemKind::Toggle(true)));
    view.update_in(cx, |v, w, cx| {
        v.surface
            .as_ref()
            .unwrap()
            .replace_text(&page.replace("x</a>", "y</a>"), w, cx)
    });
    cx.run_until_parked();
    assert_eq!(
        cx.pending_prompt().map(|p| p.0),
        Some(t("editor.html.folderAccessChangedTitle").to_owned())
    );
    cx.simulate_prompt_answer(t("editor.html.folderAccessDecline"));
    cx.run_until_parked();
    assert_eq!(toggle(&view, cx), Some(ItemKind::Toggle(false)));
}

#[gpui::test]
fn a_new_extension_moves_the_working_copy_to_its_viewer(cx: &mut TestAppContext) {
    let (view, messages, cx) = setup(cx, "notes/draft.txt", "# Title\n");
    let code = view.update(cx, |v, _| {
        v.surface
            .as_ref()
            .unwrap()
            .as_test_probe()
            .unwrap()
            .code_editor()
            .unwrap()
    });
    view.update_in(cx, |v, w, cx| {
        assert!(
            v.surface
                .as_ref()
                .unwrap()
                .edit_utf16(&[(8..8, "more\n".into())], w, cx)
        );
    });
    cx.run_until_parked();
    // Same viewer (plain text to TypeScript): surface and history stay.
    view.update_in(cx, |v, w, cx| {
        v.receive(
            &HostMessage::Rebind {
                id: "doc-1".into(),
                name: "notes/draft.ts".into(),
                resource: None,
            },
            w,
            cx,
        );
    });
    let same = view.update(cx, |v, _| {
        v.surface
            .as_ref()
            .unwrap()
            .as_test_probe()
            .unwrap()
            .code_editor()
            .unwrap()
    });
    assert_eq!(same.entity_id(), code.entity_id());
    // Markdown: its own viewer over the unsaved text, still dirty.
    view.update_in(cx, |v, w, cx| {
        v.receive(
            &HostMessage::Rebind {
                id: "doc-1".into(),
                name: "notes/draft.md".into(),
                resource: None,
            },
            w,
            cx,
        );
    });
    cx.run_until_parked();
    view.update(cx, |v, cx| {
        assert_eq!(v.session.as_ref().unwrap().viewer.id, "markdown");
        assert_eq!(v.session.as_ref().unwrap().name, "draft.md");
        assert_eq!(v.text(cx).as_deref(), Some("# Title\nmore\n"));
        assert_eq!(v.session.as_ref().unwrap().baseline, "# Title\n");
    });
    assert!(
        messages
            .borrow()
            .iter()
            .any(|m| matches!(m, ClientMessage::Dirty { dirty: true, .. }))
    );
}

#[gpui::test]
fn rebind_to_json_viewer_normalizes_display_and_preserves_raw_until_edited(
    cx: &mut TestAppContext,
) {
    let raw = r#"{"a":1,"b":true}"#;
    let (view, _, cx) = setup(cx, "notes/raw.txt", raw);
    view.update_in(cx, |v, w, cx| {
        v.receive(
            &HostMessage::Rebind {
                id: "doc-1".into(),
                name: "notes/raw.json".into(),
                resource: None,
            },
            w,
            cx,
        );
    });
    cx.run_until_parked();
    view.update(cx, |v, cx| {
        assert_eq!(v.session.as_ref().unwrap().viewer.id, "json");
        assert_eq!(
            v.surface.as_ref().unwrap().text(cx).as_deref(),
            Some("{\n  \"a\": 1,\n  \"b\": true\n}")
        );
        // Untouched after rebind: logical snapshot remains compact raw text.
        assert_eq!(v.text(cx).as_deref(), Some(raw));
    });
}

#[gpui::test]
fn mixed_line_ending_policy_freezes_editor_shows_banner_and_emits_normalize(
    cx: &mut TestAppContext,
) {
    use gpui::EntityInputHandler;
    let (view, messages, cx) = setup(cx, "notes/mixed.md", "one\ntwo\n");
    view.update_in(cx, |v, w, cx| {
        v.receive(
            &HostMessage::Policy {
                id: "doc-1".into(),
                lossy_readonly: false,
                requires_line_ending_normalization: true,
            },
            w,
            cx,
        );
    });
    cx.run_until_parked();
    assert!(cx.debug_bounds("document-readonly-banner").is_some());
    let btn_bounds = cx
        .debug_bounds("normalize-line-endings-button")
        .expect("Normalize line endings button visible");
    // Typing while read-only is blocked.
    let editor = view.update(cx, |v, _| {
        v.surface
            .as_ref()
            .and_then(|s| s.as_test_probe())
            .and_then(|p| p.editor_view())
            .unwrap()
    });
    editor.update_in(cx, |e, w, cx| {
        e.replace_text_in_range(None, "blocked", w, cx);
    });
    view.update(cx, |v, cx| {
        assert_eq!(v.text(cx).as_deref(), Some("one\ntwo\n"))
    });
    // Clicking "Normalize line endings and edit" emits ClientMessage::NormalizeLineEndings.
    cx.simulate_click(btn_bounds.center(), gpui::Modifiers::none());
    cx.run_until_parked();
    assert!(
        messages
            .borrow()
            .iter()
            .any(|m| matches!(m, ClientMessage::NormalizeLineEndings { id } if id == "doc-1"))
    );
    // Receiving thawed Policy unlocks editing and hides the banner.
    view.update_in(cx, |v, w, cx| {
        v.receive(
            &HostMessage::Policy {
                id: "doc-1".into(),
                lossy_readonly: false,
                requires_line_ending_normalization: false,
            },
            w,
            cx,
        );
    });
    cx.run_until_parked();
    assert!(cx.debug_bounds("document-readonly-banner").is_none());
    editor.update_in(cx, |e, w, cx| {
        e.set_selection(crate::editor::text::selection::Selection::cursor(0), cx);
        e.replace_text_in_range(None, "ok ", w, cx);
    });
    cx.run_until_parked();
    view.update(cx, |v, cx| {
        assert_eq!(v.text(cx).as_deref(), Some("ok one\ntwo\n"))
    });
}

#[gpui::test]
fn external_minimal_diff_reconcile_is_undoable_to_prior_draft(cx: &mut TestAppContext) {
    use gpui::EntityInputHandler;
    let (view, _, cx) = setup(cx, "notes.md", "line1\nline2\n");
    let editor = view.update(cx, |v, _| {
        v.surface
            .as_ref()
            .and_then(|s| s.as_test_probe())
            .and_then(|p| p.editor_view())
            .unwrap()
    });
    editor.update_in(cx, |e, w, cx| {
        e.set_selection(crate::editor::text::selection::Selection::cursor(0), cx);
        e.replace_text_in_range(None, "mine ", w, cx);
    });
    cx.run_until_parked();
    view.update(cx, |v, cx| {
        assert_eq!(v.text(cx).as_deref(), Some("mine line1\nline2\n"));
    });
    // Disk overwrite arrives via HostMessage::Open { external: true }.
    view.update_in(cx, |v, w, cx| {
        v.receive(
            &HostMessage::Open {
                id: "doc-1".into(),
                name: "notes.md".into(),
                text: "disk line1\nline2\n".into(),
                revision: 0,
                external: true,
            },
            w,
            cx,
        );
    });
    cx.run_until_parked();
    view.update(cx, |v, cx| {
        assert_eq!(v.text(cx).as_deref(), Some("disk line1\nline2\n"));
    });
    // Pressing Undo (`HostMessage::History { redo: false }`) restores "mine line1\nline2\n"!
    view.update_in(cx, |v, w, cx| {
        v.receive(
            &HostMessage::History {
                id: "doc-1".into(),
                redo: false,
            },
            w,
            cx,
        );
    });
    cx.run_until_parked();
    view.update(cx, |v, cx| {
        assert_eq!(v.text(cx).as_deref(), Some("mine line1\nline2\n"));
    });
}

#[gpui::test]
fn rg02_rg03_oversized_opens_in_pane_card_and_large_text_locks_readonly_banner(
    cx: &mut TestAppContext,
) {
    use gpui::EntityInputHandler;
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
    std::fs::write(root.join("giant.pdf"), b"%PDF-1.7\n").unwrap();
    let ws = crate::workspace::Workspace::open(&root).unwrap();

    // 1. Local oversized file shows Open in Default App + Reveal in Finder (`RG-02`).
    let (view, _, cx) = setup_with(cx, "doc-over", Some(ws), "notes.md", "hi");
    view.update_in(cx, |v, w, cx| {
        v.receive(
            &HostMessage::Oversized {
                id: "over-local".into(),
                name: "giant.pdf".into(),
                size_bytes: 700 * 1024 * 1024,
                limit_bytes: 512 * 1024 * 1024,
                can_reveal_in_finder: true,
            },
            w,
            cx,
        );
    });
    cx.run_until_parked();
    view.read_with(cx, |v, cx| {
        let probe = v
            .surface
            .as_ref()
            .unwrap()
            .as_test_probe()
            .unwrap()
            .special_surface(cx)
            .unwrap();
        assert_eq!(probe.kind, "oversized");
        assert_eq!(probe.size_bytes, Some(700 * 1024 * 1024));
        assert!(probe.can_open_default_app);
        assert!(probe.can_reveal_in_finder);
    });

    // 2. Cloud oversized file omits Reveal in Finder (`RG-02`).
    let cloud_ws = crate::workspace::Workspace::from_provider(std::sync::Arc::new(
        crate::workspace::testing::Memory::new("memory://cloud/proj/"),
    ))
    .unwrap();
    view.update_in(cx, |v, w, cx| {
        v.set_workspace(Some(cloud_ws));
        v.receive(
            &HostMessage::Context {
                id: "over-cloud".into(),
                context: crate::editor::registry::DocumentContext {
                    source_kind: crate::editor::registry::SourceKind::Cloud,
                    ..Default::default()
                },
            },
            w,
            cx,
        );
        v.receive(
            &HostMessage::Oversized {
                id: "over-cloud".into(),
                name: "cloud-video.mp4".into(),
                size_bytes: 3 * 1024 * 1024 * 1024,
                limit_bytes: 2 * 1024 * 1024 * 1024,
                can_reveal_in_finder: false,
            },
            w,
            cx,
        );
    });
    view.read_with(cx, |v, cx| {
        let probe = v
            .surface
            .as_ref()
            .unwrap()
            .as_test_probe()
            .unwrap()
            .special_surface(cx)
            .unwrap();
        assert_eq!(probe.kind, "oversized");
        assert!(!probe.can_open_default_app);
        assert!(!probe.can_reveal_in_finder);
    });

    // 3. Large text within 64 MiB opens read-only with explanation banner (`RG-03`).
    view.update_in(cx, |v, w, cx| {
        v.set_workspace(None);
        v.receive(
            &HostMessage::Open {
                id: "large-txt".into(),
                name: "trace.md".into(),
                text: "bounded read-only log\n".into(),
                revision: 0,
                external: false,
            },
            w,
            cx,
        );
        v.receive(
            &HostMessage::ReadOnlyLarge {
                id: "large-txt".into(),
                size_bytes: 20 * 1024 * 1024,
                edit_limit_bytes: 16 * 1024 * 1024,
            },
            w,
            cx,
        );
    });
    cx.run_until_parked();
    cx.update(|w, cx| {
        w.draw(cx).clear(cx);
    });
    assert!(cx.debug_bounds("document-readonly-banner").is_some());
    let ed = view.update(cx, |v, _| {
        assert!(v.is_read_only_large());
        v.surface
            .as_ref()
            .unwrap()
            .as_test_probe()
            .unwrap()
            .editor_view()
            .unwrap()
    });
    ed.update_in(cx, |e, w, cx| {
        e.replace_text_in_range(None, "blocked edit", w, cx);
    });
    view.read_with(cx, |v, cx| {
        assert_eq!(v.text(cx).as_deref(), Some("bounded read-only log\n"));
    });
}

/// `viewerHost` #0: a document no viewer renders stays on the honest preset
/// placeholder. It names its kind ("Binary file · GLB"), shows the name only
/// beside a preview image and gives it to assistive technology as a status;
/// with no Viewer Pack installed there is nothing to install or route to.
#[gpui::test]
fn an_unknown_document_stays_on_the_honest_placeholder(cx: &mut TestAppContext) {
    let (view, _, cx) = setup(cx, "notes.md", "# hi\n");
    view.update_in(cx, |v, w, cx| {
        v.receive(
            &HostMessage::Context {
                id: "glb".into(),
                context: crate::editor::registry::DocumentContext {
                    source_kind: crate::editor::registry::SourceKind::Local,
                    ..Default::default()
                },
            },
            w,
            cx,
        );
        v.receive(
            &HostMessage::OpenResource {
                id: "glb".into(),
                name: "assets/scene.glb".into(),
                path: crate::workspace::testing::preview("scene.glb"),
            },
            w,
            cx,
        );
    });
    cx.run_until_parked();
    view.read_with(cx, |v, cx| {
        assert_eq!(
            v.session.as_ref().unwrap().viewer.id,
            "document-placeholder"
        );
        let probe = v
            .surface
            .as_ref()
            .unwrap()
            .as_test_probe()
            .unwrap()
            .special_surface(cx)
            .unwrap();
        assert_eq!(probe.kind, "placeholder");
        assert!(
            probe.detail.starts_with("Binary file · GLB"),
            "{}",
            probe.detail
        );
        assert!(!probe.detail.contains("scene.glb"), "{}", probe.detail);
    });
    // The name is read out, not drawn.
    cx.update(|w, _| {
        use gpui_kit::test::TestQueryExt;
        let status: Vec<_> = w
            .find_all_by_role(gpui::Role::Status)
            .into_iter()
            .filter_map(|element| element.label().map(str::to_owned))
            .collect();
        assert_eq!(status, ["scene.glb: preview unavailable"]);
    });
}

#[gpui::test]
fn rg10_rg11_instance_context_drops_on_close_and_cloud_source_blocks_external_packs(
    cx: &mut TestAppContext,
) {
    use crate::editor::registry::{
        DocumentAssets, DocumentContext, SourceKind,
        packs::{ExtensionHost, Snapshot, route::tests::pack},
    };
    let (view, _, cx) = setup(cx, "notes.md", "# hi\n");

    let reader_arc: crate::editor::registry::AssetReader =
        std::sync::Arc::new(|_| Some(vec![1, 2, 3]));
    assert_eq!(std::sync::Arc::strong_count(&reader_arc), 1);

    let ctx_msg = HostMessage::Context {
        id: "ctx-doc".into(),
        context: DocumentContext {
            folder: None,
            web_source: None,
            assets: Some(DocumentAssets {
                workspace: "memory://cloud/ws/".into(),
                document: "sub/doc.md".into(),
                read: reader_arc.clone(),
            }),
            source_kind: SourceKind::Cloud,
            sniffed_format: None,
            models: Default::default(),
        },
    };

    view.update_in(cx, |v, w, cx| {
        v.receive(&ctx_msg, w, cx);
        v.receive(
            &HostMessage::Open {
                id: "ctx-doc".into(),
                name: "sub/doc.md".into(),
                text: "![img](a.png)\n".into(),
                revision: 0,
                external: false,
            },
            w,
            cx,
        );
    });
    drop(ctx_msg);
    // Held by active_context + MarkdownExtension on the open surface (> 1).
    assert!(std::sync::Arc::strong_count(&reader_arc) >= 2);

    // Closing the document (`HostMessage::Clear`) deterministically drops all references!
    view.update_in(cx, |v, w, cx| {
        v.receive(&HostMessage::Clear, w, cx);
    });
    cx.run_until_parked();
    assert_eq!(
        std::sync::Arc::strong_count(&reader_arc),
        1,
        "RG-10: closing surface must release per-instance DocumentAssets Arc"
    );

    // RG-11: Cloud documents carry SourceKind::Cloud and fail closed for external Viewer Packs!
    PACK_SURFACES.with(|s| s.borrow_mut().clear());
    let cloud_ws = crate::workspace::Workspace::from_provider(std::sync::Arc::new(
        crate::workspace::testing::Memory::new("memory://cloud/packs/"),
    ))
    .unwrap();
    let cloud_res = cloud_ws
        .resource(std::path::Path::new("scene.glb"))
        .unwrap();
    view.update_in(cx, |v, w, cx| {
        v.set_workspace(Some(cloud_ws));
        v.set_extension_host(Some(ExtensionHost {
            snapshot: Snapshot {
                sequence: 1,
                contributions: vec![pack("test.glb", &[".glb"], &[])],
            },
            surface: Some(|request, pack, _, _| {
                PACK_SURFACES.with(|s| {
                    s.borrow_mut()
                        .push(format!("{}:{}", pack.plugin_id, request.name))
                });
                Box::new(PackProbe)
            }),
        }));
        v.receive(
            &HostMessage::OpenResource {
                id: "cloud-glb".into(),
                name: "scene.glb".into(),
                path: cloud_res,
            },
            w,
            cx,
        );
    });
    PACK_SURFACES.with(|s| {
        assert!(
            s.borrow().is_empty(),
            "RG-11: Cloud document must NOT activate external Viewer Pack"
        );
    });
    // It stays on the honest preset placeholder instead.
    view.update(cx, |v, _| {
        assert_eq!(
            v.session.as_ref().unwrap().viewer.id,
            "document-placeholder"
        )
    });
}

struct PanickingViewer {
    text: RefCell<String>,
    events: RefCell<Option<crate::editor::registry::SurfaceEvents>>,
    panic_on_render: std::cell::Cell<bool>,
}

impl crate::editor::registry::ViewerSurface for PanickingViewer {
    fn element(&self) -> gpui::AnyElement {
        use gpui::prelude::*;
        if self.panic_on_render.get() {
            panic!("simulated render explosion");
        }
        gpui::div().size_full().into_any_element()
    }
    fn subscribe(
        &self,
        events: crate::editor::registry::SurfaceEvents,
        _cx: &mut gpui::App,
    ) -> Option<gpui::Subscription> {
        *self.events.borrow_mut() = Some(events);
        None
    }
    fn text(&self, _: &gpui::App) -> Option<String> {
        Some(self.text.borrow().clone())
    }
    fn edit_utf16(
        &self,
        edits: &[(std::ops::Range<usize>, String)],
        _: &mut gpui::Window,
        cx: &mut gpui::App,
    ) -> bool {
        if let Some((_, replacement)) = edits.first() {
            *self.text.borrow_mut() = replacement.clone();
            if let Some(cb) = self.events.borrow().as_ref() {
                cb(crate::editor::registry::SurfaceEvent::Changed, cx);
            }
            return true;
        }
        false
    }
    fn command(
        &self,
        cmd: crate::editor::registry::HostCommand,
        _: &mut gpui::Window,
        _: &mut gpui::App,
    ) {
        if cmd == crate::editor::registry::HostCommand::Source {
            panic!("simulated viewer command panic");
        }
    }
}

fn panicking_factory(
    request: &crate::editor::registry::SurfaceRequest,
    _: &mut gpui::Window,
    _: &mut gpui::App,
) -> Box<dyn crate::editor::registry::ViewerSurface> {
    let initial = match request.input {
        crate::editor::registry::SurfaceInput::Text(t) => t.to_owned(),
        _ => String::new(),
    };
    Box::new(PanickingViewer {
        text: RefCell::new(initial),
        events: RefCell::new(None),
        panic_on_render: std::cell::Cell::new(false),
    })
}

#[gpui::test]
fn rg23_panicking_viewer_surface_degrades_only_its_pane_and_preserves_unsaved_working_copy(
    cx: &mut TestAppContext,
) {
    use crate::documents::{Documents, Intent};
    use crate::wake::Wake;

    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
    std::fs::write(root.join("crashy.txt"), "baseline\n").unwrap();
    std::fs::write(root.join("healthy.md"), "# Healthy Pane\n").unwrap();
    let ws = crate::workspace::Workspace::open(&root).unwrap();

    let wake = Wake::default();
    let mut docs = Documents::in_workspace(ws.clone());
    docs.begin(Intent::OpenFile("crashy.txt".into()), &wake);
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    while docs.document.is_none() {
        docs.poll(&wake);
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(std::time::Duration::from_millis(5));
    }

    let (healthy_pane, _, cx) = setup_with(
        cx,
        "healthy-1",
        Some(ws.clone()),
        "healthy.md",
        "# Healthy Pane\n",
    );
    let pane = cx.update(|_, cx| {
        use gpui::AppContext as _;
        cx.new(|cx| {
            let mut host = DocumentEditor::new(cx);
            host.workbench = true;
            host.set_workspace(Some(ws));
            host.set_test_surface_factory(Some(panicking_factory));
            host
        })
    });
    let client_events: Rc<RefCell<Vec<ClientMessage>>> = Rc::default();
    let sink = client_events.clone();
    cx.update(|_, cx| {
        cx.subscribe(&pane, move |_, msg: &ClientMessage, _| {
            sink.borrow_mut().push(msg.clone());
        })
        .detach();
    });

    // Deliver initial open messages from Documents to `pane`.
    let outgoing = std::mem::take(&mut docs.outgoing);
    pane.update_in(cx, |p, w, cx| {
        for msg in &outgoing {
            for reply in p.receive(msg, w, cx) {
                docs.client(reply, &wake);
            }
        }
    });

    // Make an unsaved edit in `pane` BEFORE triggering the panic!
    pane.update_in(cx, |p, w, cx| {
        assert!(p.surface.as_ref().unwrap().edit_utf16(
            &[(0..9, "unsaved precious draft\n".into())],
            w,
            cx
        ));
    });
    cx.run_until_parked();
    for ev in client_events.borrow_mut().drain(..) {
        docs.client(ev, &wake);
    }
    assert!(docs.dirty);

    // Trigger a panic inside `PanickingViewer::command(HostCommand::Source)`.
    pane.update_in(cx, |p, w, cx| {
        p.command(crate::editor::registry::HostCommand::Source, w, cx);
    });
    cx.run_until_parked();

    // 1. `pane` degraded to FaultedSurface with Switch to Plain Text + Open in Default App.
    pane.read_with(cx, |p, cx| {
        assert!(p.is_faulted());
        let probe = p
            .surface
            .as_ref()
            .unwrap()
            .as_test_probe()
            .unwrap()
            .special_surface(cx)
            .unwrap();
        assert_eq!(probe.kind, "faulted");
        assert!(probe.can_switch_plain_text);
        assert!(probe.can_open_default_app);
        assert!(probe.detail.contains("simulated viewer command panic"));
    });

    // 2. Sibling `healthy_pane` is completely unaffected!
    healthy_pane.read_with(cx, |h, cx| {
        assert!(!h.is_faulted());
        assert_eq!(h.text(cx).as_deref(), Some("# Healthy Pane\n"));
    });

    // 3. `Documents` still snapshots and saves the unsaved draft from the faulted pane!
    docs.begin(Intent::Save, &wake);
    let snap_msgs = std::mem::take(&mut docs.outgoing);
    pane.update_in(cx, |p, w, cx| {
        for msg in &snap_msgs {
            for reply in p.receive(msg, w, cx) {
                docs.client(reply, &wake);
            }
        }
    });
    let save_deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    while docs.dirty || docs.saving() {
        docs.poll(&wake);
        assert!(std::time::Instant::now() < save_deadline);
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    assert_eq!(
        std::fs::read_to_string(root.join("crashy.txt")).unwrap(),
        "unsaved precious draft\n"
    );

    // 4. Switching the faulted pane to Plain Text restores editing over the preserved draft!
    pane.update_in(cx, |p, w, cx| {
        p.switch_faulted_to_plain_text(w, cx);
    });
    pane.read_with(cx, |p, cx| {
        assert!(!p.is_faulted());
        assert_eq!(p.text(cx).as_deref(), Some("unsaved precious draft\n"));
    });
}
