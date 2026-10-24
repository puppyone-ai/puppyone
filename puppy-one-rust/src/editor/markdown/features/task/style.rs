//! Tasks (`.cm-md-task-checked`, `.cm-md-task-checkbox-widget`).
use crate::editor::tokens::Tokens;
use gpui::Rgba;

#[derive(Clone, Debug, PartialEq)]
pub struct TaskStyle {
    /// `--po-md-task-completed-color` / `-decoration-color`.
    pub completed_color: Rgba,
    pub completed_decoration: Rgba,
    /// Unchecked box border: `color-mix(in srgb, var(--po-text) 72%, transparent)`.
    pub box_border: Rgba,
    /// Checked box fill and border: `--po-accent`; the check is white.
    pub checked: Rgba,
    pub check: Rgba,
    /// The box is `1.05em`; the hit target 24px; border 1.5px, radius 1.5px.
    pub box_em: f32,
    pub hit: f32,
    pub border_width: f32,
    pub radius: f32,
}

impl TaskStyle {
    pub fn resolve(t: &Tokens, _size: f32) -> Self {
        let text = t.color("--po-text");
        Self {
            completed_color: t.color("--po-md-task-completed-color"),
            completed_decoration: t.color("--po-md-task-completed-decoration-color"),
            box_border: Rgba { a: text.a * 0.72, ..text },
            checked: t.color("--po-accent"),
            check: Rgba { r: 1., g: 1., b: 1., a: 1. },
            box_em: 1.05,
            hit: 24.,
            border_width: 1.5,
            radius: 1.5,
        }
    }
}
