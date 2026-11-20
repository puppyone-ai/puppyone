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

/// The sources Chat can switch between, in order, each with the model a
/// switch selects (its connection's default, else its first ready model).
/// PuppyOne compute is a source only while Payments is on; a source without a
/// ready model opens Settings instead.
pub(crate) fn compute_sources<'a>(
    snapshot: Option<&ComputeSnapshot>,
    offered: &'a [Model],
    payments: bool,
) -> Vec<(&'static str, Option<&'a Model>)> {
    let source_of = |model: &Model| {
        model
            .connection_id
            .as_deref()
            .and_then(|id| snapshot.and_then(|s| s.sources.get(id)).copied())
    };
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

    /// Rereads the connections; a new catalog refreshes the controller's.
    pub fn reload_model_connections(&mut self, cx: &mut Context<Self>) {
        let read = cx.background_spawn(async { read_compute_snapshot() });
        cx.spawn(async move |this, cx| {
            let snapshot = read.await;
            this.update(cx, |s, cx| {
                let revision = Some(snapshot.revision.clone());
                if s.compute_revision.is_some() && s.compute_revision != revision {
                    drop(s.controller.refresh_model_connections());
                }
                s.compute_revision = revision;
                s.compute = Some(snapshot);
                s.refresh_views();
                cx.notify();
            })
            .ok();
        })
        .detach();
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
            let source_of = |model: &Model| {
                self.compute
                    .as_ref()
                    .and_then(|s| {
                        s.sources
                            .get(model.connection_id.as_deref().unwrap_or_default())
                    })
                    .copied()
            };
            // The source switcher: every source, its ready model or the
            // way to set it up, then Settings.
            let mut sources: Vec<AgentSessionControlOption> =
                compute_sources(self.compute.as_ref(), &compute.offered, self.payments)
                    .into_iter()
                    .map(|(kind, model)| {
                        let (icon, label) = source_presentation(kind);
                        AgentSessionControlOption {
                            value: kind.to_owned(),
                            label: t(label).to_string(),
                            // A source without a ready model opens Settings
                            // (`管理模型连接…` says so once, below).
                            description: match model {
                                Some(_) if kind == "managed" => {
                                    Some(t("agent.compute.managedBalance").to_string())
                                }
                                Some(model) => Some(model.display_name.clone()),
                                None => None,
                            },
                            keywords: None,
                            icon: Some(icon),
                            mark: None,
                        }
                    })
                    .collect();
            sources.push(AgentSessionControlOption {
                value: "manage".into(),
                label: t("native.agent.compute.manage").to_string(),
                description: None,
                keywords: None,
                icon: Some("settings"),
                mark: None,
            });
            let source_control = AgentSessionControl {
                id: AgentSessionControlId::Source,
                value: (!compute.own_compute_only).then(|| compute.source.to_owned()),
                options: sources,
            };
            let source_picker = self
                .pickers
                .update(cx, |p, cx| p.picker(&source_control, 180., disabled, cx));
            let mut summary = h_flex()
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
            let in_source: Vec<&Model> = compute
                .offered
                .iter()
                .filter(|m| source_of(m) == Some(compute.source))
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
                            description: Some(model.description.clone()),
                            keywords: Some(format!("{} {}", model.id, model.model)),
                            icon: Some(source_presentation(compute.source).0),
                            mark: self.compute.as_ref().and_then(|s| {
                                s.marks
                                    .get(model.connection_id.as_deref().unwrap_or_default())
                                    .copied()
                            }),
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
            v_flex()
                .gap(px(4.))
                .child(
                    div()
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(a.text)
                        .child(title),
                )
                .children(detail.map(|detail| {
                    div()
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
            let detail = (!signed_in).then(|| t("agent.compute.walletDetail").into());
            let action = if compute.connecting {
                agent_button(
                    "agent-compute-connecting",
                    t("agent.compute.connecting").into(),
                    ButtonTone::Primary,
                    true,
                    &a,
                )
            } else if !signed_in {
                agent_button(
                    "agent-compute-sign-in",
                    t("agent.compute.signInToStart").into(),
                    ButtonTone::Primary,
                    disabled,
                    &a,
                )
                .on_click(cx.listener(|_, _, _, cx| cx.emit(AgentChatPanelEvent::OpenAccount)))
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
                .on_click(cx.listener(|_, _, _, cx| cx.emit(AgentChatPanelEvent::OpenAccount)))
            } else {
                agent_button(
                    "agent-compute-retry",
                    t("common.action.retry").into(),
                    ButtonTone::Primary,
                    false,
                    &a,
                )
                .on_click(cx.listener(|s, _, _, cx| s.reload_model_connections(cx)))
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
                        .on_click(cx.listener(|_, _, _, cx| {
                            cx.emit(AgentChatPanelEvent::OpenModelConnections)
                        })),
                    );
            }
            section = section.child(frame().child(prompt(title.into(), detail)).child(actions));
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
        }));
        let view = derive_compute(Some(&signed_out), &models, true, Some("mc_paid/gpt"), true);
        assert!(!view.ready);
        assert_eq!(view.access_required, Some("sign-in-required"));
        assert!(view.paid_prompt);
        let ready = snapshot(Some(ManagedCompute {
            signed_in: true,
            available: true,
            reason: "ready",
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
}
