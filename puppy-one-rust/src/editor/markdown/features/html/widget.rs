//! `.cm-md-html-widget`: the rendered surface in `.cm-md-html-widget-content`
//! (the block radius and rings) with the toolbar's source toggle. The
//! surface lays itself out; its measured height is the block's from the
//! next frame on (until then, an estimate from its lines).
use super::{ID, ShowSource, dom::Node, render::Surface};
use crate::editor::{
    markdown::{
        shared::{ring, source_toggle::source_toggle},
        style::MarkdownTheme,
    },
    registry::DocumentAssets,
    view::{
        command::Command,
        widget::{BlockWidget, WidgetCx},
    },
};
use gpui::{prelude::*, *};
use std::{
    cell::RefCell,
    collections::HashMap,
    hash::{Hash, Hasher},
    ops::Range,
};

thread_local! {
    /// Measured surface heights, by block content and width.
    static HEIGHTS: RefCell<HashMap<u64, f32>> = RefCell::new(HashMap::new());
}

pub struct HtmlBlockWidget {
    pub range: Range<usize>,
    pub nodes: Vec<Node>,
    pub theme: MarkdownTheme,
    pub assets: Option<DocumentAssets>,
}

impl BlockWidget for HtmlBlockWidget {
    fn render(&self, cx: &mut WidgetCx) -> (AnyElement, f32) {
        let width = cx.width;
        let mut h = std::hash::DefaultHasher::new();
        (
            self.range.start,
            format!("{:?}", self.nodes),
            width.to_bits(),
        )
            .hash(&mut h);
        let key = h.finish();
        let lines = cx
            .render
            .doc
            .slice(self.range.clone())
            .lines()
            .count()
            .max(1);
        let estimate = lines as f32 * self.theme.body.text.line_height_px();
        let height = HEIGHTS
            .with(|m| m.borrow().get(&key).copied())
            .unwrap_or(estimate);
        let document = self
            .assets
            .as_ref()
            .map(|a| a.document.clone())
            .unwrap_or_default();
        let view = cx.render.view.clone();
        let content = Surface::new(
            &self.theme,
            self.assets.as_ref(),
            &document,
            view,
            self.range.start,
            cx.render,
        )
        .render(&self.nodes, width);
        let surface = div()
            .absolute()
            .left_0()
            .top_0()
            .w(px(width))
            .child(content)
            .on_children_prepainted(move |bounds, window, _| {
                let Some(b) = bounds.first() else { return };
                let h = f32::from(b.size.height);
                let changed = HEIGHTS.with(|m| {
                    let mut m = m.borrow_mut();
                    let old = m.insert(key, h);
                    old.is_none_or(|o| (o - h).abs() > 0.25)
                });
                if changed {
                    window.refresh();
                }
            });
        let b = &self.theme.block;
        let size = (width, height);
        let state = cx.state;
        let frame = if state.selected {
            ring::ring(size, b.radius, b.ring_width, b.selected_ring)
        } else if state.focus_within() {
            ring::ring(size, b.radius, b.ring_width, b.hover_ring)
        } else {
            let hover = b.hover_ring;
            ring::outline(size, b.radius, b.ring_width)
                .group_hover("md-html-widget", move |s| s.border_color(hover))
        };
        let toggle = source_toggle(
            cx.id("md-html-source"),
            "md-html-widget",
            width,
            self.theme.dark,
            state.focus_within() || state.selected,
            cx.sender(),
            Command::new(ID, ShowSource(self.range.clone())),
        );
        let widget = div()
            .absolute()
            .left_0()
            .top_0()
            .w(px(width))
            .h(px(height))
            .group("md-html-widget")
            .rounded(px(b.radius))
            .child(surface)
            .child(frame)
            .child(toggle);
        (
            cx.block_box(height).child(widget).into_any_element(),
            height,
        )
    }
}
