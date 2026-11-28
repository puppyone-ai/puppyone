//! Source-panel acceptance against the actual native page/source pair.
use super::*;
use core::prelude::v1::test;

#[gpui::test]
fn initial_source_matches_the_read_only_page_and_both_input_gates_are_independent(
    cx: &mut TestAppContext,
) {
    let (host, count, cx) = setup(cx, "# Plan\n");
    assert_text(&host, "# Plan\n", cx);
    assert_eq!(count.get(), 0);
    host.update_in(cx, |h, window, cx| {
        let probe = h.surface.as_test_probe().unwrap();
        let page = probe.editor_view().unwrap();
        assert!(page.read(cx).read_only());
        page.update(cx, |v, cx| {
            v.replace_text_in_range(Some(7..7), "blocked", window, cx)
        });
    });
    draw(cx);
    assert_text(&host, "# Plan\n", cx);
    assert_eq!(count.get(), 0);
    host.update_in(cx, |h, window, cx| {
        h.surface
            .as_test_probe()
            .unwrap()
            .code_editor()
            .unwrap()
            .update(cx, |v, cx| {
                v.replace_text_in_range(Some(7..7), "来自源码🦀", window, cx)
            });
    });
    draw(cx);
    let text = "# Plan\n来自源码🦀";
    assert_text(&host, text, cx);
    assert_eq!(count.get(), 1);
    host.update_in(cx, |h, window, cx| {
        h.surface.apply(true, true, Scale::Medium, window, cx);
        assert_eq!(
            h.surface
                .pane(cx)
                .toggles
                .iter()
                .map(|t| t.id)
                .collect::<Vec<_>>(),
            [DOCUMENT_SOURCE_PANEL_TOGGLE_ID]
        );
        h.surface
            .as_test_probe()
            .unwrap()
            .code_editor()
            .unwrap()
            .update(cx, |v, cx| {
                v.replace_text_in_range(Some(0..0), "blocked", window, cx)
            });
        h.surface.undo(false, window, cx);
    });
    draw(cx);
    assert_text(&host, text, cx);
    assert_eq!(count.get(), 1);
    host.update_in(cx, |h, window, cx| {
        h.surface.apply(false, true, Scale::Medium, window, cx);
        h.surface.pane_item(PaneItemId::DocumentEditing, window, cx);
        let page = h.surface.as_test_probe().unwrap().editor_view().unwrap();
        assert!(!page.read(cx).read_only());
        let at = text.encode_utf16().count();
        page.update(cx, |v, cx| {
            v.replace_text_in_range(Some(at..at), "\nFrom page.", window, cx)
        });
    });
    draw(cx);
    assert_text(&host, "# Plan\n来自源码🦀\nFrom page.", cx);
    assert_eq!(count.get(), 2);
}

#[gpui::test]
fn hiding_and_reopening_source_retains_its_identity_and_tracks_page_edits(cx: &mut TestAppContext) {
    let (host, count, cx) = setup(cx, "initial");
    let source = host.read_with(cx, |h, _| {
        h.surface.as_test_probe().unwrap().code_editor().unwrap()
    });
    host.update_in(cx, |h, window, cx| {
        let pane = h.surface.pane(cx);
        assert!(pane.segmented.is_none());
        assert_eq!(
            pane.toggles
                .iter()
                .map(|t| (t.id, t.checked))
                .collect::<Vec<_>>(),
            [
                (DOCUMENT_EDITING_TOGGLE_ID, false),
                (DOCUMENT_SOURCE_PANEL_TOGGLE_ID, true)
            ]
        );
        h.surface
            .pane_item(PaneItemId::DocumentSourcePanel, window, cx);
        h.surface.pane_item(PaneItemId::DocumentEditing, window, cx);
    });
    draw(cx);
    host.update_in(cx, |h, window, cx| {
        h.surface
            .as_test_probe()
            .unwrap()
            .editor_view()
            .unwrap()
            .update(cx, |v, cx| {
                v.replace_text_in_range(Some(7..7), " while hidden", window, cx)
            });
    });
    draw(cx);
    assert_text(&host, "initial while hidden", cx);
    assert_eq!(count.get(), 1);
    host.update_in(cx, |h, window, cx| {
        h.surface
            .pane_item(PaneItemId::DocumentSourcePanel, window, cx);
        assert_eq!(
            h.surface
                .as_test_probe()
                .unwrap()
                .code_editor()
                .unwrap()
                .entity_id(),
            source.entity_id()
        );
    });
    draw(cx);
    assert_text(&host, "initial while hidden", cx);
    assert_eq!(count.get(), 1, "view switches must not report text changes");
    host.update_in(cx, |h, window, cx| h.surface.undo(false, window, cx));
    draw(cx);
    assert_text(&host, "initial", cx);
    assert_eq!(count.get(), 2);
}

#[gpui::test]
fn disposing_a_pair_retires_both_subscriptions_and_releases_its_history_owner(
    cx: &mut TestAppContext,
) {
    let (host, count, cx) = setup(cx, "old");
    host.update_in(cx, |h, w, cx| {
        h.surface.pane_item(PaneItemId::DocumentEditing, w, cx)
    });
    let (page, source) = host.read_with(cx, |h, _| {
        let probe = h.surface.as_test_probe().unwrap();
        (probe.editor_view().unwrap(), probe.code_editor().unwrap())
    });
    let weak_page = page.downgrade();
    host.update_in(cx, |h, window, cx| {
        let replacement = companion_surface("replacement", window, cx);
        h._subscription = replacement.subscribe(Rc::new(|_, _| {}), cx).unwrap();
        h.surface = replacement;
        cx.notify();
    });
    draw(cx);
    page.update_in(cx, |v, w, cx| {
        v.replace_text_in_range(Some(3..3), " changed", w, cx)
    });
    draw(cx);
    assert_eq!(source.read_with(cx, |v, cx| v.text(cx)), "old");
    source.update_in(cx, |v, w, cx| v.history(false, w, cx));
    draw(cx);
    assert_eq!(
        page.read_with(cx, |v, _| v.committed_doc().clone()),
        crate::editor::text::buffer::Buffer::new("old changed"),
        "a detached source cannot undo the retired page"
    );
    source.update_in(cx, |v, w, cx| {
        v.replace_text_in_range(Some(3..3), " detached", w, cx)
    });
    draw(cx);
    assert_eq!(
        page.read_with(cx, |v, _| v.committed_doc().clone()),
        crate::editor::text::buffer::Buffer::new("old changed")
    );
    assert_text(&host, "replacement", cx);
    assert_eq!(
        count.get(),
        0,
        "retired subscriptions cannot publish changes"
    );
    drop(page);
    draw(cx);
    assert!(
        weak_page.upgrade().is_none(),
        "a retained source callback kept the retired page alive"
    );
    assert_eq!(source.read_with(cx, |v, cx| v.text(cx)), "old detached");
}
