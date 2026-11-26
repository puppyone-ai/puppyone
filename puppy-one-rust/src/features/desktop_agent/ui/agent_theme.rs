//! Agent Chat theme contract (`desktop-agent/ui/styles/theme.css`): semantic
//! roles derived from the product theme. Chat lives in the right sidebar, so
//! `--agent-canvas` is `--po-surface-auxiliary`.
use crate::theme::{Theme, alpha, mix};
use gpui::{BoxShadow, Rgba, point, px};

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
    pub composer_surface: Rgba,
    pub composer_border: Rgba,
    pub composer_border_focus: Rgba,
    pub composer_focus_halo: Rgba,
    pub composer_highlight: Rgba,
    pub composer_placeholder: Rgba,
    pub user_message_surface: Rgba,
    pub row_hover: Rgba,
    pub tool_action: Rgba,
    pub tool_active: Rgba,
    /// One step line: the quiet glyph and the readable object.
    pub tool_glyph: Rgba,
    pub tool_subject: Rgba,
    pub evidence_rail: Rgba,
    pub inline_code_surface: Rgba,
    pub inline_code_border: Rgba,
    pub code_surface: Rgba,
    /// `--agent-code-header-surface`: 30% of the control surface.
    pub code_header_surface: Rgba,
    pub table_header_surface: Rgba,
    pub table_alternate_surface: Rgba,
    pub markdown_disclosure_surface: Rgba,
    pub empty_brand: Rgba,
    pub diff_added_text: Rgba,
    pub diff_removed_text: Rgba,
    pub blocking_surface: Rgba,
    pub blocking_border: Rgba,
    pub blocking_icon_surface: Rgba,
    pub blocking_icon: Rgba,
    pub accent: Rgba,
    pub action_disabled_text: Rgba,
    pub action_disabled_surface: Rgba,
    pub primary_hover: Rgba,
    /// `DotsLoader tone="neutral"` (`--po-text-muted`).
    pub loader: Rgba,
    /// `--agent-launcher-*` (history browser search and permission button).
    pub launcher_placeholder_surface: Rgba,
    pub launcher_placeholder_text: Rgba,
    pub launcher_focus_border: Rgba,
}

impl AgentTheme {
    pub fn new(t: &Theme) -> Self {
        let canvas = t.auxiliary();
        let text = t.text;
        let text_muted = t.sidebar_text;
        let border_subtle = t.divider;
        let control_surface = mix(t.header, t.panel_raised, 0.82);
        Self {
            canvas,
            text,
            text_muted,
            text_subtle: t.subtle,
            border: t.border_strong,
            border_subtle,
            control_surface,
            code_header_surface: crate::theme::alpha(control_surface, 0.3),
            // Composer floats distinctly above the sidebar surface with crisp
            // edges and focus halo; sent prompts stay quiet and borderless.
            composer_surface: if t.dark {
                mix(text, t.panel_raised, 0.04)
            } else {
                t.panel_raised
            },
            composer_border: alpha(text, if t.dark { 0.13 } else { 0.17 }),
            composer_border_focus: alpha(text, if t.dark { 0.28 } else { 0.34 }),
            composer_focus_halo: alpha(text, if t.dark { 0.055 } else { 0.06 }),
            composer_highlight: crate::theme::composer_highlight(t.dark),
            composer_placeholder: mix(text_muted, t.subtle, 0.52),
            user_message_surface: alpha(text, if t.dark { 0.04 } else { 0.045 }),
            row_hover: alpha(t.hover, 0.86),
            // Tool steps are quiet process logs beneath the conversation:
            // quiet icon, softly muted verb, and an even lighter subtle
            // command/subject on the right (all sharpening on hover).
            tool_action: mix(text_muted, t.subtle, 0.45),
            tool_active: mix(text, text_muted, 0.65),
            tool_glyph: t.subtle,
            tool_subject: t.subtle,
            evidence_rail: t.border_strong,
            inline_code_surface: mix(text, canvas, 0.08),
            inline_code_border: mix(text, canvas, 0.14),
            code_surface: mix(control_surface, canvas, 0.88),
            table_header_surface: mix(control_surface, canvas, 0.76),
            table_alternate_surface: alpha(control_surface, 0.28),
            markdown_disclosure_surface: alpha(control_surface, 0.36),
            empty_brand: mix(t.subtle, canvas, 0.64),
            diff_added_text: mix(t.success, text, 0.74),
            diff_removed_text: mix(t.danger, text, 0.72),
            blocking_surface: mix(control_surface, canvas, 0.52),
            blocking_border: border_subtle,
            blocking_icon_surface: alpha(t.warning, 0.1),
            blocking_icon: mix(t.warning, text_muted, 0.62),
            accent: t.accent,
            action_disabled_text: t.text_disabled,
            action_disabled_surface: alpha(text, if t.dark { 0.075 } else { 0.055 }),
            primary_hover: mix(text, canvas, 0.88),
            loader: t.muted,
            launcher_placeholder_surface: alpha(control_surface, 0.64),
            launcher_placeholder_text: alpha(t.subtle, 0.82),
            launcher_focus_border: mix(t.focus_ring, border_subtle, 0.58),
        }
    }

    /// Elevated shadow stack shared by the chat capsule and the L1 launcher
    /// hero composer: 1px top inset sheen in dark mode, a soft 3px outer focus
    /// halo when focused, and calm elevation beneath.
    pub fn composer_shadows(&self, dark: bool, focused: bool) -> Vec<BoxShadow> {
        let mut shadows = Vec::with_capacity(4);
        if dark {
            shadows.push(BoxShadow {
                color: self.composer_highlight.into(),
                offset: point(px(0.), px(1.)),
                blur_radius: px(0.),
                spread_radius: px(0.),
                inset: true,
            });
        }
        if focused {
            shadows.push(BoxShadow {
                color: self.composer_focus_halo.into(),
                offset: point(px(0.), px(0.)),
                blur_radius: px(0.),
                spread_radius: px(3.),
                inset: false,
            });
        }
        shadows.extend(crate::theme::composer_elevation(dark));
        shadows
    }
}

#[cfg(test)]
mod tests {
    use super::AgentTheme;
    use crate::theme::pack_theme;

    #[test]
    fn composer_surface_respects_dark_and_light_polarity() {
        let dark = pack_theme("default-neutral", true);
        let dark_agent = AgentTheme::new(&dark);
        let dark_lum = (dark_agent.composer_surface.r
            + dark_agent.composer_surface.g
            + dark_agent.composer_surface.b)
            / 3.;
        assert!(
            dark_lum < 0.25,
            "dark composer surface must stay dark, got {:?}",
            dark_agent.composer_surface
        );
        assert!(
            dark_lum > dark.auxiliary().r,
            "dark composer surface should lift subtly above the dark sidebar"
        );

        let light = pack_theme("default-neutral", false);
        let light_agent = AgentTheme::new(&light);
        let light_lum = (light_agent.composer_surface.r
            + light_agent.composer_surface.g
            + light_agent.composer_surface.b)
            / 3.;
        assert!(
            light_lum > 0.90,
            "light composer surface must stay bright, got {:?}",
            light_agent.composer_surface
        );
    }
}
