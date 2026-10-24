//! Agent Chat theme contract (`desktop-agent/ui/styles/theme.css`): semantic
//! roles derived from the product theme. Chat lives in the right sidebar, so
//! `--agent-canvas` is `--po-surface-auxiliary`.
use crate::theme::{Theme, alpha, mix};
use gpui::Rgba;

#[derive(Clone, Copy)]
pub struct AgentTheme {
    pub canvas: Rgba,
    pub text: Rgba,
    /// `--agent-text-muted` (`--desktop-sidebar-text-color`).
    pub text_muted: Rgba,
    pub text_subtle: Rgba,
    /// `--agent-border` (`--po-border-strong`).
    pub border: Rgba,
    /// `--agent-border-subtle` (`--po-divider`).
    pub border_subtle: Rgba,
    pub control_surface: Rgba,
    pub report_surface: Rgba,
    pub composer_surface: Rgba,
    pub user_message_surface: Rgba,
    pub user_message_border: Rgba,
    pub row_hover: Rgba,
    pub tool_action: Rgba,
    pub tool_active: Rgba,
    pub evidence_rail: Rgba,
    pub question_surface: Rgba,
    pub edge_fade: Rgba,
    pub inline_code_surface: Rgba,
    pub inline_code_border: Rgba,
    pub code_surface: Rgba,
    pub table_header_surface: Rgba,
    pub table_alternate_surface: Rgba,
    pub markdown_disclosure_surface: Rgba,
    pub empty_brand: Rgba,
    pub empty_brand_hover: Rgba,
    pub diff_added_text: Rgba,
    pub diff_removed_text: Rgba,
    pub blocking_surface: Rgba,
    pub blocking_border: Rgba,
    pub blocking_attention_border: Rgba,
    pub blocking_icon_surface: Rgba,
    pub blocking_icon: Rgba,
    pub accent: Rgba,
    pub accent_soft: Rgba,
    pub focus_ring: Rgba,
    pub action_disabled_text: Rgba,
    pub action_disabled_surface: Rgba,
    pub primary_hover: Rgba,
    pub config_surface: Rgba,
    pub config_surface_hover: Rgba,
    pub config_border: Rgba,
    /// `DotsLoader tone="neutral"` (`--po-text-muted`).
    pub loader: Rgba,
}

impl AgentTheme {
    pub fn new(t: &Theme) -> Self {
        let canvas = t.auxiliary();
        let text = t.text;
        let text_muted = t.sidebar_text;
        let border_subtle = t.divider;
        let control_surface = mix(t.header, t.panel_raised, 0.82);
        let report_surface = mix(t.panel_raised, t.canvas, 0.9);
        Self {
            canvas,
            text,
            text_muted,
            text_subtle: t.subtle,
            border: t.border_strong,
            border_subtle,
            control_surface,
            report_surface,
            composer_surface: t.active,
            user_message_surface: t.hover,
            user_message_border: alpha(border_subtle, 0.62),
            row_hover: alpha(t.hover, 0.86),
            tool_action: text_muted,
            tool_active: mix(text, text_muted, 0.78),
            evidence_rail: t.border_strong,
            question_surface: alpha(report_surface, 0.94),
            edge_fade: alpha(canvas, 0.78),
            inline_code_surface: mix(text, canvas, 0.08),
            inline_code_border: mix(text, canvas, 0.14),
            code_surface: mix(control_surface, canvas, 0.88),
            table_header_surface: mix(control_surface, canvas, 0.76),
            table_alternate_surface: alpha(control_surface, 0.28),
            markdown_disclosure_surface: alpha(control_surface, 0.36),
            empty_brand: mix(t.subtle, canvas, 0.64),
            empty_brand_hover: mix(text_muted, canvas, 0.76),
            diff_added_text: mix(t.success, text, 0.74),
            diff_removed_text: mix(t.danger, text, 0.72),
            blocking_surface: mix(control_surface, canvas, 0.52),
            blocking_border: border_subtle,
            blocking_attention_border: mix(t.warning, border_subtle, 0.48),
            blocking_icon_surface: alpha(t.warning, 0.1),
            blocking_icon: mix(t.warning, text_muted, 0.62),
            accent: t.accent,
            accent_soft: alpha(t.accent, 0.16),
            focus_ring: alpha(t.accent, 0.68),
            action_disabled_text: alpha(text, 0.48),
            action_disabled_surface: alpha(text, 0.14),
            primary_hover: mix(text, canvas, 0.88),
            config_surface: t.control,
            config_surface_hover: t.control_hover,
            config_border: t.border_subtle,
            loader: t.muted,
        }
    }
}
