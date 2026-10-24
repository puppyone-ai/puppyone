//! `.cm-md-hr-widget`: an inline-flex box of the rule height with a centred
//! `::before` rule.
use super::style::RuleStyle;
use crate::editor::view::widget::{BlockWidget, WidgetCx};
use gpui::{prelude::*, *};
use std::hash::{DefaultHasher, Hash, Hasher};

pub struct RuleWidget {
    style: RuleStyle,
}

impl RuleWidget {
    pub fn new(style: &RuleStyle) -> Self {
        Self { style: style.clone() }
    }
}

impl BlockWidget for RuleWidget {
    fn key(&self) -> u64 {
        let mut h = DefaultHasher::new();
        let c = self.style.color;
        ("rule", c.r.to_bits(), c.g.to_bits(), c.b.to_bits(), c.a.to_bits(), self.style.height.to_bits()).hash(&mut h);
        h.finish()
    }

    fn render(&self, cx: &mut WidgetCx) -> (AnyElement, f32) {
        let s = &self.style;
        // `align-items: center`: the rule's top is (height - thickness) / 2.
        let rule = div().absolute().left_0().top(px((s.height - s.thickness) / 2.)).w(px(cx.width)).h(px(s.thickness)).bg(s.color);
        (cx.block_box(s.height).child(rule).into_any_element(), s.height)
    }
}
