use super::*;
use crate::editor::{
    registry::{self, EditorDocument, SurfaceInput},
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
        surface.command("source", w, cx);
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
        let source = h.surface.code_editor().unwrap();
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
        h.surface.pane_item(DOCUMENT_EDITING_TOGGLE_ID, w, cx);
        h.surface
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
    host.update_in(cx, |h, w, cx| h.surface.command("undo", w, cx));
    draw(cx);
    assert_text(&host, "", cx);
    // A new edit in either view retires the one shared redo branch.
    cx.simulate_input("page");
    draw(cx);
    host.update_in(cx, |h, w, cx| h.surface.command("redo", w, cx));
    draw(cx);
    assert_text(&host, "page", cx);
}

#[gpui::test]
fn source_pair_preserves_interleaved_edits_and_respects_storage_and_input_gates(
    cx: &mut TestAppContext,
) {
    let (host, count, cx) = setup(cx, "");
    host.update_in(cx, |h, w, cx| {
        h.surface.pane_item(DOCUMENT_EDITING_TOGGLE_ID, w, cx)
    });
    let mut expected = String::new();
    for index in 0..50 {
        let insert = (index % 10).to_string();
        host.update_in(cx, |h, w, cx| {
            let at = expected.encode_utf16().count();
            if index % 2 == 0 {
                h.surface.code_editor().unwrap().update(cx, |v, cx| {
                    v.replace_text_in_range(Some(at..at), &insert, w, cx)
                });
            } else {
                h.surface.editor_view().unwrap().update(cx, |v, cx| {
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
            .code_editor()
            .unwrap()
            .update(cx, |v, cx| v.replace_text_in_range(None, "blocked", w, cx));
        h.surface.undo(false, w, cx);
    });
    draw(cx);
    assert_text(&host, &expected, cx);
    assert_eq!(count.get(), 50);
    host.update_in(cx, |h, w, cx| {
        h.surface.apply(false, true, Scale::Medium, w, cx);
        h.surface.replace_text("from storage", w, cx);
        h.surface.undo(false, w, cx);
    });
    draw(cx);
    assert_text(&host, "from storage", cx);
}
