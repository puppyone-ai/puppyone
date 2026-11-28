//! `.cm-md-mdx-tabs-widget` (markdown-editor.css): a toolbar at least 38px
//! tall over a divider — the tab labels 18px apart in muted type, the shown
//! one in text colour on a 2px rule, and `</>` (Source) at the end, showing
//! while the block is hovered or focused — over the panel of the shown tab
//! (`padding: 18px 2px 8px`, at least 54px), its Markdown rendered through
//! [`shared::preview::InlinePreview`] with zero cross-feature imports
//! (`MA-07`, `MA-12`, `R5`, `R13`).
//!
//! The labels are a tab list (`mdxTabsWidget.ts`): each tab takes keyboard
//! focus, only the shown one is a tab stop, and while one has focus the
//! arrows, Home and End show and focus another without touching the source.
use super::{Action, ID, TabsBlock};
use crate::{
    editor::{
        markdown::{
            shared::{preview::InlinePreview, widgets::ring},
            style::MarkdownTheme,
        },
        registry::DocumentAssets,
        view::{
            command::Command,
            widget::{BlockWidget, CommandSender, WidgetCx},
        },
    },
    theme::{self, Theme},
};
use gpui::{prelude::*, *};
use std::{
    hash::{Hash, Hasher},
    path::Path,
    rc::Rc,
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
/// `.cm-md-mdx-tab:focus-visible { outline: 2px; outline-offset: 2px }`,
/// in the accent at 55%.
const FOCUS_RING: f32 = 2.;
const FOCUS_OFFSET: f32 = 2.;
const FOCUS_ALPHA: f32 = 0.55;

actions!(markdown_mdx_tabs, [NextTab, PreviousTab, FirstTab, LastTab]);

/// A focused tab's key context: ArrowRight / ArrowLeft (wrapping), Home and
/// End show another tab.
pub const TAB_KEY_CONTEXT: &str = "MarkdownMdxTab";

/// Each tab's keyboard focus, kept by the block across frames.
#[derive(Default)]
struct TabFocus(Vec<FocusHandle>);

/// Show tab `tab` of the block at `at` and move the keyboard there.
fn show(
    send: &CommandSender,
    handles: &[FocusHandle],
    at: usize,
    tab: usize,
    window: &mut Window,
    cx: &mut App,
) {
    send(
        Command::new(ID, Action::Select { at, tab }).preserving_focus(),
        window,
        cx,
    );
    if let Some(handle) = handles.get(tab) {
        window.focus(handle, cx);
    }
}

pub struct TabsWidget {
    block: TabsBlock,
    theme: MarkdownTheme,
    assets: Option<DocumentAssets>,
    active: usize,
    inline_preview: Option<&'static dyn InlinePreview>,
}

impl TabsWidget {
    pub fn new(
        block: TabsBlock,
        theme: &MarkdownTheme,
        assets: Option<DocumentAssets>,
        active: usize,
        inline_preview: Option<&'static dyn InlinePreview>,
    ) -> Self {
        let active = active.min(block.tabs.len().saturating_sub(1));
        Self {
            block,
            theme: theme.clone(),
            assets,
            active,
            inline_preview,
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
        ("mdx-tabs", at, self.active, &tab.content, width.to_bits()).hash(&mut h);
        let key = h.finish();
        let block_id = cx.block_id;
        let panel_height = self
            .inline_preview
            .and_then(|p| {
                p.measured_height(&mut cx.render.widget_states.borrow_mut(), block_id, key)
            })
            .unwrap_or(PANEL_MIN)
            .max(PANEL_MIN);
        let height = TOOLBAR + panel_height;

        let count = self.block.tabs.len();
        let mut handles = cx.with_widget_state(|f: &mut TabFocus| std::mem::take(&mut f.0));
        handles.truncate(count);
        while handles.len() < count {
            handles.push(cx.render.app.focus_handle());
        }
        cx.with_widget_state(|f: &mut TabFocus| f.0.clone_from(&handles));
        let handles: Rc<[FocusHandle]> = handles.into();
        let focused_tab = handles.iter().position(|h| h.is_focused(cx.render.window));
        let focus_visible = cx.render.window.last_input_was_keyboard();

        let text = &self.theme.body.text;
        let mut labels = div()
            .id(ElementId::NamedInteger("md-mdx-tablist".into(), at as u64))
            .test_support()
            .role(Role::TabList)
            .aria_label("Tabs")
            .flex()
            .items_end()
            .gap(px(TAB_GAP))
            .min_w_0()
            .overflow_hidden();
        for (index, item) in self.block.tabs.iter().enumerate() {
            let shown = index == self.active;
            let ring = focused_tab == Some(index) && focus_visible;
            let name = item.label.clone();
            let to = |next: usize| {
                let (send, handles) = (send.clone(), handles.clone());
                move |window: &mut Window, cx: &mut App| show(&send, &handles, at, next, window, cx)
            };
            let next = to((index + 1) % count);
            let previous = to((index + count - 1) % count);
            let first = to(0);
            let last = to(count - 1);
            let click = to(index);
            let mut label = div()
                .id(ElementId::NamedInteger(
                    "md-mdx-tab".into(),
                    ((at as u64) << 8) | index as u64,
                ))
                .test_support()
                .role(Role::Tab)
                .aria_label(SharedString::from(item.label.clone()))
                .aria_selected(shown)
                // Only the shown tab is a tab stop (roving `tabIndex`).
                .track_focus(&handles[index].clone().tab_stop(shown))
                .key_context(TAB_KEY_CONTEXT)
                .on_action(move |_: &NextTab, window, cx| next(window, cx))
                .on_action(move |_: &PreviousTab, window, cx| previous(window, cx))
                .on_action(move |_: &FirstTab, window, cx| first(window, cx))
                .on_action(move |_: &LastTab, window, cx| last(window, cx))
                .debug_selector(move || {
                    format!(
                        "md-mdx-tab:{name}:{}",
                        if shown { "shown" } else { "hidden" }
                    )
                })
                .relative()
                .flex_none()
                .px(px(1.))
                .pb(px(TAB_BOTTOM))
                .whitespace_nowrap()
                .cursor(theme::clickable_cursor())
                .text_color(if shown || ring { t.text } else { t.muted })
                .hover(|s| s.text_color(t.text))
                .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                // A pressed tab shows and takes focus, as a button does.
                .on_click(move |_, window, cx| {
                    cx.stop_propagation();
                    click(window, cx);
                })
                .child(SharedString::from(item.label.clone()));
            text.apply_for(label.style(), cx.render.language());
            label = label.text_color(if shown || ring { t.text } else { t.muted });
            if ring {
                let inset = -(FOCUS_RING + FOCUS_OFFSET);
                label = label.child(
                    div()
                        .absolute()
                        .left(px(inset))
                        .right(px(inset))
                        .top(px(inset))
                        .bottom(px(inset))
                        .rounded(px(FOCUS_RING + FOCUS_OFFSET))
                        .border(px(FOCUS_RING))
                        .border_color(theme::alpha(t.accent, FOCUS_ALPHA)),
                );
            }
            if shown {
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
        let focused = state.focus_within() || state.selected || focused_tab.is_some();
        let toggle = div()
            .id(ElementId::NamedInteger("md-mdx-source".into(), at as u64))
            .debug_selector(|| "md-mdx-source".into())
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
        let inner = (width - 2. * PANEL_X).max(0.);
        let block_offset = at + 1 + self.active;
        let inline_preview = self.inline_preview;
        let content = match inline_preview {
            Some(preview) => preview.render_markdown(
                tab.content.trim(),
                inner,
                Path::new(&document),
                block_id,
                block_offset,
                &self.theme,
                self.assets.as_ref(),
                cx.render,
            ),
            None => div().into_any_element(),
        };
        let states = Rc::clone(cx.render.widget_states);
        let measured = div()
            .absolute()
            .left(px(PANEL_X))
            .top(px(PANEL_TOP))
            .w(px(inner))
            .child(content)
            .on_children_prepainted(move |bounds, window, _| {
                let Some(b) = bounds.first() else { return };
                let h = f32::from(b.size.height) + PANEL_TOP + PANEL_BOTTOM;
                if inline_preview.is_some_and(|p| {
                    p.record_measured_height(&mut states.borrow_mut(), block_id, key, h)
                }) {
                    window.refresh();
                }
            });
        let b = &self.theme.block;
        let size = (width, panel_height);
        let frame = if state.selected {
            ring::ring(size, b.radius, b.ring_width, b.selected_ring)
        } else if state.focus_within() || focused_tab.is_some() {
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
