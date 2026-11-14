//! `AgentPanelStatus`, `AgentEmptyState`, `AgentRuntimeLauncher`,
//! `AgentRecoverySurface`, `AgentProviderActivities` and the dock region of
//! `AgentChatTabPanel`.
use super::super::agent_chat_view_model::AgentChatViewModel;
use super::super::agent_error_presentation::present_agent_error;
use super::super::agent_panel_presentation::present_runtime_readiness;
use super::super::agent_theme::AgentTheme;
use super::AgentChatTabPanel;
use super::elements::{ButtonTone, agent_button};
use crate::agent::contract::dto::TurnRecovery;
use crate::features::desktop_agent::application::agent_controller_state::{
    AgentControllerPhase, AgentControllerState, AgentDisplayRecoveryPolicy,
    AgentDisplayRecoveryStage,
};
use crate::features::desktop_agent::domain::agent_backend_routing::is_selectable_agent_backend;
use crate::localization::{Arg, bidi_isolate, t, tf};
use crate::theme;
use crate::ui::agent_brand_mark::{AgentMark, brand_image};
use crate::ui::appearance::ActiveAppearance;
use crate::ui::components::Icon;
use gpui::{prelude::*, *};
use gpui_kit::base::{h_flex, v_flex};
use gpui_kit::component::Sizable as _;

impl AgentChatTabPanel {
    /// `AgentPanelStatus`.
    pub(super) fn render_status(
        &mut self,
        state: &AgentControllerState,
        view: &AgentChatViewModel,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let palette = cx.palette();
        let a = AgentTheme::new(&palette);
        let m = theme::ty();
        let runtime_label = view.runtime.runtime_label.clone();
        let error = present_agent_error(view.panel_error.as_ref());
        let readiness = present_runtime_readiness(view.readiness.as_ref(), &runtime_label);
        let failed = view.failed;
        let runtime_exited = state.phase == AgentControllerPhase::RuntimeExited;
        let detail = if failed {
            error.as_ref().and_then(|e| e.detail.clone())
        } else {
            Some(readiness.detail.clone())
        };
        let recovery = state.display_recovery;
        let reconnecting = recovery.is_some_and(|r| {
            r.policy == AgentDisplayRecoveryPolicy::Automatic
                && r.stage == AgentDisplayRecoveryStage::Reconnecting
        });
        let display_failure = (recovery.is_none()
            && view
                .panel_error
                .as_ref()
                .is_some_and(|e| e.code == "event-gap"))
            || recovery.is_some_and(|r| {
                matches!(
                    r.policy,
                    AgentDisplayRecoveryPolicy::Paused | AgentDisplayRecoveryPolicy::Exhausted
                ) || matches!(
                    r.stage,
                    AgentDisplayRecoveryStage::Degraded | AgentDisplayRecoveryStage::ActionRequired
                )
            });
        let mut region = v_flex().flex_shrink_0().px(px(12.)).pt(px(10.)).gap(px(6.));
        let card = |heading: String,
                    description: String,
                    details: Option<AnyElement>,
                    actions: Vec<AnyElement>| {
            h_flex()
                .w_full()
                .items_start()
                .gap(px(8.))
                .px(px(12.))
                .py(px(10.))
                .rounded(px(8.))
                .border_1()
                .border_color(a.border_subtle)
                .bg(a.control_surface)
                .child(
                    Icon::new("circle-alert")
                        .with_size(px(14.))
                        .stroke(1.8)
                        .color(a.text_muted),
                )
                .child(
                    v_flex()
                        .flex_1()
                        .min_w_0()
                        .gap(px(2.))
                        .child(
                            div()
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(a.text)
                                .child(heading),
                        )
                        .child(
                            div()
                                .text_size(px(m.right.caption))
                                .text_color(a.text_muted)
                                .whitespace_normal()
                                .child(description),
                        )
                        .children(details),
                )
                .child(
                    h_flex()
                        .flex_shrink_0()
                        .gap(px(4.))
                        .flex_wrap()
                        .children(actions),
                )
        };
        if view.unavailable || (failed && !display_failure) {
            let heading = if failed {
                tf(
                    if runtime_exited {
                        "agent.readiness.sessionAttention"
                    } else {
                        "agent.readiness.sessionFailed"
                    },
                    &[("agent", Arg::Text(bidi_isolate(&runtime_label)))],
                )
            } else {
                readiness.heading.clone()
            };
            let description = if failed {
                error
                    .as_ref()
                    .map(|e| e.summary.clone())
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| t("agent.readiness.sessionRecovery").into())
            } else {
                detail.clone().unwrap_or_default()
            };
            let open = self.diagnostics_open;
            let mut diagnostics: Vec<String> = Vec::new();
            if !failed {
                diagnostics.push(tf(
                    "agent.readiness.statusCode",
                    &[("code", Arg::Text(readiness.code.clone()))],
                ));
                if let Some(diagnostic) = readiness.diagnostic.as_ref() {
                    diagnostics.push(tf(
                        "agent.readiness.diagnostic",
                        &[("detail", Arg::Text(bidi_isolate(diagnostic)))],
                    ));
                }
            } else if let Some(detail) = detail.clone() {
                diagnostics.push(detail);
            }
            let details = (!failed || detail.is_some()).then(|| {
                v_flex()
                    .mt(px(4.))
                    .child(
                        h_flex()
                            .id("agent-diagnostics")
                            .gap(px(4.))
                            .text_size(px(m.right.caption))
                            .text_color(a.text_subtle)
                            .cursor(theme::clickable_cursor())
                            .child(
                                Icon::new(if open {
                                    "chevron-down"
                                } else {
                                    "chevron-right"
                                })
                                .with_size(px(12.))
                                .color(a.text_subtle),
                            )
                            .child(t("agent.header.diagnostics"))
                            .on_click(cx.listener(|s, _, _, cx| {
                                s.diagnostics_open = !s.diagnostics_open;
                                cx.notify();
                            })),
                    )
                    .when(open, |d| {
                        d.children(diagnostics.iter().map(|line| {
                            div()
                                .mt(px(2.))
                                .text_size(px(m.right.caption))
                                .text_color(a.text_subtle)
                                .whitespace_normal()
                                .child(line.clone())
                        }))
                    })
                    .into_any_element()
            });
            let retry = agent_button(
                "agent-readiness-retry",
                t(if runtime_exited {
                    "agent.readiness.reconnect"
                } else {
                    "common.action.retry"
                })
                .into(),
                ButtonTone::Secondary,
                false,
                &a,
            )
            .on_click(cx.listener(|s, _, _, cx| {
                drop(s.controller.initialize(true));
                cx.notify();
            }));
            region = region.child(card(
                heading,
                description,
                details,
                vec![retry.into_any_element()],
            ));
        }
        if let Some(error) = error.as_ref()
            && !view.unavailable
            && !failed
            && !display_failure
            && recovery.is_none()
        {
            region = region.child(
                h_flex()
                    .items_start()
                    .gap(px(8.))
                    .px(px(12.))
                    .py(px(8.))
                    .rounded(px(8.))
                    .border_1()
                    .border_color(theme::mix(palette.danger, palette.divider, 0.34))
                    .bg(theme::alpha(palette.danger, 0.07))
                    .text_size(px(m.right.caption))
                    .child(
                        Icon::new("circle-alert")
                            .with_size(px(14.))
                            .color(palette.danger),
                    )
                    .child(
                        v_flex()
                            .flex_1()
                            .min_w_0()
                            .child(div().whitespace_normal().child(error.summary.clone()))
                            .children(error.detail.clone().map(|detail| {
                                div()
                                    .text_color(a.text_subtle)
                                    .whitespace_normal()
                                    .child(detail)
                            })),
                    ),
            );
        }
        if reconnecting && state.stop_request.is_none() {
            region = region.child(
                h_flex()
                    .gap(px(6.))
                    .text_size(px(m.right.caption))
                    .text_color(a.text_subtle)
                    .child(
                        Icon::new("refresh-cw")
                            .with_size(px(13.))
                            .color(a.text_subtle),
                    )
                    .child(t("agent.lifecycle.reconnecting")),
            );
        }
        if display_failure || state.stop_request.is_some() {
            let description_key = match recovery.map(|r| r.policy) {
                Some(AgentDisplayRecoveryPolicy::Paused) => "agent.lifecycle.paused",
                Some(AgentDisplayRecoveryPolicy::Exhausted) => "agent.lifecycle.exhausted",
                _ if display_failure => "agent.lifecycle.retryProgress",
                _ => "agent.lifecycle.stopUnconfirmed",
            };
            let description = tf(
                description_key,
                &[
                    (
                        "attempt",
                        Arg::Number(recovery.map_or(0, |r| r.attempt as i64)),
                    ),
                    (
                        "maximum",
                        Arg::Number(recovery.map_or(5, |r| r.max_attempts as i64)),
                    ),
                ],
            );
            let mut actions: Vec<AnyElement> = Vec::new();
            if display_failure {
                actions.push(
                    agent_button(
                        "agent-retry-display",
                        t("agent.lifecycle.retryDisplay").into(),
                        ButtonTone::Primary,
                        false,
                        &a,
                    )
                    .on_click(cx.listener(|s, _, _, cx| {
                        drop(s.controller.retry_display_recovery());
                        cx.notify();
                    }))
                    .into_any_element(),
                );
                if recovery.is_none_or(|r| r.policy == AgentDisplayRecoveryPolicy::Automatic) {
                    actions.push(
                        agent_button(
                            "agent-pause-display",
                            t("agent.lifecycle.pauseDisplay").into(),
                            ButtonTone::Quiet,
                            false,
                            &a,
                        )
                        .on_click(cx.listener(|s, _, _, cx| {
                            s.controller.pause_display_recovery();
                            cx.notify();
                        }))
                        .into_any_element(),
                    );
                }
            }
            actions.push(
                agent_button(
                    "agent-manage-executions",
                    t("agent.lifecycle.manageExecutions").into(),
                    ButtonTone::Secondary,
                    false,
                    &a,
                )
                .on_click(cx.listener(|s, _, _, _| {
                    drop(s.controller.manage_executions());
                }))
                .into_any_element(),
            );
            region = region.child(card(
                t(if display_failure {
                    "agent.lifecycle.displayStale"
                } else {
                    "agent.lifecycle.stopPending"
                })
                .into(),
                description,
                None,
                actions,
            ));
        }
        region.into_any_element()
    }

    /// `AgentRuntimeLauncher`: choosing a row establishes the harness
    /// boundary.
    pub(super) fn render_launcher(
        &mut self,
        view: &AgentChatViewModel,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let palette = cx.palette();
        let a = AgentTheme::new(&palette);
        let m = theme::ty();
        let mut list = v_flex().gap(px(2.));
        for entry in &view.runtime.agent_runtimes {
            let id = entry.descriptor.id.clone();
            let name = entry.descriptor.display_name.clone();
            let icon_key = entry
                .descriptor
                .icon_key
                .clone()
                .unwrap_or_else(|| id.clone());
            let ready = is_selectable_agent_backend(entry);
            let runtime_id = id.clone();
            list = list.child(
                h_flex()
                    .id(SharedString::from(format!("agent-launch-{id}")))
                    .h(px(theme::control()))
                    .px(px(8.))
                    .gap(px(8.))
                    .rounded(px(6.))
                    .cursor(theme::clickable_cursor())
                    .hover(move |s| s.bg(a.row_hover))
                    .on_click(cx.listener(move |s, _, _, cx| {
                        s.select_routed_runtime(runtime_id.clone(), cx);
                        cx.notify();
                    }))
                    .children(
                        AgentMark::from_icon_key(&icon_key)
                            .map(|runtime| brand_image(runtime, palette.dark, 16.)),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .truncate()
                            .text_color(a.text)
                            .child(name),
                    )
                    .when(!ready, |d| {
                        d.child(
                            Icon::new("circle-alert")
                                .with_size(px(13.))
                                .stroke(1.7)
                                .color(a.text_subtle),
                        )
                    }),
            );
        }
        if view.runtime.agent_runtimes.is_empty() {
            list = list.child(
                div()
                    .px(px(8.))
                    .py(px(12.))
                    .text_color(a.text_subtle)
                    .child(t("agent.launcher.noneAvailable")),
            );
        }
        v_flex()
            .size_full()
            .items_center()
            .justify_center()
            .child(
                v_flex()
                    .w(px(280.))
                    .gap(px(8.))
                    .child(
                        h_flex()
                            .px(px(8.))
                            .gap(px(6.))
                            .text_size(px(m.right.caption))
                            .text_color(a.text_subtle)
                            .child(div().flex_1().child(t("agent.launcher.title")))
                            .child(
                                div()
                                    .id("agent-launcher-refresh")
                                    .size(px(22.))
                                    .rounded(px(5.))
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .cursor(theme::clickable_cursor())
                                    .hover(move |s| s.bg(a.row_hover))
                                    .tooltip(crate::ui::components::tooltip(t(
                                        "agent.launcher.scanAgain",
                                    )))
                                    .on_click(cx.listener(|s, _, _, cx| {
                                        drop(s.controller.initialize(true));
                                        cx.notify();
                                    }))
                                    .child(
                                        Icon::new("refresh-cw")
                                            .with_size(px(12.))
                                            .stroke(1.7)
                                            .color(a.text_subtle),
                                    ),
                            ),
                    )
                    .child(list),
            )
            .into_any_element()
    }

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
            .flex_shrink_0()
            .pt(px(12.))
            .px(px(12.))
            .pb(px(12.))
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
                    .text_size(px(m.right.caption))
                    .text_color(a.text_subtle)
                    .child(t("settings.modelConnections.readOnly")),
            );
        }
        if let Some(model) = self.pending_connection_model.clone() {
            dock = dock.child(
                v_flex()
                    .gap(px(8.))
                    .px(px(12.))
                    .py(px(10.))
                    .rounded(px(8.))
                    .border_1()
                    .border_color(a.blocking_border)
                    .bg(a.blocking_surface)
                    .child(
                        div()
                            .whitespace_normal()
                            .child(t("settings.modelConnections.switchWarning")),
                    )
                    .child(
                        h_flex()
                            .justify_end()
                            .gap(px(4.))
                            .child(
                                agent_button(
                                    "agent-connection-cancel",
                                    t("common.action.cancel").into(),
                                    ButtonTone::Quiet,
                                    false,
                                    &a,
                                )
                                .on_click(cx.listener(
                                    |s, _, _, cx| {
                                        s.pending_connection_model = None;
                                        s.refresh_views();
                                        cx.notify();
                                    },
                                )),
                            )
                            .child(
                                agent_button(
                                    "agent-connection-new",
                                    t("settings.modelConnections.newConversation").into(),
                                    ButtonTone::Primary,
                                    false,
                                    &a,
                                )
                                .on_click(cx.listener(
                                    move |s, _, _, cx| {
                                        s.pending_connection_model = None;
                                        s.refresh_views();
                                        drop(s.controller.start_new_model_connection(&model));
                                        cx.notify();
                                    },
                                )),
                            ),
                    ),
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
            h_flex()
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
