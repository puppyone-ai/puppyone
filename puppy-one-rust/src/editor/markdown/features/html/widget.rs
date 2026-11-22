//! `.cm-md-html-widget`: the rendered surface in `.cm-md-html-widget-content`
//! (the block radius and rings) with the toolbar's source toggle. Uses
//! `features::html::render::Surface` and shared widget chrome (`ring`,
//! `source_toggle`).
use super::{ID, ShowSource, dom, render::Surface};
use crate::editor::{
    markdown::{
        platform::sessions::measure,
        shared::widgets::{ring, source_toggle::source_toggle},
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
    hash::{Hash, Hasher},
    ops::Range,
    path::Path,
    rc::Rc,
};

pub struct HtmlBlockWidget {
    pub range: Range<usize>,
    pub nodes: Vec<dom::Node>,
    pub theme: MarkdownTheme,
    pub assets: Option<DocumentAssets>,
    /// A web embed's page, in place of the surface.
    pub embed: Option<String>,
}

impl BlockWidget for HtmlBlockWidget {
    fn render(&self, cx: &mut WidgetCx) -> (AnyElement, f32) {
        let width = cx.width;
        let mut h = std::hash::DefaultHasher::new();
        (self.range.start, width.to_bits()).hash(&mut h);
        dom::hash_nodes(&self.nodes, &mut h);
        let key = h.finish();
        let lines = cx
            .render
            .doc
            .slice(self.range.clone())
            .lines()
            .count()
            .max(1);
        let estimate = lines as f32 * self.theme.body.text.line_height_px();
        let block_id = cx.block_id;
        let height = measure::get(&mut cx.render.widget_states.borrow_mut(), block_id, key)
            .unwrap_or(estimate);
        let document = self
            .assets
            .as_ref()
            .map(|a| a.document.clone())
            .unwrap_or_default();
        let view = cx.render.view.clone();
        let content = match &self.embed {
            Some(href) => super::embed::render(
                &view,
                self.range.start,
                href,
                width,
                &self.theme,
                cx.render.window,
                cx.render.app,
            ),
            None => Surface::new(
                &self.theme,
                Path::new(&document),
                self.assets.as_ref(),
                view,
                block_id,
                self.range.start,
                cx.render,
            )
            .render(&self.nodes, width),
        };
        let states = Rc::clone(cx.render.widget_states);
        let surface = div()
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
        let hovered =
            cx.render
                .window
                .use_keyed_state(cx.id("md-html-hovered"), cx.render.app, |_, _| false);
        let is_hovered = *hovered.read(cx.render.app);
        let visible = state.focus_within() || state.selected || is_hovered;
        let toggle = source_toggle(
            cx.id("md-html-source"),
            "md-html-widget",
            width,
            self.theme.dark,
            visible,
            cx.sender(),
            Command::new(ID, ShowSource(self.range.clone())),
        );
        let owner_view = cx.render.view.clone();
        let widget = div()
            .id(cx.id("md-html-box"))
            .absolute()
            .left_0()
            .top_0()
            .w(px(width))
            .h(px(height))
            .group("md-html-widget")
            .rounded(px(b.radius))
            .on_hover(move |&now, _, app| {
                let changed = hovered.update(app, |h, _| {
                    if *h != now {
                        *h = now;
                        true
                    } else {
                        false
                    }
                });
                if changed {
                    let _ = owner_view.update(app, |_, cx| cx.notify());
                }
            })
            .child(surface)
            .child(frame)
            .child(toggle);
        (
            cx.block_box(height).child(widget).into_any_element(),
            height,
        )
    }
}
