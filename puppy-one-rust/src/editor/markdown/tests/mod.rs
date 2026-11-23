//! Markdown in a live `EditorView` (GPUI test platform): typing, two-layer
//! reveal (`TA-11`), first-class `InlineWidget`s (`TA-12`), incremental
//! `HeightMap` & `ParagraphCache` (`TA-13`), stable `BlockId` (`TA-14`),
//! incremental `Syntax` & `Plans` (`TA-31`, `TA-32`), full panic isolation
//! (`TA-33`), per-feature state across undo/redo (`TA-06`, `TA-40`), and
//! read-only transaction filtering (`TA-07`).
#[allow(unused_imports)]
use super::MarkdownExtension;
use crate::{
    editor::view::{EditorView, bind_keys, style},
    typography::Scale,
};
use gpui::{Entity, TestAppContext, VisualTestContext};

mod block_acceptance;
mod block_move_acceptance;
mod clipboard_acceptance;
mod code_isolation_acceptance;
mod composition_acceptance;
mod concurrent_edit_acceptance;
mod core_interaction_acceptance;
mod document_scope_acceptance;
mod editor_view_acceptance;
mod embed_runtime_acceptance;
mod html_acceptance;
mod html_fragment_targets_acceptance;
mod html_policy_acceptance;
mod html_presentation_acceptance;
mod html_run_acceptance;
mod inline_acceptance;
mod inline_html_acceptance;
mod inline_html_break_acceptance;
mod linked_image_acceptance;
mod math_acceptance;
mod mdx_acceptance;
mod media_isolation_acceptance;
mod projection_acceptance;
mod reference_refresh_acceptance;
mod remote_image_proxy_acceptance;
mod scale_and_resize_acceptance;
mod style_contracts;
mod svg_isolation_acceptance;
mod table_inline_acceptance;
mod table_interaction_acceptance;
mod table_media_acceptance;
mod viewport_stability;

mod pipeline_acceptance;

fn setup<'a>(
    cx: &'a mut TestAppContext,
    text: &str,
) -> (Entity<EditorView>, &'a mut VisualTestContext) {
    setup_with_focus(cx, text, true)
}

fn setup_with_focus<'a>(
    cx: &'a mut TestAppContext,
    text: &str,
    focused: bool,
) -> (Entity<EditorView>, &'a mut VisualTestContext) {
    cx.update(|cx| {
        if cx.try_global::<gpui_kit::component::Theme>().is_none() {
            gpui_kit::init(cx);
        }
        cx.text_system().add_fonts(style::font_bytes()).unwrap();
        bind_keys(cx);
    });
    let text = text.to_owned();
    let (view, cx) = cx.add_window_view(move |_, cx| {
        EditorView::new(
            &text,
            Box::new(MarkdownExtension::new(true, Scale::Medium)),
            cx,
        )
    });
    if focused {
        view.update_in(cx, |v, w, cx| v.focus(w, cx));
    }
    cx.run_until_parked();
    (view, cx)
}

fn hidden(view: &Entity<EditorView>, cx: &mut VisualTestContext) -> Vec<std::ops::Range<usize>> {
    cx.update(|w, cx| {
        w.draw(cx).clear(cx);
    });
    view.update(cx, |v, _| v.decorations().hidden.clone())
}

/// The lines each block of the frame shows, widgets as their line ranges.
fn blocks(view: &Entity<EditorView>, cx: &mut VisualTestContext) -> Vec<std::ops::Range<usize>> {
    cx.update(|w, cx| {
        w.draw(cx).clear(cx);
    });
    view.update(cx, |v, _| {
        v.decorations()
            .blocks
            .iter()
            .map(|b| match b {
                crate::editor::view::decoration::Block::Line { line, .. } => *line..*line + 1,
                crate::editor::view::decoration::Block::Widget { lines, .. } => lines.clone(),
            })
            .collect()
    })
}
