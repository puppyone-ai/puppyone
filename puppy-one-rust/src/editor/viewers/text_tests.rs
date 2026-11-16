use super::*;
use crate::editor::{
    registry::{self, EditorDocument, HostCommand, PaneItemId, SourceKind, SurfaceInput},
    view::style,
};
use core::prelude::v1::test;

struct Host {
    surface: Box<dyn ViewerSurface>,
    _subscription: Subscription,
}
impl Render for Host {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        self.surface.element()
    }
}
fn setup<'a>(
    cx: &'a mut TestAppContext,
    text: &str,
) -> (Entity<Host>, Rc<Cell<usize>>, &'a mut VisualTestContext) {
    cx.update(|cx| {
        gpui_kit::init(cx);
        crate::ui::ime::init(cx);
        crate::editor::view::bind_keys(cx);
        cx.text_system().add_fonts(style::font_bytes()).unwrap();
    });
    let text = text.to_owned();
    let changes = Rc::new(Cell::new(0));
    let count = changes.clone();
    let (host, cx) = cx.add_window_view(move |w, cx| {
        let surface = open_markdown(
            &SurfaceRequest {
                id: "paired",
                name: "note.md",
                input: SurfaceInput::Text(&text),
                format: registry::resolve(&EditorDocument::local("note.md")).format,
                resolved_extension: None,
                dark: true,
                scale: Scale::Medium,
                workspace: None,
                file_mode: true,
                folder: None,
                web_source: None,
                assets: None,
                references: None,
                source_kind: SourceKind::Local,
            },
            w,
            cx,
        );
        let subscription = surface
            .subscribe(
                Rc::new(move |event, _| {
                    if matches!(event, SurfaceEvent::Changed) {
                        count.set(count.get() + 1);
                    }
                }),
                cx,
            )
            .unwrap();
        surface.command(HostCommand::Source, w, cx);
        Host {
            surface,
            _subscription: subscription,
        }
    });
    draw(cx);
    (host, changes, cx)
}
fn draw(cx: &mut VisualTestContext) {
    cx.run_until_parked();
    cx.update(|w, cx| {
        let _ = w.draw(cx);
    });
}
fn assert_text(host: &Entity<Host>, text: &str, cx: &mut VisualTestContext) {
    host.read_with(cx, |h, cx| {
        assert_eq!(h.surface.text(cx).as_deref(), Some(text));
        let source = h.surface.as_test_probe().unwrap().code_editor().unwrap();
        assert_eq!(source.read(cx).field.read(cx).value().to_string(), text);
    });
}

/// TS codeMirrorFollower + documentSourcePanel: both views share history,
/// including when the page is read-only and the source remains editable.
#[gpui::test]
fn source_and_page_share_history_across_focus_changes_and_do_not_echo_edits(
    cx: &mut TestAppContext,
) {
    let (host, count, cx) = setup(cx, "");
    host.update_in(cx, |h, w, cx| {
        h.surface
            .as_test_probe()
            .unwrap()
            .code_editor()
            .unwrap()
            .update(cx, |v, cx| v.replace_text_in_range(None, "source", w, cx));
    });
    draw(cx);
    assert_text(&host, "source", cx);
    assert_eq!(count.get(), 1);
    cx.simulate_keystrokes("cmd-z");
    draw(cx);
    assert_text(&host, "", cx);
    cx.simulate_keystrokes("cmd-shift-z");
    draw(cx);
    assert_text(&host, "source", cx);
    host.update_in(cx, |h, w, cx| {
        h.surface.pane_item(PaneItemId::DocumentEditing, w, cx);
        h.surface
            .as_test_probe()
            .unwrap()
            .editor_view()
            .unwrap()
            .update(cx, |v, cx| v.focus(w, cx));
    });
    draw(cx);
    // Undo in the page must undo the earlier source edit, not an independent copy.
    cx.simulate_keystrokes("cmd-z");
    draw(cx);
    assert_text(&host, "", cx);
    cx.simulate_keystrokes("cmd-shift-z");
    draw(cx);
    assert_text(&host, "source", cx);
    host.update_in(cx, |h, w, cx| h.surface.command(HostCommand::Undo, w, cx));
    draw(cx);
    assert_text(&host, "", cx);
    // A new edit in either view retires the one shared redo branch.
    cx.simulate_input("page");
    draw(cx);
    host.update_in(cx, |h, w, cx| h.surface.command(HostCommand::Redo, w, cx));
    draw(cx);
    assert_text(&host, "page", cx);
}

#[gpui::test]
fn source_pair_preserves_interleaved_edits_and_respects_storage_and_input_gates(
    cx: &mut TestAppContext,
) {
    let (host, count, cx) = setup(cx, "");
    host.update_in(cx, |h, w, cx| {
        h.surface.pane_item(PaneItemId::DocumentEditing, w, cx)
    });
    let mut expected = String::new();
    for index in 0..50 {
        let insert = (index % 10).to_string();
        host.update_in(cx, |h, w, cx| {
            let at = expected.encode_utf16().count();
            if index % 2 == 0 {
                h.surface
                    .as_test_probe()
                    .unwrap()
                    .code_editor()
                    .unwrap()
                    .update(cx, |v, cx| {
                        v.replace_text_in_range(Some(at..at), &insert, w, cx)
                    });
            } else {
                h.surface
                    .as_test_probe()
                    .unwrap()
                    .editor_view()
                    .unwrap()
                    .update(cx, |v, cx| {
                        v.replace_text_in_range(Some(at..at), &insert, w, cx)
                    });
            }
        });
        expected.push_str(&insert);
        draw(cx);
        assert_text(&host, &expected, cx);
    }
    assert_eq!(
        count.get(),
        50,
        "one document change per input, without echoes"
    );
    host.update_in(cx, |h, w, cx| {
        h.surface.apply(true, true, Scale::Medium, w, cx);
        h.surface
            .as_test_probe()
            .unwrap()
            .code_editor()
            .unwrap()
            .update(cx, |v, cx| v.replace_text_in_range(None, "blocked", w, cx));
        h.surface.undo(false, w, cx);
    });
    draw(cx);
    assert_text(&host, &expected, cx);
    assert_eq!(count.get(), 50);
    // DP-03: external storage replacement records a sealed undoable step
    // rather than wiping history, so `undo` restores pre-adoption content and
    // `redo` re-applies the external content!
    host.update_in(cx, |h, w, cx| {
        h.surface.apply(false, true, Scale::Medium, w, cx);
        h.surface.replace_text("from storage", w, cx);
    });
    draw(cx);
    assert_text(&host, "from storage", cx);
    host.update_in(cx, |h, w, cx| {
        h.surface.undo(false, w, cx);
    });
    draw(cx);
    assert_text(&host, &expected, cx);
    host.update_in(cx, |h, w, cx| {
        h.surface.undo(true, w, cx);
    });
    draw(cx);
    assert_text(&host, "from storage", cx);
}

#[gpui::test]
fn companion_sync_preserves_read_only_maps_cursor_and_records_minimal_delta_weight(
    cx: &mut TestAppContext,
) {
    let body = "alpha\n".repeat(400);
    let initial = format!("{body}target line\n{body}");
    let (host, _count, cx) = setup(cx, &initial);
    // Page starts read-only in file_mode while source panel is editable.
    let target_offset = initial.find("target line").unwrap() + "target ".len();
    host.update_in(cx, |h, _w, cx| {
        let view = h.surface.as_test_probe().unwrap().editor_view().unwrap();
        view.update(cx, |v, cx| {
            assert!(v.read_only());
            v.set_selection(
                crate::editor::text::selection::Selection::cursor(target_offset),
                cx,
            );
        });
    });
    // Insert "NEW\n" at the very top of the source pane (4 UTF-16 code units).
    host.update_in(cx, |h, w, cx| {
        h.surface
            .as_test_probe()
            .unwrap()
            .code_editor()
            .unwrap()
            .update(cx, |v, cx| {
                v.replace_text_in_range(Some(0..0), "NEW\n", w, cx)
            });
    });
    draw(cx);
    host.read_with(cx, |h, cx| {
        let view = h
            .surface
            .as_test_probe()
            .unwrap()
            .editor_view()
            .unwrap()
            .read(cx);
        assert!(view.read_only(), "sync_text must never drop read_only");
        assert_eq!(
            view.state().selection.head,
            target_offset + 4,
            "cursor must map across minimal-diff ChangeSet"
        );
        let weight = view.last_undo_weight().expect("undo step recorded");
        assert!(
            weight <= 16,
            "history weight ({weight}) must be proportional to edit delta, not doc len ({})",
            initial.len()
        );
    });
}
