//! `.cm-md-math-block-widget` (markdown-math.css): a centred formula in a
//! panel of at least 96px with 24px / 12px padding, the block radius and the
//! block rings, scrolling sideways when it is wider. The formula is KaTeX's
//! (`renderKatex` with the product's options); a source KaTeX refuses shows
//! as `$$` source in the error colour (`.cm-md-math-source-fallback`). With
//! the caret inside, the formula's source shows above it as an editable code
//! leaf, so the block is edited where it is read.
use super::MathBlock;
use crate::editor::{
    markdown::{
        shared::ring,
        style::{BlockStyle, MarkdownTheme},
    },
    tokens::Tokens,
    view::{
        style::{Align, Rect, TextStyle},
        widget::{BlockWidget, WidgetCx},
    },
};
use crate::render_service::{self, Kind, Request, State};
use gpui::{prelude::*, *};

/// `min-height: 96px; padding: 24px 12px`.
const MIN_HEIGHT: f32 = 96.;
const PADDING_BLOCK: f32 = 24.;
const PADDING_INLINE: f32 = 12.;

pub struct MathBlockWidget {
    block: MathBlock,
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
        let typeset = render_service::get(&self.request, cx.render.window, cx.render.app);
        let row = match &typeset {
            State::Ready(formula) => formula.height,
            State::Failed(_) => {
                let lines = self.block.source.lines().count() as f32 + 2.;
                lines * self.fallback.line_height_px()
            }
            State::Pending | State::Unavailable => self.text.line_height_px(),
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
            State::Failed(_) => children.push(cx.render.label(
                Rect::new(PADDING_INLINE, y, inner, row),
                &SharedString::from(format!("$$\n{}\n$$", self.block.source)),
                &self.fallback,
                Align::Start,
                top,
            )),
            State::Pending | State::Unavailable => children.push(cx.render.label(
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
        let surface = div()
            .absolute()
            .left_0()
            .top_0()
            .w(px(width))
            .h(px(height))
            .group("md-math-block")
            .children(children)
            .child(frame);
        (
            cx.block_box(height).child(surface).into_any_element(),
            height,
        )
    }
}
