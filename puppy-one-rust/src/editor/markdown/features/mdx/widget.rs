//! `.cm-md-mdx-tabs-widget` (markdown-editor.css): a toolbar at least 38px
//! tall over a divider — the tab labels 18px apart in muted type, the shown
//! one in text colour on a 2px rule, and `</>` (Source) at the end, showing
//! while the block is hovered or focused — over the panel of the shown tab
//! (`padding: 18px 2px 8px`, at least 54px), its Markdown rendered, with the
//! block radius and rings. The panel lays itself out; its measured height
//! is the block's from the next frame on.
use super::{Action, ID, TabsBlock};
use crate::{
    editor::{
        markdown::{
            features::html::{markdown_nodes, render::Surface},
            shared::ring,
            style::MarkdownTheme,
        },
        registry::DocumentAssets,
        view::{
            command::Command,
            widget::{BlockWidget, WidgetCx},
        },
    },
    theme::{self, Theme},
};
use gpui::{prelude::*, *};
use std::{
    cell::RefCell,
    collections::HashMap,
    hash::{Hash, Hasher},
};

/// `.cm-md-mdx-tabs-toolbar { min-height: 38px }`; a tab's 9px bottom
/// padding and the toggle's 10px.
const TOOLBAR: f32 = 38.;
const TAB_GAP: f32 = 18.;
const TAB_BOTTOM: f32 = 9.;
const TOGGLE_BOTTOM: f32 = 10.;
/// `.cm-md-mdx-tabs-panels { min-height: 54px; padding: 18px 2px 8px }`.
const PANEL_MIN: f32 = 54.;
const PANEL_TOP: f32 = 18.;
const PANEL_X: f32 = 2.;
const PANEL_BOTTOM: f32 = 8.;
/// `.cm-md-mdx-source-toggle` while shown.
const TOGGLE_OPACITY: f32 = 0.72;

thread_local! {
    /// Measured panel heights, by block, tab and width.
    static HEIGHTS: RefCell<HashMap<u64, f32>> = RefCell::new(HashMap::new());
}

pub struct TabsWidget {
    block: TabsBlock,
    theme: MarkdownTheme,
    assets: Option<DocumentAssets>,
    active: usize,
}

impl TabsWidget {
    pub fn new(
        block: TabsBlock,
        theme: &MarkdownTheme,
        assets: Option<DocumentAssets>,
        active: usize,
    ) -> Self {
        let active = active.min(block.tabs.len().saturating_sub(1));
        Self {
            block,
            theme: theme.clone(),
            assets,
            active,
        }
    }
}

impl BlockWidget for TabsWidget {
    fn render(&self, cx: &mut WidgetCx) -> (AnyElement, f32) {
        let width = cx.width;
        let at = self.block.range.start;
        let t = Theme::new(self.theme.dark);
        let state = cx.state;
        let send = cx.sender();
        let tab = &self.block.tabs[self.active];
        let mut h = std::hash::DefaultHasher::new();
        (at, self.active, &tab.content, width.to_bits()).hash(&mut h);
        let key = h.finish();
        let panel_height = HEIGHTS
            .with(|m| m.borrow().get(&key).copied())
            .unwrap_or(PANEL_MIN)
            .max(PANEL_MIN);
        let height = TOOLBAR + panel_height;

        let text = &self.theme.body.text;
        let mut labels = div()
            .flex()
            .items_end()
            .gap(px(TAB_GAP))
            .min_w_0()
            .overflow_hidden();
        for (index, item) in self.block.tabs.iter().enumerate() {
            let shown = index == self.active;
            let send = send.clone();
            let mut label = div()
                .id(ElementId::NamedInteger(
                    "md-mdx-tab".into(),
                    ((at as u64) << 8) | index as u64,
                ))
                .relative()
                .flex_none()
                .px(px(1.))
                .pb(px(TAB_BOTTOM))
                .whitespace_nowrap()
                .cursor(theme::clickable_cursor())
                .text_color(if shown { t.text } else { t.muted })
                .hover(|s| s.text_color(t.text))
                .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                .on_click(move |_, window, cx| {
                    cx.stop_propagation();
                    send(
                        Command::new(ID, Action::Select { at, tab: index }),
                        window,
                        cx,
                    );
                })
                .child(SharedString::from(item.label.clone()));
            text.apply(label.style());
            label = label.text_color(if shown { t.text } else { t.muted });
            if shown {
                // `::after`: a 2px rule over the divider.
                label = label.child(
                    div()
                        .absolute()
                        .left_0()
                        .right_0()
                        .bottom(px(-1.))
                        .h(px(2.))
                        .rounded_full()
                        .bg(t.text),
                );
            }
            labels = labels.child(label);
        }
        let range = self.block.range.clone();
        let toggle_send = send.clone();
        let focused = state.focus_within() || state.selected;
        let toggle = div()
            .id(ElementId::NamedInteger("md-mdx-source".into(), at as u64))
            .flex_none()
            .px(px(2.))
            .pb(px(TOGGLE_BOTTOM))
            .font_family(self.theme.code_block.text().family())
            .text_size(px(theme::ty().ui.caption))
            .text_color(t.muted)
            .cursor(theme::clickable_cursor())
            .opacity(if focused { TOGGLE_OPACITY } else { 0. })
            .group_hover("md-mdx-tabs", |s| s.opacity(TOGGLE_OPACITY))
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .on_click(move |_, window, cx| {
                cx.stop_propagation();
                toggle_send(
                    Command::new(ID, Action::ShowSource(range.clone())),
                    window,
                    cx,
                );
            })
            .child("</>");
        let toolbar = div()
            .absolute()
            .left_0()
            .top_0()
            .w(px(width))
            .h(px(TOOLBAR))
            .flex()
            .items_end()
            .justify_between()
            .gap(px(12.))
            .border_b_1()
            .border_color(t.divider)
            .child(labels)
            .child(toggle);

        let document = self
            .assets
            .as_ref()
            .map(|a| a.document.clone())
            .unwrap_or_default();
        let nodes = markdown_nodes(tab.content.trim());
        let inner = (width - 2. * PANEL_X).max(0.);
        let content = Surface::new(
            &self.theme,
            self.assets.as_ref(),
            &document,
            cx.render.view.clone(),
            at + 1 + self.active,
            cx.render,
        )
        .render(&nodes, inner);
        let measured = div()
            .absolute()
            .left(px(PANEL_X))
            .top(px(PANEL_TOP))
            .w(px(inner))
            .child(content)
            .on_children_prepainted(move |bounds, window, _| {
                let Some(b) = bounds.first() else { return };
                let h = f32::from(b.size.height) + PANEL_TOP + PANEL_BOTTOM;
                let changed = HEIGHTS.with(|m| {
                    let old = m.borrow_mut().insert(key, h);
                    old.is_none_or(|o| (o - h).abs() > 0.25)
                });
                if changed {
                    window.refresh();
                }
            });
        let b = &self.theme.block;
        let size = (width, panel_height);
        let frame = if state.selected {
            ring::ring(size, b.radius, b.ring_width, b.selected_ring)
        } else if state.focus_within() {
            ring::ring(size, b.radius, b.ring_width, b.hover_ring)
        } else {
            let hover = b.hover_ring;
            ring::outline(size, b.radius, b.ring_width)
                .group_hover("md-mdx-tabs", move |s| s.border_color(hover))
        };
        let panel = div()
            .absolute()
            .left_0()
            .top(px(TOOLBAR))
            .w(px(width))
            .h(px(panel_height))
            .rounded(px(b.radius))
            .child(measured)
            .child(frame);
        let widget = div()
            .absolute()
            .left_0()
            .top_0()
            .w(px(width))
            .h(px(height))
            .group("md-mdx-tabs")
            .child(toolbar)
            .child(panel);
        (
            cx.block_box(height).child(widget).into_any_element(),
            height,
        )
    }
}
