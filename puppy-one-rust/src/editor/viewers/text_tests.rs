#![cfg(test)]

use super::*;
use crate::editor::{
    registry::{self, EditorDocument, HostCommand, PaneItemId, SourceKind, SurfaceInput},
    view::style,
};
use core::prelude::v1::test;

const DIALECT_TEXT: &str =
    "Intro\n\n<Tabs><Tab label=\"First\">one</Tab><Tab label=\"Second\">two</Tab></Tabs>\n";

fn dialect_surface<'a>(
    cx: &'a mut TestAppContext,
    workspace: Option<std::sync::Arc<crate::workspace::Workspace>>,
    name: &str,
) -> (Entity<Host>, &'a mut VisualTestContext) {
    cx.update(|cx| {
        gpui_kit::init(cx);
        crate::ui::ime::init(cx);
        crate::editor::view::bind_keys(cx);
        cx.text_system().add_fonts(style::font_bytes()).unwrap();
    });
    let name = name.to_owned();
    let (host, cx) = cx.add_window_view(move |window, cx| {
        let surface = open_markdown(
            &SurfaceRequest {
                id: "dialect",
                name: &name,
                input: SurfaceInput::Text(DIALECT_TEXT),
                format: registry::resolve(&EditorDocument::local("note.md")).format,
                resolved_extension: None,
                dark: false,
                scale: Scale::Medium,
                workspace,
                file_mode: false,
                folder: None,
                web_source: None,
                assets: None,
                references: None,
                source_kind: crate::editor::registry::SourceKind::Local,
            },
            window,
            cx,
        );
        let subscription = surface.subscribe(Rc::new(|_, _| {}), cx).unwrap();
        Host {
            surface,
            _subscription: subscription,
        }
    });
    draw(cx);
    (host, cx)
}

fn has_dialect_widget(host: &Entity<Host>, cx: &mut VisualTestContext) -> bool {
    host.read_with(cx, |h, cx| {
        h.surface
            .as_test_probe()
            .unwrap()
            .editor_view()
            .unwrap()
            .read(cx)
            .decorations()
            .blocks
            .iter()
            .any(|block| matches!(block, crate::editor::view::decoration::Block::Widget { .. }))
    })
}

#[gpui::test]
fn project_metadata_selects_the_markdown_composition_for_a_plain_md_file(cx: &mut TestAppContext) {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join(".ok")).unwrap();
    std::fs::write(dir.path().join(".ok/config.yml"), "version: 1\n").unwrap();
    let workspace = crate::workspace::Workspace::open(dir.path()).unwrap();
    let (host, cx) = dialect_surface(cx, Some(workspace), "note.md");
    assert!(
        has_dialect_widget(&host, cx),
        "project Markdown did not install the MDX composition"
    );
    host.read_with(cx, |h, cx| {
        assert_eq!(h.surface.text(cx).as_deref(), Some(DIALECT_TEXT))
    });
}

#[gpui::test]
fn explicit_provider_dialect_precedes_extensions_without_needing_a_local_root(
    cx: &mut TestAppContext,
) {
    use crate::formats::markdown::MarkdownDialect;
    use std::sync::{Arc, atomic::Ordering};
    for (dialect, name, expected) in [
        (MarkdownDialect::PuppyGfm, "note.mdx", false),
        (MarkdownDialect::OpenKnowledgeMdx, "note.md", true),
    ] {
        let mut provider = crate::workspace::testing::Memory::new("memory://dialect/project/");
        provider.markdown_dialect = Some(dialect);
        let provider = Arc::new(provider);
        let workspace = crate::workspace::Workspace::from_provider(provider.clone()).unwrap();
        assert!(workspace.local_root().is_none());
        let (host, cx) = dialect_surface(cx, Some(workspace), name);
        assert_eq!(has_dialect_widget(&host, cx), expected);
        host.update_in(cx, |h, _, cx| h.surface.rebind_name("renamed.MDX", cx));
        draw(cx);
        assert_eq!(has_dialect_widget(&host, cx), expected);
        assert_eq!(
            provider.calls.load(Ordering::SeqCst),
            0,
            "composition selection performed storage I/O"
        );
    }
}

#[gpui::test]
fn ordinary_markdown_contents_do_not_enable_components_but_mdx_paths_do(cx: &mut TestAppContext) {
    for (name, expected) in [
        ("note.md", false),
        ("note.mdx", true),
        ("note.MDX?revision=2#part", true),
    ] {
        let (host, cx) = dialect_surface(cx, None, name);
        assert_eq!(has_dialect_widget(&host, cx), expected, "{name}");
        host.read_with(cx, |h, cx| {
            assert_eq!(h.surface.text(cx).as_deref(), Some(DIALECT_TEXT))
        });
    }
}

#[gpui::test]
fn renaming_markdown_rebinds_its_composition_without_replacing_the_editor_or_history(
    cx: &mut TestAppContext,
) {
    let (host, cx) = dialect_surface(cx, None, "note.md");
    let editor = host.read_with(cx, |h, _| {
        h.surface
            .as_test_probe()
            .unwrap()
            .editor_view()
            .unwrap()
            .entity_id()
    });
    assert!(!has_dialect_widget(&host, cx));
    host.update_in(cx, |h, window, cx| {
        h.surface
            .as_test_probe()
            .unwrap()
            .editor_view()
            .unwrap()
            .update(cx, |view, cx| view.focus(window, cx));
    });
    cx.simulate_input("Prelude\n\n");
    host.update_in(cx, |h, _, cx| {
        h.surface.rebind_name("note.mdx", cx);
    });
    draw(cx);
    assert!(has_dialect_widget(&host, cx));
    host.read_with(cx, |h, cx| {
        assert_eq!(
            h.surface
                .as_test_probe()
                .unwrap()
                .editor_view()
                .unwrap()
                .entity_id(),
            editor
        );
        assert_eq!(
            h.surface.text(cx).unwrap(),
            format!("Prelude\n\n{DIALECT_TEXT}")
        );
    });
    host.update_in(cx, |h, window, cx| h.surface.undo(false, window, cx));
    draw(cx);
    host.read_with(cx, |h, cx| {
        assert_eq!(h.surface.text(cx).as_deref(), Some(DIALECT_TEXT))
    });
    host.update_in(cx, |h, _, cx| h.surface.rebind_name("note.md", cx));
    draw(cx);
    assert!(!has_dialect_widget(&host, cx));
}

struct Host {
    surface: Box<dyn ViewerSurface>,
    _subscription: Subscription,
}
impl Render for Host {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        self.surface.element()
    }
}
fn companion_surface(text: &str, w: &mut Window, cx: &mut App) -> Box<dyn ViewerSurface> {
    open_markdown(
        &SurfaceRequest {
            id: "paired",
            name: "note.md",
            input: SurfaceInput::Text(text),
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
    )
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
        let surface = companion_surface(&text, w, cx);
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
        assert_eq!(source.read(cx).text(cx), text);
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
    let (host, count, cx) = setup(cx, "界🦀");
    host.update_in(cx, |h, w, cx| {
        h.surface.pane_item(PaneItemId::DocumentEditing, w, cx)
    });
    let mut expected = String::from("界🦀");
    for index in 0..50 {
        let insert = (index % 10).to_string();
        let byte = expected
            .char_indices()
            .nth(expected.chars().count() / 2)
            .unwrap()
            .0;
        let at = expected[..byte].encode_utf16().count();
        host.update_in(cx, |h, w, cx| {
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
        expected.insert_str(byte, &insert);
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

#[path = "text_companion_tests.rs"]
mod companion;
