//! `AgentFilePresence` (`desktop-agent-presence/AgentFilePresence.tsx`,
//! `agent-file-presence.css`): which Agent is reading or writing a file.
//! A pill with the Agent's initials, an eye (reading) or hand (writing),
//! the Agent's name in the editor and `+N` for further claims. A running
//! claim breathes its border; a finished one lingers dimmed. It takes no
//! pointer events.
use super::Icon;
use crate::{
    theme,
    ui::{appearance::ActiveAppearance, motion::ease_in_out},
};
use gpui::{prelude::*, *};
use gpui_kit::component::Sizable as _;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PresenceVariant {
    /// Beside the pane's handle (positioned by the pane).
    Editor,
    /// In a tree row's actions.
    Explorer,
}
#[derive(IntoElement)]
pub struct FilePresence {
    id: ElementId,
    variant: PresenceVariant,
    provider: SharedString,
    reading: bool,
    active: bool,
    more: usize,
}
impl FilePresence {
    pub fn new(
        id: impl Into<ElementId>,
        variant: PresenceVariant,
        provider: impl Into<SharedString>,
    ) -> Self {
        Self {
            id: id.into(),
            variant,
            provider: provider.into(),
            reading: false,
            active: true,
            more: 0,
        }
    }
    pub fn reading(mut self, reading: bool) -> Self {
        self.reading = reading;
        self
    }
    /// `data-phase="active"`: the claim is still running.
    pub fn active(mut self, active: bool) -> Self {
        self.active = active;
        self
    }
    /// `additionalCount`.
    pub fn more(mut self, more: usize) -> Self {
        self.more = more;
        self
    }
}
/// `initials`: the first letter of each word, at most two, upper-cased.
pub fn initials(label: &str) -> String {
    label
        .split_whitespace()
        .filter_map(|word| word.chars().next())
        .take(2)
        .flat_map(char::to_uppercase)
        .collect()
}
impl RenderOnce for FilePresence {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.palette();
        let editor = self.variant == PresenceVariant::Editor;
        let accent = theme::presence_accent(t.accent, !self.reading);
        let border = theme::mix(accent, t.border, 0.42);
        let pill = div()
            .flex()
            .flex_shrink_0()
            .items_center()
            .min_w_0()
            .h(px(if editor { 24. } else { 19. }))
            .pl(px(if editor { 5. } else { 4. }))
            .pr(px(if editor { 8. } else { 4. }))
            .gap(px(if editor { 5. } else { 3. }))
            .border_1()
            .border_color(border)
            .rounded_full()
            .bg(theme::mix(t.panel, accent, 0.88))
            .text_color(t.text)
            .when(editor, |d| d.shadow(vec![theme::elevation_low(&t)]))
            .text_size(px(theme::ty().ui.micro))
            .font_weight(FontWeight::SEMIBOLD)
            .line_height(px(theme::ty().ui.micro))
            .whitespace_nowrap()
            .when(!self.active, |d| d.opacity(0.62))
            .child(
                div()
                    .flex()
                    .flex_shrink_0()
                    .size(px(16.))
                    .items_center()
                    .justify_center()
                    .rounded_full()
                    .bg(accent)
                    .text_color(theme::on_solid())
                    .text_size(px(theme::ty().ui.glyph))
                    .font_weight(FontWeight(750.))
                    .child(initials(&self.provider)),
            )
            .child(
                Icon::new(if self.reading { "eye" } else { "hand" })
                    .with_size(px(if editor { 12. } else { 11. }))
                    .stroke(1.9)
                    .color(t.text),
            )
            .when(editor, |d| {
                d.child(
                    div()
                        .min_w_0()
                        .max_w(px(112.))
                        .truncate()
                        .child(self.provider.clone()),
                )
            })
            .when(self.more > 0, |d| {
                d.child(div().text_color(t.muted).child(format!("+{}", self.more)))
            });
        if self.active && !cx.reduce_motion() {
            // `desktop-agent-presence-breathe`: the border reaches the accent
            // halfway through each 1.5s cycle, easing in and out.
            pill.with_animation(
                self.id,
                Animation::new(std::time::Duration::from_millis(1500)).repeat(),
                move |pill, delta| {
                    let segment = if delta < 0.5 {
                        delta * 2.
                    } else {
                        (1. - delta) * 2.
                    };
                    pill.border_color(theme::mix(accent, border, ease_in_out(segment)))
                },
            )
            .into_any_element()
        } else {
            pill.into_any_element()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    #[test]
    fn initials_and_easing_follow_the_product() {
        assert_eq!(initials("Claude Code"), "CC");
        assert_eq!(initials("Cursor Agent CLI"), "CA");
        assert_eq!(initials("codex"), "C");
        assert!((ease_in_out(0.5) - 0.5).abs() < 1e-3);
        assert!(ease_in_out(0.25) < 0.25 && ease_in_out(0.75) > 0.75);
        assert!(ease_in_out(0.).abs() < 1e-6 && (ease_in_out(1.) - 1.).abs() < 1e-6);
    }
}
