//! A run filling its lines, drawn by the HTML surface in place of their text.
use super::super::{render::Surface, sanitize::Node};
use crate::editor::{
    markdown::{platform::sessions::measure, style::MarkdownTheme},
    registry::DocumentAssets,
    view::widget::{LineEmbed, WidgetCx},
};
use gpui::{prelude::*, *};
use std::{
    hash::{Hash, Hasher},
    ops::Range,
    path::Path,
    rc::Rc,
};

/// A run filling its lines, drawn by the HTML surface in place of their
/// text; a click outside its links and controls puts the caret on its edge,
/// which reveals its source.
pub(super) struct RunEmbed {
    pub range: Range<usize>,
    pub nodes: Vec<Node>,
    pub theme: MarkdownTheme,
    pub assets: Option<DocumentAssets>,
}

impl LineEmbed for RunEmbed {
    fn render(&self, cx: &mut WidgetCx) -> (AnyElement, f32) {
        let width = cx.width;
        let mut h = std::hash::DefaultHasher::new();
        (self.range.start, width.to_bits(), self.theme.dark).hash(&mut h);
        super::super::sanitize::hash_nodes(&self.nodes, &mut h);
        let key = h.finish();
        let block_id = cx.block_id;
        let estimate = self.theme.body.text.line_height_px();
        let height = measure::get(&mut cx.render.widget_states.borrow_mut(), block_id, key)
            .unwrap_or(estimate);
        let document = self
            .assets
            .as_ref()
            .map(|a| a.document.clone())
            .unwrap_or_default();
        let view = cx.render.view.clone();
        let content = Surface::new(
            &self.theme,
            Path::new(&document),
            self.assets.as_ref(),
            view.clone(),
            block_id,
            self.range.start,
            cx.render,
        )
        .render(&self.nodes, width);
        let states = Rc::clone(cx.render.widget_states);
        let caret = self.range.start;
        let element = div()
            .id(("md-html-run", self.range.start))
            .debug_selector(|| "md-html-run".into())
            .relative()
            .w(px(width))
            .h(px(height))
            .child(
                div()
                    .absolute()
                    .left_0()
                    .top_0()
                    .w(px(width))
                    .child(content)
                    .on_children_prepainted(move |bounds, window, _| {
                        let Some(b) = bounds.first() else { return };
                        if measure::record(
                            &mut states.borrow_mut(),
                            block_id,
                            key,
                            f32::from(b.size.height),
                        ) {
                            window.refresh();
                        }
                    }),
            )
            .on_mouse_down(MouseButton::Left, move |_, window, app| {
                let _ = view.update(app, |v, app| {
                    v.focus(window, app);
                    v.set_selection(
                        crate::editor::text::selection::Selection::cursor(caret),
                        app,
                    );
                });
            })
            .into_any_element();
        (element, height)
    }
}

/// A continuation line of a run drawn on its first line: it takes no room.
pub(super) struct Collapsed;

impl LineEmbed for Collapsed {
    fn render(&self, _: &mut WidgetCx) -> (AnyElement, f32) {
        (div().into_any_element(), 0.)
    }
}
