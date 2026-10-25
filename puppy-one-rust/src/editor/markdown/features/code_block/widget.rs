//! The code block widget (features/code-block/codeBlockWidget.ts,
//! markdown-code-widgets.css): `.cm-md-code-widget` keeps the block rhythm
//! as padding (gap before / after); `.cm-md-code-panel` is the rounded
//! surface; the code text (`white-space: pre`, panel padding, code line
//! height, `min-height: 44px`) is a Kit code leaf over the fence's code
//! lines, so the source stays the one document.
use super::{CodeBlock, highlight, style::CodeBlockStyle};
use crate::editor::{
    markdown::{shared::ring, style::BlockStyle},
    view::{
        style::TextStyle,
        widget::{BlockWidget, WidgetCx},
    },
};
use gpui::{prelude::*, *};

/// `.cm-md-code-textarea { min-height: 44px }`.
const MIN_HEIGHT: f32 = 44.;

pub struct CodeBlockWidget {
    block: CodeBlock,
    style: CodeBlockStyle,
    chrome: BlockStyle,
    text: TextStyle,
}

impl CodeBlockWidget {
    pub fn new(block: &CodeBlock, style: &CodeBlockStyle, chrome: &BlockStyle) -> Self {
        Self {
            block: block.clone(),
            style: style.clone(),
            chrome: chrome.clone(),
            text: style.text(),
        }
    }

    /// `tab-size: var(--cm-md-code-tab-size, 2)` (Python uses 4).
    fn tab_size(&self) -> usize {
        if matches!(
            self.block.language.to_ascii_lowercase().as_str(),
            "py" | "python"
        ) {
            4
        } else {
            2
        }
    }
}

impl BlockWidget for CodeBlockWidget {
    fn render(&self, cx: &mut WidgetCx) -> (AnyElement, f32) {
        let (top, width) = (cx.top, cx.width);
        let s = &self.style;
        let p = s.padding;
        let panel_top = top + s.gap_before;
        let inner = (width - p.left - p.right).max(0.);
        let (language, syntax) = (self.block.language.clone(), &s.syntax);
        let (code, code_height) = cx.render.code(
            self.block.code.clone(),
            &self.text,
            self.tab_size(),
            panel_top,
            p.left,
            p.top,
            inner,
            |text| highlight::highlight(text, &language, syntax),
        );
        let panel_height = (p.top + code_height + p.bottom).max(MIN_HEIGHT);
        let height = s.gap_before + panel_height + s.gap_after;
        let panel = div()
            .absolute()
            .left_0()
            .top_0()
            .w(px(width))
            .h(px(panel_height))
            .rounded(px(s.radius))
            .bg(s.background)
            .overflow_hidden()
            .child(code);
        // `box-shadow: 0 0 0 2px var(--cm-md-block-current-ring)`: the
        // selected ring when the selection covers the block, the hover ring
        // while hovered or focused within.
        let c = &self.chrome;
        let size = (width, panel_height);
        let current = if cx.state.selected {
            Some(c.selected_ring)
        } else if cx.state.focus_within() {
            Some(c.hover_ring)
        } else {
            None
        };
        let frame = match current {
            Some(color) => ring::ring(size, s.radius, c.ring_width, color),
            None => {
                let hover = c.hover_ring;
                ring::outline(size, s.radius, c.ring_width)
                    .group_hover("md-code-panel", move |st| st.border_color(hover))
            }
        };
        // The panel clips its code; the ring sits outside it, both in the
        // hover group.
        let surface = div()
            .absolute()
            .left_0()
            .top(px(s.gap_before))
            .w(px(width))
            .h(px(panel_height))
            .group("md-code-panel")
            .child(panel)
            .child(frame);
        (
            cx.block_box(height).child(surface).into_any_element(),
            height,
        )
    }
}
