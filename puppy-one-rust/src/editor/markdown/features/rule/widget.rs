//! `.cm-md-hr-widget`: an inline-flex box of the rule height with a centred
//! `::before` rule.
use super::style::RuleStyle;
use crate::editor::view::widget::{BlockWidget, WidgetCx};
use gpui::{prelude::*, *};

pub struct RuleWidget {
    style: RuleStyle,
}

impl RuleWidget {
    pub fn new(style: &RuleStyle) -> Self {
        Self {
            style: style.clone(),
        }
    }
}

impl BlockWidget for RuleWidget {
    fn render(&self, cx: &mut WidgetCx) -> (AnyElement, f32) {
        let s = &self.style;
        // `align-items: center`: the rule's top is (height - thickness) / 2.
        let rule = div()
            .absolute()
            .left_0()
            .top(px((s.height - s.thickness) / 2.))
            .w(px(cx.width))
            .h(px(s.thickness))
            .bg(s.color);
        (
            cx.block_box(s.height).child(rule).into_any_element(),
            s.height,
        )
    }
}
