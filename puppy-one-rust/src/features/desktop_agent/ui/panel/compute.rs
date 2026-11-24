//! `built-in-agent/BuiltInAgentCompute.tsx`: Chat selects a ready route;
//! Settings exclusively owns connection configuration. Without Payments,
//! PuppyOne's own compute is not a route at all and the only remaining step
//! is the user's own connection.
use super::super::elements::{ButtonTone, agent_button};
use super::{AgentChatPanelEvent, AgentChatTabPanel};
use crate::agent::contract::dto::Model;
use crate::features::desktop_agent::domain::agent_session_controls::{
    AgentSessionControl, AgentSessionControlId, AgentSessionControlOption,
};
pub(crate) use crate::features::desktop_agent::infrastructure::compute::{
    ComputeSnapshot, ManagedCompute, read_compute_snapshot,
};
use crate::features::desktop_agent::ui::agent_theme::AgentTheme;
use crate::localization::t;
use crate::theme;
use crate::ui::appearance::ActiveAppearance;
use crate::ui::components::Icon;
use gpui::{prelude::*, *};
use gpui_kit::base::{h_flex, v_flex};
use gpui_kit::component::Sizable as _;

/// The dock's derived state.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ComputeView {
    pub ready: bool,
    /// `ComputeAccessRequired`.
    pub access_required: Option<&'static str>,
    pub offered: Vec<Model>,
    pub source: &'static str,
    pub own_compute_only: bool,
    pub show_picker: bool,
    pub setup_prompt: bool,
    pub paid_prompt: bool,
    pub connecting: bool,
    pub managed: Option<ManagedCompute>,
}

/// The dock's policy over `models` (the runtime's) and the snapshot.
pub(crate) fn derive_compute(
    snapshot: Option<&ComputeSnapshot>,
    models: &[Model],
    payments: bool,
    selected_model: Option<&str>,
    access_prompt: bool,
) -> ComputeView {
    let source_of = |model: &Model| {
        model
            .connection_id
            .as_deref()
            .and_then(|id| snapshot.and_then(|s| s.sources.get(id)).copied())
    };
    let ready_models: Vec<&Model> = models.iter().filter(|m| source_of(m).is_some()).collect();
    let is_managed = |model: &Model| source_of(model) == Some("managed");
    let current = ready_models
        .iter()
        .find(|m| selected_model == Some(m.model.as_str()));
    let selected = models
        .iter()
        .find(|m| selected_model == Some(m.model.as_str()));
    let current_connection = selected.and_then(source_of);
    let source = current_connection.unwrap_or(if payments { "managed" } else { "api" });
    // Paid compute is the one route an install may not be allowed to offer.
    let managed = if payments {
        snapshot.and_then(|s| s.managed.clone())
    } else {
        None
    };
    let own: Vec<Model> = ready_models
        .iter()
        .filter(|m| !is_managed(m))
        .map(|m| (*m).clone())
        .collect();
    let offered: Vec<Model> = if payments {
        ready_models.iter().map(|m| (*m).clone()).collect()
    } else {
        own
    };
    let own_compute_only = !payments && (source == "managed" || current_connection.is_none());
    let ready = current.is_some()
        && current_connection.is_some()
        && (source != "managed" || managed.as_ref().is_some_and(|m| m.available));
    let needs_managed_access = payments
        && source == "managed"
        && (selected_model.is_none() || current_connection == Some("managed"));
    let connecting = snapshot.is_none()
        || managed.as_ref().is_none_or(|m| {
            m.reason == "loading" || (m.signed_in && !ready && m.reason == "ready")
        });
    let paid_access = (needs_managed_access && !ready)
        .then(|| {
            if connecting {
                Some("loading")
            } else {
                managed
                    .as_ref()
                    .filter(|m| m.reason != "ready")
                    .map(|m| m.reason)
            }
        })
        .flatten();
    let setup_required = !payments && !ready && offered.is_empty();
    let access_required = paid_access.or(setup_required.then_some("compute-setup-required"));
    let show_picker =
        !offered.is_empty() && (source != "managed" || !offered.iter().any(is_managed));
    ComputeView {
        ready,
        access_required,
        source,
        own_compute_only,
        show_picker,
        setup_prompt: access_prompt && access_required == Some("compute-setup-required"),
        paid_prompt: access_prompt && needs_managed_access && !ready,
        connecting,
        offered,
        managed,
    }
}

impl AgentChatTabPanel {
    /// Rereads the connections; a new catalog refreshes the controller's.
    pub fn reload_model_connections(&mut self, cx: &mut Context<Self>) {
        let read = cx.background_spawn(async { read_compute_snapshot() });
        cx.spawn(async move |this, cx| {
            let snapshot = read.await;
            this.update(cx, |s, cx| s.apply_compute(snapshot, cx)).ok();
        })
        .detach();
    }

    /// Follow the app's compute wallet (`snapshot.managed`), and read it.
    pub(super) fn watch_wallet(&mut self, cx: &mut Context<Self>) {
        let wallet = crate::features::model_connections::global_compute(cx);
        cx.observe(&wallet, |s, wallet, cx| {
            let managed = ManagedCompute::of(wallet.read(cx));
            if let Some(compute) = s.compute.as_mut() {
                compute.managed = Some(managed.clone());
            }
            s.wallet = Some(managed);
            s.refresh_views();
            cx.notify();
        })
        .detach();
        self.wallet = Some(ManagedCompute::of(wallet.read(cx)));
        wallet.update(cx, |w, cx| w.refresh(false, cx));
    }

    /// A read of the connections; a new revision rediscovers the runtime's
    /// models.
    pub(super) fn apply_compute(&mut self, mut snapshot: ComputeSnapshot, cx: &mut Context<Self>) {
        if snapshot.managed.is_none() {
            snapshot.managed = self.wallet.clone();
        }
        let revision = Some(snapshot.revision.clone());
        if self.compute_revision.is_some() && self.compute_revision != revision {
            drop(self.controller.refresh_model_connections());
        }
        self.compute_revision = revision;
        self.compute = Some(snapshot);
        self.refresh_views();
        cx.notify();
    }

    pub(super) fn compute_view(&self, models: &[Model], selected: Option<&str>) -> ComputeView {
        derive_compute(
            self.compute.as_ref(),
            models,
            self.payments,
            selected,
            self.compute_access_prompt,
        )
    }

    /// `.desktop-agent-compute`.
    pub(super) fn render_compute(
        &self,
        compute: &ComputeView,
        selected: Option<&str>,
        disabled: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let palette = cx.palette();
        let a = AgentTheme::new(&palette);
        let m = theme::ty();
        let mut section = v_flex().gap(px(8.));
        if !(compute.setup_prompt || compute.paid_prompt) {
            let icon = if compute.own_compute_only {
                "server"
            } else {
                match compute.source {
                    "managed" => "sparkles",
                    "api" => "key-round",
                    _ => "server",
                }
            };
            let label = if compute.own_compute_only {
                t("agent.compute.customize")
            } else {
                t(match compute.source {
                    "managed" => "agent.compute.managed",
                    "api" => "agent.compute.source.api",
                    _ => "agent.compute.source.local",
                })
            };
            let selector = format!("agent-compute-summary:{label}");
            let mut summary = h_flex()
                .debug_selector(move || selector)
                .gap(px(6.))
                .min_w_0()
                .text_size(px(m.left.content))
                .text_color(a.text_subtle)
                .child(
                    Icon::new(icon)
                        .with_size(px(14.))
                        .stroke(1.7)
                        .color(a.text_subtle),
                )
                .child(div().flex_shrink_0().child(label));
            if compute.show_picker {
                let control = AgentSessionControl {
                    id: AgentSessionControlId::Model,
                    value: compute
                        .ready
                        .then(|| selected.map(str::to_string))
                        .flatten(),
                    options: compute
                        .offered
                        .iter()
                        .map(|model| {
                            let managed = self.compute.as_ref().and_then(|s| {
                                s.sources
                                    .get(model.connection_id.as_deref().unwrap_or_default())
                            }) == Some(&"managed");
                            AgentSessionControlOption {
                                value: model.model.clone(),
                                label: if managed {
                                    t("agent.compute.managed").to_string()
                                } else {
                                    model.display_name.clone()
                                },
                                description: (!managed).then(|| model.description.clone()),
                                keywords: (!managed)
                                    .then(|| format!("{} {}", model.id, model.model)),
                            }
                        })
                        .collect(),
                };
                let picker = self
                    .pickers
                    .update(cx, |p, cx| p.picker(&control, 220., disabled, cx));
                summary = summary.child(picker);
            }
            section = section.child(summary);
        }
        let prompt = |title: SharedString, detail: Option<SharedString>| {
            let selector = format!("agent-compute-title:{title}");
            v_flex()
                .gap(px(4.))
                .child(
                    div()
                        .debug_selector(move || selector)
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(a.text)
                        .child(title),
                )
                .children(detail.map(|detail| {
                    let selector = format!("agent-compute-detail:{detail}");
                    div()
                        .debug_selector(move || selector)
                        .whitespace_normal()
                        .text_color(a.text_muted)
                        .child(detail)
                }))
        };
        let frame = || {
            v_flex()
                .gap(px(10.))
                .px(px(12.))
                .py(px(10.))
                .rounded(px(8.))
                .border_1()
                .border_color(a.blocking_border)
                .bg(a.blocking_surface)
                .text_size(px(m.left.content))
        };
        if compute.setup_prompt {
            section = section.child(
                frame()
                    .child(prompt(
                        t("agent.compute.title").into(),
                        Some(t("agent.compute.setupDetail").into()),
                    ))
                    .child(
                        h_flex().child(
                            agent_button(
                                "agent-compute-customize",
                                t("agent.compute.customize").into(),
                                ButtonTone::Primary,
                                disabled,
                                &a,
                            )
                            .debug_selector(|| "agent-compute-customize".into())
                            .on_click(cx.listener(|_, _, _, cx| {
                                cx.emit(AgentChatPanelEvent::OpenModelConnections)
                            })),
                        ),
                    ),
            );
        }
        if compute.paid_prompt {
            let managed = compute.managed.clone();
            let signed_in = managed.as_ref().is_some_and(|m| m.signed_in);
            let title = if compute.connecting || !signed_in {
                t("agent.compute.accessTitle")
            } else if managed
                .as_ref()
                .is_some_and(|m| m.reason == "insufficient-credit")
            {
                t("agent.compute.insufficientCredit")
            } else {
                t("agent.compute.connectionUnavailable")
            };
            // Before sign-in: the server's one-time credit, if it offers one.
            let trial = managed.as_ref().map_or(0, |m| m.trial_credit_micro_usd);
            let detail = (!signed_in).then(|| {
                if trial > 0 {
                    crate::localization::tf(
                        "agent.compute.trialOffer",
                        &[(
                            "amount",
                            crate::features::model_connections::money(trial).into(),
                        )],
                    )
                    .into()
                } else {
                    t("agent.compute.walletDetail").into()
                }
            });
            let pending = managed.as_ref().is_some_and(|m| m.pending);
            let action = if compute.connecting {
                agent_button(
                    "agent-compute-connecting",
                    t("agent.compute.connecting").into(),
                    ButtonTone::Primary,
                    true,
                    &a,
                )
                .debug_selector(|| "agent-compute-connecting".into())
            } else if !signed_in {
                agent_button(
                    "agent-compute-sign-in",
                    t("agent.compute.signInToStart").into(),
                    ButtonTone::Primary,
                    disabled || pending,
                    &a,
                )
                .debug_selector(|| "agent-compute-sign-in".into())
                // `managed({action: "sign-in"})`: the browser sign-in.
                .on_click(cx.listener(|_, _, _, cx| {
                    crate::features::model_connections::global_compute(cx)
                        .update(cx, |w, cx| w.sign_in(cx))
                }))
            } else if managed
                .as_ref()
                .is_some_and(|m| m.reason == "insufficient-credit")
            {
                agent_button(
                    "agent-compute-balance",
                    t("agent.compute.manageBalance").into(),
                    ButtonTone::Primary,
                    disabled,
                    &a,
                )
                .debug_selector(|| "agent-compute-balance".into())
                .on_click(cx.listener(|_, _, _, cx| cx.emit(AgentChatPanelEvent::OpenAccount)))
            } else {
                agent_button(
                    "agent-compute-retry",
                    t("common.action.retry").into(),
                    ButtonTone::Primary,
                    pending,
                    &a,
                )
                .debug_selector(|| "agent-compute-retry".into())
                // `managed({action: "refresh"})`, which shows its progress.
                .on_click(cx.listener(|_, _, _, cx| {
                    crate::features::model_connections::global_compute(cx)
                        .update(cx, |w, cx| w.refresh(true, cx))
                }))
            };
            let mut actions = h_flex().gap(px(6.)).child(action);
            if !signed_in {
                actions =
                    actions.child(
                        agent_button(
                            "agent-compute-own",
                            t("agent.compute.customize").into(),
                            ButtonTone::Quiet,
                            disabled,
                            &a,
                        )
                        .debug_selector(|| "agent-compute-own".into())
                        .on_click(cx.listener(|_, _, _, cx| {
                            cx.emit(AgentChatPanelEvent::OpenModelConnections)
                        })),
                    );
            }
            // A browser sign-in that could not start is a sign-in problem,
            // not a billing one.
            let alert = (!compute.connecting
                && managed.as_ref().is_some_and(|m| {
                    m.sign_in_failed && (!m.signed_in || m.reason != "gateway-unavailable")
                }))
            .then(|| {
                div()
                    .id("agent-compute-alert")
                    .role(Role::Alert)
                    .aria_label(t("agent.compute.signInUnavailable"))
                    .test_support()
                    .debug_selector(|| "agent-compute-alert".into())
                    .text_color(a.text_muted)
                    .child(t("agent.compute.signInUnavailable"))
            });
            section = section.child(
                frame()
                    .child(prompt(title.into(), detail))
                    .child(actions)
                    .children(alert),
            );
        }
        section.into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use std::collections::HashMap;

    fn model(connection: &str, id: &str) -> Model {
        Model {
            model: format!("{connection}/{id}"),
            id: id.into(),
            connection_id: Some(connection.into()),
            display_name: id.into(),
            ..Model::default()
        }
    }

    fn snapshot(managed: Option<ManagedCompute>) -> ComputeSnapshot {
        ComputeSnapshot {
            revision: "r1".into(),
            sources: HashMap::from([
                ("mc_own".to_string(), "local"),
                ("mc_paid".to_string(), "managed"),
            ]),
            managed,
        }
    }

    #[test]
    fn without_payments_only_own_connections_are_routes() {
        let models = [model("mc_own", "qwen"), model("mc_paid", "gpt")];
        let snapshot = snapshot(None);
        let ready = derive_compute(Some(&snapshot), &models, false, Some("mc_own/qwen"), false);
        assert!(ready.ready);
        assert_eq!(ready.offered.len(), 1);
        assert_eq!(ready.source, "local");
        assert_eq!(ready.access_required, None);
        let paid = derive_compute(Some(&snapshot), &models, false, Some("mc_paid/gpt"), false);
        assert!(paid.own_compute_only);
        let none = derive_compute(Some(&snapshot), &[], false, None, true);
        assert_eq!(none.access_required, Some("compute-setup-required"));
        assert!(none.setup_prompt);
        assert!(!none.ready);
    }

    #[test]
    fn paid_compute_needs_a_signed_in_account_with_credit() {
        let models = [model("mc_paid", "gpt")];
        let signed_out = snapshot(Some(ManagedCompute {
            signed_in: false,
            available: false,
            reason: "sign-in-required",
            ..Default::default()
        }));
        let view = derive_compute(Some(&signed_out), &models, true, Some("mc_paid/gpt"), true);
        assert!(!view.ready);
        assert_eq!(view.access_required, Some("sign-in-required"));
        assert!(view.paid_prompt);
        let ready = snapshot(Some(ManagedCompute {
            signed_in: true,
            available: true,
            reason: "ready",
            ..Default::default()
        }));
        let view = derive_compute(Some(&ready), &models, true, Some("mc_paid/gpt"), false);
        assert!(view.ready);
        assert!(
            !view.show_picker,
            "PuppyOne compute alone has no model choice"
        );
        // Before the connections load, a first paid route is still connecting.
        let loading = derive_compute(None, &models, true, None, false);
        assert_eq!(loading.access_required, Some("loading"));
    }

    fn managed(signed_in: bool, available: bool, reason: &'static str) -> Option<ManagedCompute> {
        Some(ManagedCompute {
            signed_in,
            available,
            reason,
            ..Default::default()
        })
    }

    /// `keeps the initial managed summary free of account and billing
    /// details`: before a send, no prompt, picker or route.
    #[test]
    fn the_first_summary_asks_for_nothing() {
        let snapshot = snapshot(managed(false, false, "sign-in-required"));
        let view = derive_compute(Some(&snapshot), &[], true, None, false);
        assert_eq!(view.source, "managed");
        assert!(!view.ready && !view.show_picker && !view.paid_prompt && !view.setup_prompt);
    }

    /// `offers every ready configured model without configuring connections
    /// in Chat`; `restores a ready custom route while keeping management in
    /// Settings`.
    #[test]
    fn every_ready_own_route_is_offered_and_a_chosen_one_is_ready() {
        let models = [model("mc_own", "llama"), model("mc_api", "cloud-model")];
        let mut snapshot = snapshot(managed(false, false, "sign-in-required"));
        snapshot.sources.insert("mc_api".into(), "api");
        let choosing = derive_compute(Some(&snapshot), &models, true, None, false);
        assert_eq!(choosing.offered.len(), 2);
        assert!(choosing.show_picker && !choosing.ready && !choosing.paid_prompt);
        let restored = derive_compute(Some(&snapshot), &models, true, Some("mc_own/llama"), false);
        assert!(restored.ready);
        assert_eq!(restored.source, "local");
        assert_eq!(restored.access_required, None);
    }

    /// `shows preparation instead of a billing error while loading / ready
    /// is awaiting a model`.
    #[test]
    fn a_signed_in_account_awaiting_its_model_is_connecting() {
        for (reason, available) in [("loading", false), ("ready", true)] {
            let snapshot = snapshot(managed(true, available, reason));
            let view = derive_compute(Some(&snapshot), &[], true, None, true);
            assert!(
                view.connecting && view.paid_prompt && !view.ready,
                "{reason}"
            );
            assert_eq!(view.access_required, Some("loading"), "{reason}");
        }
    }

    /// `blocks a selected managed model when the personal balance is empty`;
    /// `hides the managed model and picker while retaining its readiness`.
    #[test]
    fn paid_compute_is_blocked_without_credit_and_never_offers_a_choice() {
        let models = [model("mc_paid", "gpt")];
        let empty = snapshot(managed(true, false, "insufficient-credit"));
        let blocked = derive_compute(Some(&empty), &models, true, Some("mc_paid/gpt"), true);
        assert!(!blocked.ready && blocked.paid_prompt && !blocked.connecting);
        assert_eq!(blocked.access_required, Some("insufficient-credit"));
        let funded = snapshot(managed(true, true, "ready"));
        for selected in [None, Some("mc_paid/gpt")] {
            let view = derive_compute(Some(&funded), &models, true, selected, false);
            assert!(!view.show_picker && !view.paid_prompt);
            assert_eq!(view.ready, selected.is_some());
        }
    }
}
