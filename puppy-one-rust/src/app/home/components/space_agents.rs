//! `SpaceAgents`: the Cloud Agents that work in the personal space, as a
//! small stack of faces at the end of that space's heading — beside who else
//! is in the space, where their meaning is plain. Each face names its Agent
//! and when it was last active.
use super::super::discovery::{HomepageCloudAgent, format_cloud_agent_activity};
use crate::{
    app::cloud_agents_ui::compact_agent_face,
    localization::{bidi_isolate, tf},
    ui::{appearance::ActiveAppearance as _, components::tooltip, moments::paint},
};
use gpui::{prelude::*, *};
use gpui_kit::base::h_flex;
use std::time::SystemTime;

/// Faces shown before the rest are counted.
const SHOWN: usize = 4;
const FACE: f32 = 18.;
/// How far each face tucks under the one before it.
const OVERLAP: f32 = 5.;

#[derive(IntoElement)]
pub(in crate::app::home) struct SpaceAgents {
    agents: Vec<HomepageCloudAgent>,
}

impl SpaceAgents {
    pub fn new(agents: Vec<HomepageCloudAgent>) -> Self {
        Self { agents }
    }
}

impl RenderOnce for SpaceAgents {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.palette();
        let now = SystemTime::now();
        let more = self.agents.len().saturating_sub(SHOWN);
        let shown = self.agents.len().min(SHOWN) as f32;
        let stack = FACE + (shown - 1.).max(0.) * (FACE - OVERLAP);
        let faces = self
            .agents
            .iter()
            .take(SHOWN)
            .enumerate()
            .map(|(idx, agent)| {
                let tip = match format_cloud_agent_activity(agent.last_active_at.as_deref(), now) {
                    Some(time) => tf(
                        "onboarding.agents.lastActive",
                        &[
                            ("agent", bidi_isolate(&agent.name).into()),
                            ("time", time.into()),
                        ],
                    ),
                    None => agent.name.clone(),
                };
                let agent_id = agent.id.clone();
                div()
                    .id(("home-cloud-agent", idx))
                    .debug_selector(move || format!("home-cloud-agent:{agent_id}"))
                    .absolute()
                    .top_0()
                    .left(px(idx as f32 * (FACE - OVERLAP)))
                    .size(px(FACE))
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(px(5.))
                    .bg(t.panel_raised)
                    .shadow(vec![paint::ring(t.canvas, px(1.5))])
                    .tooltip(tooltip(tip))
                    .child(compact_agent_face(
                        &agent.name,
                        agent.avatar.as_deref(),
                        FACE - 4.,
                        3.,
                        t.panel_raised,
                        t,
                    ))
            });
        h_flex()
            .debug_selector(|| "home-space-agents".into())
            .flex_none()
            .items_center()
            .child(
                div()
                    .relative()
                    .flex_none()
                    .w(px(stack))
                    .h(px(FACE))
                    .children(faces),
            )
            .when(more > 0, |d| {
                d.child(
                    div()
                        .ml(px(6.))
                        .text_color(t.subtle)
                        .child(format!("+{more}")),
                )
            })
    }
}
