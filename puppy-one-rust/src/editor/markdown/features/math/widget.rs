//! `.cm-md-math-block-widget` (markdown-math.css): a centred formula in a
//! panel of at least 96px with 24px / 12px padding, the block radius and the
//! block rings, scrolling sideways when it is wider. The formula is KaTeX's
//! (`renderKatex` with the product's options) routed through [`platform::render`];
//! a source KaTeX refuses degrades visibly along `Rendered -> Fallback -> Source`
//! (`TA-52`) with the KaTeX error reason, `$$` source fallback, and `Retry` /
//! `Source code` actions. With the caret inside, the formula's source shows
//! above it as an editable code leaf, so the block is edited where it is read.
use super::MathBlock;
use crate::{
    editor::{
        markdown::{
            platform::brokers::render as render_broker,
            shared::widgets::{fallback::action_pill, ring},
            style::{BlockStyle, MarkdownTheme},
        },
        text::{selection::Selection, state::Transaction},
        tokens::Tokens,
        view::{
            style::{Align, Rect, TextStyle},
            widget::{BlockWidget, WidgetCx},
        },
    },
    localization::t,
    render_service::{self, Kind, Request, State},
    theme::{self, Theme},
};
use gpui::{prelude::*, *};

/// `min-height: 96px; padding: 24px 12px`.
const MIN_HEIGHT: f32 = 96.;
const PADDING_BLOCK: f32 = 24.;
const PADDING_INLINE: f32 = 12.;
const BANNER_HEIGHT: f32 = 32.;
const BANNER_GAP: f32 = 8.;

#[cfg(test)]
pub(crate) fn request_for_tests(
    source: &str,
    dark: bool,
    scale: crate::typography::Scale,
) -> Request {
    let theme = MarkdownTheme::resolve(dark, scale);
    let block = MathBlock {
        range: 0..source.len(),
        content: 0..source.len(),
        text: source.to_owned(),
        source: source.to_owned(),
    };
    MathBlockWidget::new(&block, &theme).request
}

pub struct MathBlockWidget {
    block: MathBlock,
    dark: bool,
    chrome: BlockStyle,
    text: TextStyle,
    source: TextStyle,
    /// `.cm-md-math-source-fallback`: code type in the error colour.
    fallback: TextStyle,
    request: Request,
}

impl MathBlockWidget {
    pub fn new(block: &MathBlock, theme: &MarkdownTheme) -> Self {
        let t = Tokens::get(theme.dark, theme.scale);
        let mut text = theme.body.text.clone();
        text.size = t.len("--po-md-math-block-font-size", text.size);
        text.italic = true;
        let mut fallback = theme.code_block.text();
        fallback.color = t.color("--po-md-error-color");
        Self {
            block: block.clone(),
            dark: theme.dark,
            chrome: theme.block.clone(),
            request: Request {
                kind: Kind::Math {
                    display: true,
                    color: render_service::hex(t.color("--po-md-content-color")),
                    font_size: text.size,
                },
                source: block.source.clone(),
                background: render_service::hex(t.color("--po-editor-bg")),
                scale: 1.,
            },
            text,
            source: theme.code_block.text(),
            fallback,
        }
    }

    fn fallback_bar(
        &self,
        reason: &str,
        is_error: bool,
        editing: bool,
        top_y: f32,
        inner: f32,
        cx: &WidgetCx,
    ) -> AnyElement {
        let app = Theme::new(self.dark);
        let ty = theme::ty().ui;
        let request = self.request.clone();
        let retry_btn = action_pill(
            cx.id("math-retry"),
            t("common.action.retry"),
            self.dark,
            move |_, cx| render_broker::retry(&request, cx),
        );
        let can_edit_source = !editing && !cx.state.read_only;
        let view = cx.render.view.clone();
        let caret = self.block.content.end;
        let border = if is_error {
            theme::mix(app.danger, app.divider, 0.28)
        } else {
            app.border_subtle
        };
        let bg = if is_error {
            theme::alpha(app.danger, 0.08)
        } else {
            app.panel
        };
        let fg = if is_error {
            theme::mix(app.danger, app.text, 0.58)
        } else {
            app.muted
        };
        div()
            .absolute()
            .left(px(PADDING_INLINE))
            .top(px(top_y))
            .w(px(inner))
            .h(px(BANNER_HEIGHT))
            .px(px(8.))
            .flex()
            .items_center()
            .justify_between()
            .gap(px(8.))
            .rounded(px(5.))
            .border_1()
            .border_color(border)
            .bg(bg)
            .text_size(px(ty.meta))
            .text_color(fg)
            .child(
                div()
                    .min_w_0()
                    .truncate()
                    .child(SharedString::from(reason.to_owned())),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .child(retry_btn)
                    .when(can_edit_source, |row| {
                        row.child(action_pill(
                            cx.id("math-show-source"),
                            t("editor.mode.source"),
                            self.dark,
                            move |window, cx| {
                                let _ = view.update(cx, |v, cx| {
                                    v.focus(window, cx);
                                    let pos = caret.min(v.state().doc.len());
                                    v.dispatch(Transaction::select(Selection::cursor(pos)), cx);
                                });
                            },
                        ))
                    }),
            )
            .into_any_element()
    }
}

impl BlockWidget for MathBlockWidget {
    fn render(&self, cx: &mut WidgetCx) -> (AnyElement, f32) {
        let (top, width) = (cx.top, cx.width);
        let editing = cx.state.focus_within();
        let inner = (width - 2. * PADDING_INLINE).max(0.);
        let mut children: Vec<AnyElement> = Vec::new();
        let mut y = PADDING_BLOCK;
        if editing {
            let (code, height) = cx.render.code(
                self.block.content.clone(),
                &self.source,
                2,
                top,
                PADDING_INLINE,
                y,
                inner,
                |_| Vec::new().into(),
            );
            children.push(code);
            y += height + 12.;
        }
        let slot = render_broker::slot_for(cx.render.view.entity_id(), self.block.range.start);
        let typeset =
            render_broker::get_for_slot(slot, &self.request, cx.render.window, cx.render.app);
        let row = match &typeset {
            State::Ready(formula) => formula.height,
            State::Failed(_) => {
                let lines = self.block.source.lines().count() as f32 + 2.;
                lines * self.fallback.line_height_px() + BANNER_GAP + BANNER_HEIGHT
            }
            State::Unavailable => self.text.line_height_px() + BANNER_GAP + BANNER_HEIGHT,
            State::Pending => self.text.line_height_px(),
        };
        // `display: grid; align-items: center` within the minimum height
        // (the source, while shown, keeps the top).
        if !editing {
            y += ((MIN_HEIGHT - (2. * PADDING_BLOCK + row)) / 2.).max(0.);
        }
        match typeset {
            State::Ready(formula) => children.push(
                div()
                    .id(cx.id("math-formula"))
                    .absolute()
                    .left(px(PADDING_INLINE))
                    .top(px(y))
                    .w(px(inner))
                    .h(px(row))
                    .overflow_x_scroll()
                    .child(
                        div()
                            .min_w_full()
                            .w(px(formula.width.max(inner)))
                            .flex()
                            .justify_center()
                            .child(
                                img(ImageSource::Render(formula.image.clone()))
                                    .w(px(formula.width))
                                    .h(px(formula.height))
                                    .flex_none(),
                            ),
                    )
                    .into_any_element(),
            ),
            State::Failed(error) => {
                let src_h = (self.block.source.lines().count() as f32 + 2.)
                    * self.fallback.line_height_px();
                children.push(cx.render.label(
                    Rect::new(PADDING_INLINE, y, inner, src_h),
                    &SharedString::from(format!("$$\n{}\n$$", self.block.source)),
                    &self.fallback,
                    Align::Start,
                    top,
                ));
                let reason = if error.trim().is_empty() {
                    t("editor.markdown.previewUnavailable").to_owned()
                } else {
                    crate::localization::bidi_isolate(&error)
                };
                children.push(self.fallback_bar(
                    &reason,
                    true,
                    editing,
                    y + src_h + BANNER_GAP,
                    inner,
                    cx,
                ));
            }
            State::Unavailable => {
                let text_h = self.text.line_height_px();
                children.push(cx.render.label(
                    Rect::new(PADDING_INLINE, y, inner, text_h),
                    &SharedString::from(self.block.text.clone()),
                    &self.text,
                    Align::Center,
                    top,
                ));
                children.push(self.fallback_bar(
                    t("editor.markdown.previewUnavailable"),
                    false,
                    editing,
                    y + text_h + BANNER_GAP,
                    inner,
                    cx,
                ));
            }
            State::Pending => children.push(cx.render.label(
                Rect::new(PADDING_INLINE, y, inner, row),
                &SharedString::from(self.block.text.clone()),
                &self.text,
                Align::Center,
                top,
            )),
        }
        let height = (y + row + PADDING_BLOCK).max(MIN_HEIGHT);
        let c = &self.chrome;
        let size = (width, height);
        let frame = if cx.state.selected {
            ring::ring(size, c.radius, c.ring_width, c.selected_ring)
        } else if editing {
            ring::ring(size, c.radius, c.ring_width, c.hover_ring)
        } else {
            let hover = c.hover_ring;
            ring::outline(size, c.radius, c.ring_width)
                .group_hover("md-math-block", move |st| st.border_color(hover))
        };
        let view = cx.render.view.clone();
        let content_start = self.block.content.start;
        let read_only = cx.state.read_only;
        let surface = div()
            .id(cx.id("md-math-block"))
            .debug_selector(|| "md-math-block".to_owned())
            .absolute()
            .left_0()
            .top_0()
            .w(px(width))
            .h(px(height))
            .group("md-math-block")
            .on_mouse_down(MouseButton::Left, move |event, window, cx| {
                if event.click_count >= 2 && !read_only {
                    cx.stop_propagation();
                    let _ = view.update(cx, |v, cx| {
                        v.focus(window, cx);
                        v.dispatch(Transaction::select(Selection::cursor(content_start)), cx);
                    });
                }
            })
            .children(children)
            .child(frame);
        (
            cx.block_box(height).child(surface).into_any_element(),
            height,
        )
    }
}
