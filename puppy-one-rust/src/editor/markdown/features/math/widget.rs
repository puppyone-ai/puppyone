//! `.cm-md-math-block-widget` (markdown-math.css): a centred formula in a
//! panel of at least 96px with 24px / 12px padding, the block radius and the
//! block rings. With the caret inside, the formula's source shows above it
//! as an editable code leaf, so the block is edited where it is read.
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
}

impl MathBlockWidget {
    pub fn new(block: &MathBlock, theme: &MarkdownTheme) -> Self {
        let t = Tokens::get(theme.dark, theme.scale);
        let mut text = theme.body.text.clone();
        text.size = t.len("--po-md-math-block-font-size", text.size);
        text.italic = true;
        Self {
            block: block.clone(),
            chrome: theme.block.clone(),
            text,
            source: theme.code_block.text(),
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
        let row = self.text.line_height_px();
        // `display: grid; align-items: center` within the minimum height
        // (the source, while shown, keeps the top).
        if !editing {
            y += ((MIN_HEIGHT - (2. * PADDING_BLOCK + row)) / 2.).max(0.);
        }
        let label = cx.render.label(
            Rect::new(PADDING_INLINE, y, inner, row),
            &SharedString::from(self.block.text.clone()),
            &self.text,
            Align::Center,
            top,
        );
        children.push(label);
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
