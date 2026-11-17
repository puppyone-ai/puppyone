//! Horizontal rules (`.cm-md-hr-widget`: a 37px box with a centred 1px
//! rule).
use crate::editor::tokens::Tokens;
use gpui::Rgba;

#[derive(Clone, Debug, PartialEq)]
pub struct RuleStyle {
    /// `--po-md-rule-color`.
    pub color: Rgba,
    /// `.cm-md-hr-widget { height: 37px }`.
    pub height: f32,
    pub thickness: f32,
}

impl RuleStyle {
    pub fn resolve(t: &Tokens, _size: f32) -> Self {
        Self {
            color: t.color("--po-md-rule-color"),
            height: 37.,
            thickness: 1.,
        }
    }
}
