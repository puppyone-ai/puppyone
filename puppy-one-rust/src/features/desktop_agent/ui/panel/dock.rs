//! `desktop-agent-dock-region`: compute, read-only and model-connection
//! notices, the blocking docks, `AgentRecoverySurface`, the provider's notices
//! and the composer.
use super::super::agent_chat_view_model::AgentChatViewModel;
use super::super::agent_theme::AgentTheme;
use super::super::elements::{ButtonTone, agent_button};
use super::AgentChatTabPanel;
use crate::agent::contract::dto::TurnRecovery;
use crate::features::desktop_agent::application::agent_controller_state::AgentControllerState;
use crate::localization::{Arg, bidi_isolate, t, tf};
use crate::theme;
use crate::ui::appearance::ActiveAppearance;
use crate::ui::components::Icon;
use gpui::{prelude::*, *};
use gpui_kit::base::{h_flex, v_flex};
use gpui_kit::component::Sizable as _;

impl AgentChatTabPanel {
    /// `desktop-agent-dock-region`: blocking interactions, recovery, notices
    /// and the composer.
    pub(super) fn render_dock(
        &mut self,
        state: &AgentControllerState,
        view: &AgentChatViewModel,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let palette = cx.palette();
        let a = AgentTheme::new(&palette);
        let m = theme::ty();
        let mut dock = v_flex()
            .debug_selector(|| "agent-dock".into())
            .flex_shrink_0()
            .pt(px(8.))
            .px(px(8.))
            .pb(px(10.))
            .gap(px(8.));
        if view.model_connections {
            let compute = self.compute_view(
                &view.runtime.runtime_models,
                state.selected_model.as_deref(),
            );
            dock = dock.child(self.render_compute(
                &compute,
                state.selected_model.as_deref(),
                view.compute_disabled,
                cx,
            ));
        }
        if view.read_only {
            dock = dock.child(
                div()
                    .px(px(8.))
                    .text_size(px(m.right.caption))
                    .text_color(a.text_subtle)
                    .child(t("settings.modelConnections.readOnly")),
            );
        }
        if view.approval.is_some() || view.question.is_some() {
            dock = dock.child(self.docks.clone());
        }
        if let Some(recovery) = view.degraded_recovery.clone() {
            dock = dock.child(self.render_recovery_surface(
                &recovery.turn_id,
                &recovery.recovery,
                view,
                cx,
            ));
        }
        if !self.notices.read(cx).is_empty() {
            dock = dock.child(self.notices.clone());
        }
        dock.child(self.composer.clone()).into_any_element()
    }

    /// `AgentRecoverySurface`.
    fn render_recovery_surface(
        &mut self,
        turn_id: &str,
        recovery: &TurnRecovery,
        view: &AgentChatViewModel,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let palette = cx.palette();
        let a = AgentTheme::new(&palette);
        let m = theme::ty();
        let open = self.recovery_details_open;
        let submitting = view.submission_pending;
        let runtime_label = view.runtime.runtime_label.clone();
        let turn = turn_id.to_string();
        let detail = |label: &str, value: String| {
            let selector = format!("agent-recovery-detail:{value}");
            h_flex()
                .debug_selector(move || selector)
                .gap(px(8.))
                .text_size(px(m.right.caption))
                .child(
                    div()
                        .w(px(110.))
                        .flex_shrink_0()
                        .text_color(a.text_subtle)
                        .child(t(label)),
                )
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .text_color(a.text_muted)
                        .child(value),
                )
        };
        v_flex()
            .gap(px(8.))
            .px(px(12.))
            .py(px(10.))
            .rounded(px(8.))
            .border_1()
            .border_color(a.blocking_border)
            .bg(a.blocking_surface)
            .child(
                h_flex()
                    .gap(px(8.))
                    .child(
                        Icon::new("circle-alert")
                            .with_size(px(15.))
                            .color(palette.warning),
                    )
                    .child(
                        div()
                            .debug_selector(|| "agent-recovery-degraded".into())
                            .font_weight(FontWeight::MEDIUM)
                            .child(t("agent.recovery.degraded.title")),
                    ),
            )
            .child(
                div()
                    .text_size(px(m.right.caption))
                    .text_color(a.text_muted)
                    .whitespace_normal()
                    .child(tf(
                        "agent.recovery.degraded.description",
                        &[("agent", Arg::Text(bidi_isolate(&runtime_label)))],
                    )),
            )
            .when(open, |d| {
                d.child(
                    v_flex()
                        .gap(px(4.))
                        .child(detail(
                            "agent.recovery.degraded.code",
                            recovery.code.clone(),
                        ))
                        .child(detail(
                            "agent.recovery.degraded.scope",
                            t(&format!(
                                "agent.recovery.degraded.scope.{}",
                                recovery.failure_scope
                            ))
                            .into(),
                        ))
                        .child(detail(
                            "agent.recovery.degraded.transport",
                            t(&format!(
                                "agent.recovery.degraded.transport.{}",
                                recovery.transport_health
                            ))
                            .into(),
                        ))
                        .child(detail(
                            "agent.recovery.degraded.sideEffects",
                            t(&format!(
                                "agent.recovery.degraded.sideEffects.{}",
                                recovery.side_effects
                            ))
                            .into(),
                        )),
                )
            })
            .child(
                h_flex()
                    .justify_end()
                    .gap(px(4.))
                    .child(
                        agent_button(
                            "agent-recovery-details",
                            t(if open {
                                "agent.recovery.degraded.hideDetails"
                            } else {
                                "agent.recovery.degraded.details"
                            })
                            .into(),
                            ButtonTone::Secondary,
                            false,
                            &a,
                        )
                        .debug_selector(|| "agent-recovery-details".into())
                        .on_click(cx.listener(|s, _, _, cx| {
                            s.recovery_details_open = !s.recovery_details_open;
                            cx.notify();
                        })),
                    )
                    .child(
                        agent_button(
                            "agent-recovery-continue",
                            t(if submitting {
                                "agent.recovery.degraded.continuing"
                            } else {
                                "agent.recovery.degraded.continue"
                            })
                            .into(),
                            ButtonTone::Primary,
                            submitting,
                            &a,
                        )
                        .debug_selector(|| "agent-recovery-continue".into())
                        .on_click(cx.listener(move |s, _, _, cx| {
                            drop(s.controller.continue_from_recovery(
                                &turn,
                                t("agent.recovery.degraded.prompt"),
                            ));
                            cx.notify();
                        })),
                    ),
            )
            .into_any_element()
    }
}
