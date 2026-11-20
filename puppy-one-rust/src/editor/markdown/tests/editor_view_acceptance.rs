//! Pinned EditorView behavior, exercised through native input and painted widgets.
use super::setup;
use crate::editor::{
    markdown::MarkdownExtension,
    text::{
        change::ChangeSet,
        selection::Selection,
        state::{Transaction, UserEvent},
    },
    view::{EditorView, decoration::Block},
};
use gpui::{Entity, EntityInputHandler as _, Modifiers, TestAppContext, VisualTestContext};

fn draw(cx: &mut VisualTestContext) {
    cx.run_until_parked();
    cx.update(|w, cx| {
        w.draw(cx).clear(cx);
    });
}

fn widget_id(view: &Entity<EditorView>, cx: &VisualTestContext) -> Option<u64> {
    view.read_with(cx, |v, _| {
        v.decorations().blocks.iter().find_map(|b| match b {
            Block::Widget { id, .. } => Some(id.raw()),
            _ => None,
        })
    })
}

fn show_source(cx: &mut VisualTestContext) {
    let button = cx
        .debug_bounds("md-html-widget")
        .expect("native HTML source button");
    cx.simulate_click(button.center(), Modifiers::none());
    draw(cx);
}

#[gpui::test]
fn html_source_control_tracks_shifted_blocks_and_round_trips_canonical_edits(
    cx: &mut TestAppContext,
) {
    // Enough following blocks to exercise the incremental mapping path too.
    let initial =
        "intro\n\n<div>old</div>\n\noutro\n\nguard one\n\nguard two\n\nguard three\n\nguard four";
    let (view, visual) = setup(cx, initial);
    draw(visual);
    let original_id = widget_id(&view, visual).expect("HTML preview mounted");
    view.update(visual, |v, cx| {
        v.dispatch(
            Transaction::edit(
                ChangeSet::replace(0..0, "shifted\n"),
                Some(Selection::cursor(0)),
                UserEvent::Input,
            ),
            cx,
        );
    });
    draw(visual);
    assert_eq!(
        widget_id(&view, visual),
        Some(original_id),
        "prefix edits preserve native block identity"
    );
    show_source(visual);
    let current = format!("shifted\n{initial}");
    let start = current.find("<div>").unwrap();
    let end = start + "<div>old</div>".len();
    view.read_with(visual, |v, _| {
        assert_eq!(
            v.extension::<MarkdownExtension>()
                .unwrap()
                .preview
                .revealed_source,
            Some(start..end)
        );
        assert_eq!(v.state().selection, Selection::cursor(start + 1));
        assert_eq!(v.text(), current);
        assert_eq!(v.state().revision, 1, "showing source is not an edit");
        assert!(
            v.layout()
                .unwrap()
                .leaves
                .iter()
                .any(|l| l.entry.text.text.contains("<div>old</div>"))
        );
    });
    assert_eq!(widget_id(&view, visual), None);
    let old = current.find("old").unwrap();
    view.update(visual, |v, cx| {
        v.set_selection(Selection::range(old, old + 3), cx)
    });
    visual.simulate_input("edited");
    draw(visual);
    assert_eq!(
        widget_id(&view, visual),
        None,
        "editing must not steal source focus"
    );
    let edited_revision = view.read_with(visual, |v, _| {
        assert_eq!(v.text(), current.replace("old", "edited"));
        assert_eq!(
            v.extension::<MarkdownExtension>()
                .unwrap()
                .preview
                .revealed_source,
            Some(start..end + 3)
        );
        v.state().revision
    });
    view.update(visual, |v, cx| v.set_selection(Selection::cursor(0), cx));
    draw(visual);
    assert!(widget_id(&view, visual).is_some());
    view.read_with(visual, |v, _| {
        let markdown = v.extension::<MarkdownExtension>().unwrap();
        assert_eq!(markdown.preview.revealed_source, None);
        let cache = markdown.cache.borrow();
        let parsed = cache.parsed.as_ref().unwrap();
        let html = parsed
            .plans
            .iter()
            .filter_map(|p| {
                p.embed()?
                    .model::<crate::editor::markdown::features::html::HtmlBlock>()
            })
            .collect::<Vec<_>>();
        assert_eq!(html.len(), 1);
        assert_eq!(html[0].html, "<div>edited</div>");
        assert_eq!(v.text(), current.replace("old", "edited"));
        assert_eq!(
            v.state().revision,
            edited_revision,
            "restoring preview is not an edit"
        );
    });
}

#[gpui::test]
fn escape_collapses_revealed_html_source_without_editing_or_history(cx: &mut TestAppContext) {
    for read_only in [false, true] {
        let source = "<div>only block 中文</div>";
        let (view, visual) = setup(cx, source);
        view.update(visual, |v, cx| v.set_read_only(read_only, cx));
        draw(visual);
        show_source(visual);
        assert_eq!(widget_id(&view, visual), None);
        visual.simulate_keystrokes("escape");
        draw(visual);
        assert!(
            widget_id(&view, visual).is_some(),
            "Escape restores preview, including a document with only one block"
        );
        view.read_with(visual, |v, _| {
            assert_eq!(
                v.extension::<MarkdownExtension>()
                    .unwrap()
                    .preview
                    .revealed_source,
                None
            );
            assert_eq!(v.state().selection, Selection::cursor(source.len()));
            assert_eq!(v.text(), source);
            assert_eq!(v.state().revision, 0);
        });
        visual.simulate_keystrokes("escape cmd-z");
        view.read_with(visual, |v, _| {
            assert_eq!(v.text(), source);
            assert_eq!(v.state().revision, 0);
        });
    }
}

#[gpui::test]
fn markdown_ime_keeps_composed_text_and_neighbor_decorations_until_commit(cx: &mut TestAppContext) {
    let source = "Hello **world**\n\n# Neighbor";
    let (view, visual) = setup(cx, source);
    view.update_in(visual, |v, w, cx| {
        v.set_selection(Selection::cursor(8), cx);
        v.replace_and_mark_text_in_range(None, "あ", None, w, cx);
        assert!(v.composing());
    });
    draw(visual);
    view.read_with(visual, |v, _| {
        assert_eq!(v.text(), "Hello **あworld**\n\n# Neighbor");
        assert!(
            v.layout()
                .unwrap()
                .leaves
                .iter()
                .any(|l| l.entry.text.text.contains('あ'))
        );
        let heading = v.text().find("# Neighbor").unwrap();
        assert!(
            v.decorations().hidden.contains(&(heading..heading + 2)),
            "composition does not wipe unrelated preview decorations"
        );
    });
    view.update_in(visual, |v, w, cx| v.unmark_text(w, cx));
    draw(visual);
    view.read_with(visual, |v, _| {
        assert!(!v.composing());
        assert_eq!(v.text(), "Hello **あworld**\n\n# Neighbor");
    });
    visual.simulate_keystrokes("cmd-z");
    view.read_with(visual, |v, _| assert_eq!(v.text(), source));
}

#[gpui::test]
fn table_inline_html_keeps_author_color_and_text_through_the_shared_policy(
    cx: &mut TestAppContext,
) {
    let source =
        "| Status |\n| --- |\n| <span style=\"color: #B45309;\">screenshot</span> |\n\nafter";
    let (view, visual) = setup(cx, source);
    view.update(visual, |v, cx| {
        v.set_selection(Selection::cursor(source.len()), cx)
    });
    draw(visual);
    view.read_with(visual, |v, _| {
        let cell = v
            .layout()
            .unwrap()
            .leaves
            .iter()
            .find(|l| l.entry.text.text == "screenshot")
            .expect("rendered span text");
        assert!(
            cell.entry
                .text
                .marks
                .iter()
                .any(|(r, style)| r == &(0..10) && style.color == Some(0xb45309ff))
        );
        assert_eq!(v.text(), source);
        assert_eq!(v.state().revision, 0);
    });
}

#[gpui::test]
fn closing_native_markdown_releases_its_document_capability_and_view_identity(
    cx: &mut TestAppContext,
) {
    use crate::editor::{
        markdown::SetAssets, registry::DocumentAssets, view::extension::config_transaction,
    };
    use std::sync::Arc;
    let source = "- <span style=\"color: #B45309;\">screenshot</span>";
    let (view, visual) = setup(cx, source);
    use gpui::AppContext as _;
    let other = visual.cx.new(|cx| {
        EditorView::new(
            source,
            Box::new(MarkdownExtension::new(
                true,
                crate::typography::Scale::Medium,
            )),
            cx,
        )
    });
    assert_ne!(
        view.entity_id(),
        other.entity_id(),
        "each surface owns its identity"
    );
    drop(other);
    let capability = Arc::new(());
    let weak_capability = Arc::downgrade(&capability);
    view.update(visual, |v, cx| {
        v.dispatch(
            config_transaction(SetAssets(Some(DocumentAssets {
                workspace: "editor-view-lifecycle".into(),
                document: "note.md".into(),
                read: Arc::new(move |_| {
                    let _keep_alive = &capability;
                    None
                }),
            }))),
            cx,
        )
    });
    draw(visual);
    view.read_with(visual, |v, _| {
        assert!(v.layout().is_some());
        assert!(
            v.layout()
                .unwrap()
                .leaves
                .iter()
                .any(|l| l.entry.text.text.contains("screenshot"))
        );
        assert_eq!(v.text(), source);
    });
    let weak_view = view.downgrade();
    assert!(weak_capability.upgrade().is_some());
    visual.update(|w, _| w.remove_window());
    drop(view);
    visual.cx.update(|_| {});
    visual.run_until_parked();
    assert!(
        weak_view.upgrade().is_none(),
        "cached handlers must not keep a closed view alive"
    );
    assert!(
        weak_capability.upgrade().is_none(),
        "closing the surface drops its injected document capability"
    );
    visual.run_until_parked();
    assert!(weak_view.upgrade().is_none());
    assert!(weak_capability.upgrade().is_none());
}

#[test]
fn widget_sessions_release_only_the_replaced_or_unmounted_identity_once() {
    use crate::editor::{
        text::anchor::Anchor,
        view::widget::{BlockId, WidgetStateStore},
    };
    use std::{cell::RefCell, collections::HashSet, rc::Rc};
    struct Session(&'static str, Rc<RefCell<Vec<&'static str>>>);
    impl Drop for Session {
        fn drop(&mut self) {
            self.1.borrow_mut().push(self.0);
        }
    }
    let disposed = Rc::new(RefCell::new(Vec::new()));
    let first = BlockId::new(1, Anchor::after(0, 0));
    let other = BlockId::new(2, Anchor::after(0, 0));
    let mut store = WidgetStateStore::default();
    store.insert(first, Session("first mount", disposed.clone()));
    store.insert(other, Session("other identity", disposed.clone()));
    store.insert(first, Session("remount", disposed.clone()));
    assert_eq!(*disposed.borrow(), ["first mount"]);
    assert!(store.get::<Session>(other).is_some());
    store.retain_live(&HashSet::from([other]));
    assert_eq!(*disposed.borrow(), ["first mount", "remount"]);
    store.retain_live(&HashSet::from([other]));
    assert_eq!(
        *disposed.borrow(),
        ["first mount", "remount"],
        "unmount cleanup is idempotent"
    );
    drop(store);
    assert_eq!(
        *disposed.borrow(),
        ["first mount", "remount", "other identity"]
    );
}
