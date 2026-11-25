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
    ComputeSnapshot, ManagedCompute, current_compute_snapshot, sync_offered_models,
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
    let source_of = |model: &Model| snapshot.and_then(|s| s.source(model));
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

/// The sources Chat can switch between, in order, each with the model a
/// switch selects (its connection's default, else its first ready model).
/// PuppyOne compute is a source only while Payments is on; a source without a
/// ready model opens Settings instead.
pub(crate) fn compute_sources<'a>(
    snapshot: Option<&ComputeSnapshot>,
    offered: &'a [Model],
    payments: bool,
) -> Vec<(&'static str, Option<&'a Model>)> {
    let source_of = |model: &Model| snapshot.and_then(|s| s.source(model));
    ["managed", "oauth", "api", "local"]
        .into_iter()
        .filter(|kind| payments || *kind != "managed")
        .map(|kind| {
            let models: Vec<&Model> = offered
                .iter()
                .filter(|m| source_of(m) == Some(kind))
                .collect();
            let pick = models
                .iter()
                .find(|m| m.is_default)
                .or_else(|| models.first())
                .copied();
            (kind, pick)
        })
        .collect()
}

/// A source's icon and label key in the dock and its picker.
pub(crate) fn source_presentation(kind: &str) -> (&'static str, &'static str) {
    match kind {
        "managed" => ("sparkles", "agent.compute.managed"),
        "oauth" => ("user-round", "native.agent.compute.source.oauth"),
        "api" => ("key-round", "agent.compute.source.api"),
        _ => ("server", "agent.compute.source.local"),
    }
}

impl AgentChatTabPanel {
    /// `Source`: switch to the source's model, or set the source up.
    pub(super) fn select_compute_source(&mut self, source: String, cx: &mut Context<Self>) {
        if source == "manage" {
            cx.emit(AgentChatPanelEvent::OpenModelConnections);
            return;
        }
        let state = self.state();
        let runtime = self.runtime_view(&state);
        let compute = self.compute_view(&runtime.runtime_models, state.selected_model.as_deref());
        let target = compute_sources(self.compute.as_ref(), &compute.offered, self.payments)
            .into_iter()
            .find(|(kind, _)| *kind == source)
            .and_then(|(_, model)| model.map(|m| m.model.clone()));
        match target {
            Some(model) => self.select_session_control(AgentSessionControlId::Model, model, cx),
            None if source == "managed" => cx.emit(AgentChatPanelEvent::OpenAccount),
            None => cx.emit(AgentChatPanelEvent::OpenModelConnections),
        }
    }

    /// Rereads saved custom connections in the unified authority; any resulting
    /// snapshot change notifies every open panel and invalidates `AgentHost`.
    /// Each provider then offers its whole text catalog: a catalog that grew
    /// since the last read is saved (at most once every ten minutes).
    pub fn reload_model_connections(&mut self, cx: &mut Context<Self>) {
        crate::features::model_connections::reload_saved(cx);
        self.sync_chat_models(cx);
    }

    /// Brings the connections' Chat models up to their catalogs, off the UI
    /// thread; the authority publishes what was saved.
    fn sync_chat_models(&mut self, cx: &mut Context<Self>) {
        let service = crate::features::model_connections::service(cx);
        cx.background_spawn(sync_offered_models(service)).detach();
    }

    /// Subscribes directly to the unified `ModelConnectionsStore`, projects its
    /// initial snapshot synchronously (eliminating cold-start races), and polls
    /// managed compute every 30 s while signed in with Payments enabled.
    pub(super) fn watch_model_connections(&mut self, cx: &mut Context<Self>) {
        let store = crate::features::model_connections::global_store(cx);
        cx.observe(&store, |s, _, cx| {
            let sign_in_failed = s.wallet.as_ref().is_some_and(|w| w.sign_in_failed);
            if let Some(snapshot) = current_compute_snapshot(cx, sign_in_failed) {
                s.apply_compute(snapshot, cx);
            }
        })
        .detach();
        let sign_in_failed = self.wallet.as_ref().is_some_and(|w| w.sign_in_failed);
        if let Some(snapshot) = current_compute_snapshot(cx, sign_in_failed) {
            self.apply_compute(snapshot, cx);
        }
        self.sync_chat_models(cx);
        if self.compute_poll.is_none() {
            self.compute_poll = Some(cx.spawn(async move |this, cx| {
                loop {
                    cx.background_executor()
                        .timer(std::time::Duration::from_secs(30))
                        .await;
                    let alive = this.update(cx, |s, cx| {
                        if s.payments && s.wallet.as_ref().is_some_and(|w| w.signed_in) {
                            crate::features::model_connections::refresh_managed(false, cx);
                        }
                    });
                    if alive.is_err() {
                        break;
                    }
                }
            }));
        }
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

    /// A read of the connections; a new revision (or first ready connections
    /// arriving after an empty initial discovery) rediscovers the runtime's
    /// models.
    pub(super) fn apply_compute(&mut self, mut snapshot: ComputeSnapshot, cx: &mut Context<Self>) {
        if snapshot.managed.is_none() {
            snapshot.managed = self.wallet.clone();
        }
        let revision = Some(snapshot.revision.clone());
        let changed = self.compute_revision.is_some() && self.compute_revision != revision;
        let missing_models = self.compute_revision.is_none() && !snapshot.sources.is_empty() && {
            let state = self.state();
            state.initialized && self.runtime_view(&state).runtime_models.is_empty()
        };
        if changed || missing_models {
            self.connections_changed = true;
        }
        self.compute_revision = revision;
        self.compute = Some(snapshot);
        self.refresh_model_catalog();
        self.refresh_views();
        cx.notify();
    }

    /// Connections changed (a sign-in, a new key, a catalog sync): this
    /// chat's model list is read again, at once, or after the turn running
    /// now ends — the controller reads no catalog mid-turn, and a change it
    /// skipped is not forgotten ([`Self::on_state_change`] asks again).
    pub(super) fn refresh_model_catalog(&mut self) {
        if self.connections_changed && self.controller.can_refresh_model_connections() {
            self.connections_changed = false;
            drop(self.controller.refresh_model_connections());
        }
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
            let (icon, _) = source_presentation(compute.source);
            let snapshot = self.compute.as_ref();
            let source_of = |model: &Model| snapshot.and_then(|s| s.source(model));
            // The source switcher, in two levels as Cursor's model picker:
            // source → provider (each signed-in plan, API or local service);
            // the provider's models are switched in the model picker beside,
            // and a source without a ready model opens Settings.
            let mut sources: Vec<AgentSessionControlOption> =
                compute_sources(self.compute.as_ref(), &compute.offered, self.payments)
                    .into_iter()
                    .map(|(kind, model)| {
                        let (icon, label) = source_presentation(kind);
                        // Its providers, in the order their models come.
                        let mut providers: Vec<(String, Vec<&Model>)> = vec![];
                        if kind != "managed" {
                            for m in compute
                                .offered
                                .iter()
                                .filter(|m| source_of(m) == Some(kind))
                            {
                                let id = m.connection_id.clone().unwrap_or_default();
                                match providers.iter_mut().find(|(p, _)| *p == id) {
                                    Some((_, models)) => models.push(m),
                                    None => providers.push((id, vec![m])),
                                }
                            }
                        }
                        // Providers are the last level: picking one keeps
                        // its current model, else takes its first; its
                        // models are switched in the model picker beside.
                        let children: Vec<AgentSessionControlOption> = providers
                            .into_iter()
                            .map(|(id, models)| {
                                let current = models
                                    .iter()
                                    .find(|m| compute.ready && selected == Some(m.model.as_str()));
                                AgentSessionControlOption {
                                    value: current
                                        .or(models.first())
                                        .map(|m| m.model.clone())
                                        .unwrap_or_default(),
                                    label: snapshot
                                        .and_then(|s| s.name(&id))
                                        .unwrap_or_default()
                                        .to_owned(),
                                    icon: Some(icon),
                                    mark: snapshot.and_then(|s| s.mark(&id)),
                                    current: current.is_some(),
                                    ..Default::default()
                                }
                            })
                            .collect();
                        AgentSessionControlOption {
                            value: kind.to_owned(),
                            label: t(label).to_string(),
                            description: match model {
                                Some(_) if kind == "managed" => {
                                    Some(t("agent.compute.managedBalance").to_string())
                                }
                                _ => None,
                            },
                            icon: Some(icon),
                            children,
                            ..Default::default()
                        }
                    })
                    .collect();
            sources.push(AgentSessionControlOption {
                value: "manage".into(),
                label: t("native.agent.compute.manage").to_string(),
                icon: Some("settings"),
                ..Default::default()
            });
            let source_control = AgentSessionControl {
                id: AgentSessionControlId::Source,
                value: (!compute.own_compute_only).then(|| compute.source.to_owned()),
                options: sources,
            };
            let source_picker = self
                .pickers
                .update(cx, |p, cx| p.picker(&source_control, 180., disabled, cx));
            // The source it shows, for tests (`agent-compute-summary:<label>`).
            let summary_label = if compute.own_compute_only {
                t("agent.compute.customize")
            } else {
                t(source_presentation(compute.source).1)
            };
            let selector = format!("agent-compute-summary:{summary_label}");
            let mut summary = h_flex()
                .debug_selector(move || selector)
                .gap(px(4.))
                .min_w_0()
                .text_size(px(m.left.content))
                .text_color(a.text_subtle)
                .child(
                    Icon::new(if compute.own_compute_only {
                        "server"
                    } else {
                        icon
                    })
                    .with_size(px(14.))
                    .stroke(1.7)
                    .color(a.text_subtle),
                )
                .child(source_picker);
            // The quick switch beside it: the current provider's models
            // (another provider is one level in, in the source picker).
            let provider = compute
                .offered
                .iter()
                .find(|m| selected == Some(m.model.as_str()))
                .and_then(|m| m.connection_id.clone());
            let in_source: Vec<&Model> = compute
                .offered
                .iter()
                .filter(|m| source_of(m) == Some(compute.source))
                .filter(|m| provider.is_none() || m.connection_id == provider)
                .collect();
            if compute.show_picker && !in_source.is_empty() {
                let control = AgentSessionControl {
                    id: AgentSessionControlId::Model,
                    value: compute
                        .ready
                        .then(|| selected.map(str::to_string))
                        .flatten(),
                    options: in_source
                        .iter()
                        .map(|model| AgentSessionControlOption {
                            value: model.model.clone(),
                            label: model.display_name.clone(),
                            // The service it runs on (models of several
                            // services share a source).
                            description: snapshot
                                .zip(model.connection_id.as_deref())
                                .and_then(|(s, id)| s.name(id))
                                .map(str::to_owned)
                                .or_else(|| {
                                    (!model.description.is_empty())
                                        .then(|| model.description.clone())
                                }),
                            keywords: Some(format!("{} {}", model.id, model.model)),
                            icon: Some(source_presentation(compute.source).0),
                            mark: snapshot
                                .zip(model.connection_id.as_deref())
                                .and_then(|(s, id)| s.mark(id)),
                            ..Default::default()
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
            marks: HashMap::new(),
            names: HashMap::new(),
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

    #[test]
    fn every_source_is_offered_with_the_model_a_switch_selects() {
        let mut own = model("mc_own", "qwen");
        own.is_default = false;
        let mut preferred = model("mc_own", "llama");
        preferred.is_default = true;
        let api = model("mc_api", "gpt");
        let signed_in = model("mc_plan", "gpt-5.5");
        let mut snapshot = snapshot(None);
        snapshot.sources.insert("mc_api".into(), "api");
        snapshot.sources.insert("mc_plan".into(), "oauth");
        let offered = [own, preferred, api, signed_in];
        let sources = compute_sources(Some(&snapshot), &offered, false);
        // Without Payments, PuppyOne compute is not a source.
        assert_eq!(
            sources
                .iter()
                .map(|(k, m)| (*k, m.map(|m| m.id.as_str())))
                .collect::<Vec<_>>(),
            [
                ("oauth", Some("gpt-5.5")),
                ("api", Some("gpt")),
                ("local", Some("llama"))
            ]
        );
        let with_payments = compute_sources(Some(&snapshot), &[], true);
        assert_eq!(
            with_payments
                .iter()
                .map(|(k, m)| (*k, m.is_some()))
                .collect::<Vec<_>>(),
            [
                ("managed", false),
                ("oauth", false),
                ("api", false),
                ("local", false)
            ],
            "a source without a ready model is still offered, to set it up"
        );
        for kind in ["managed", "oauth", "api", "local"] {
            let (icon, label) = source_presentation(kind);
            assert!(!icon.is_empty() && !label.is_empty());
        }
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
