//! `AgentEmptyState`: the runtime's mark (which spins when clicked) and the
//! prompt cue, over a ready conversation that has nothing yet.
use super::agent_theme::AgentTheme;
use crate::localization::{Arg, bidi_isolate, t, tf};
use crate::theme;
use crate::ui::agent_brand_mark::{AgentMark, brand_image, svg_path};
use crate::ui::appearance::ActiveAppearance;
use crate::ui::components::Icon;
use gpui::{prelude::*, *};
use gpui_kit::base::v_flex;
use gpui_kit::component::Sizable as _;

#[derive(Default)]
pub struct EmptyStateView {
    /// The runtime's `iconKey` and label.
    icon_key: Option<String>,
    label: String,
    /// Clicks on the mark, each one turn.
    turns: u32,
}

impl EmptyStateView {
    pub fn set_runtime(&mut self, icon_key: Option<String>, label: String, cx: &mut Context<Self>) {
        if self.icon_key != icon_key || self.label != label {
            self.icon_key = icon_key;
            self.label = label;
            cx.notify();
        }
    }
}

impl Render for EmptyStateView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let palette = cx.palette();
        let a = AgentTheme::new(&palette);
        let turns = self.turns;
        let runtime = self.icon_key.as_deref().and_then(AgentMark::from_icon_key);
        let label = self.label.clone();
        let vector = runtime.and_then(|runtime| svg_path(runtime, palette.dark));
        // What the mark is drawn from, for tests: the theme-coloured vector,
        // a greyed brand image, or the generic bot.
        let drawn = match (vector, runtime) {
            (Some(_), _) => "vector",
            (None, Some(_)) => "image",
            (None, None) => "bot",
        };
        let selector = format!("agent-empty-logo:{drawn}:{turns}");
        let mark: AnyElement = match runtime.zip(vector) {
            Some((_, path)) => svg()
                .path(path)
                .size(px(28.))
                .text_color(a.empty_brand)
                .with_animation(
                    ElementId::NamedInteger("agent-panel-logo-spin".into(), turns as u64),
                    Animation::new(std::time::Duration::from_millis(780)).with_easing(|x: f32| {
                        let overshoot = 1. - (1. - x).powi(3);
                        overshoot + 0.04 * (std::f32::consts::PI * x).sin()
                    }),
                    move |el, delta| {
                        let angle = if turns == 0 {
                            0.
                        } else {
                            delta * std::f32::consts::TAU
                        };
                        el.with_transformation(Transformation::rotate(radians(angle)))
                    },
                )
                .into_any_element(),
            None => match runtime {
                Some(runtime) => div()
                    .opacity(0.55)
                    .child(brand_image(runtime, palette.dark, 28.).grayscale(true))
                    .into_any_element(),
                None => Icon::new("bot")
                    .with_size(px(28.))
                    .color(a.empty_brand)
                    .into_any_element(),
            },
        };
        v_flex()
            .size_full()
            .items_center()
            .justify_center()
            .gap(px(12.))
            .child(
                div()
                    .id("agent-panel-empty-logo")
                    .debug_selector(move || selector)
                    .cursor(theme::clickable_cursor())
                    .tooltip(crate::ui::components::tooltip(tf(
                        "agent.empty.spinLogo",
                        &[("agent", Arg::Text(bidi_isolate(&label)))],
                    )))
                    .on_click(cx.listener(|s, _, _, cx| {
                        s.turns += 1;
                        cx.notify();
                    }))
                    .child(mark),
            )
            .child(
                div()
                    .debug_selector(|| "agent-empty-prompt".into())
                    .text_size(px(theme::ty().left.content))
                    .text_color(a.text_subtle)
                    .child(t("agent.empty.prompt")),
            )
    }
}
