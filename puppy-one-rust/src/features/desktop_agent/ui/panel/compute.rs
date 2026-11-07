//! `built-in-agent/BuiltInAgentCompute.tsx`: Chat selects a ready route;
//! Settings exclusively owns connection configuration. Without Payments,
//! PuppyOne's own compute is not a route at all and the only remaining step
//! is the user's own connection.
use super::status::{ButtonTone, agent_button};
use super::{AgentChatPanelEvent, AgentChatTabPanel};
use crate::agent::runtimes::puppyone_agent::native_model_connections::{
    connection_catalog, product_connection_id,
};
use crate::features::desktop_agent::domain::agent_session_controls::{
    AgentSessionControl, AgentSessionControlId, AgentSessionControlOption,
};
use crate::features::desktop_agent::ui::agent_theme::AgentTheme;
use crate::localization::t;
use crate::theme;
use crate::ui::appearance::ActiveAppearance;
use crate::ui::components::Icon;
use gpui::{prelude::*, *};
use gpui_kit::base::{h_flex, v_flex};
use gpui_kit::component::Sizable as _;
use serde_json::Value;
use std::collections::HashMap;

/// `snapshot.managed`: PuppyOne compute for the signed-in account.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ManagedCompute {
    pub signed_in: bool,
    pub available: bool,
    /// `"ready"`, `"sign-in-required"` or `"insufficient-credit"`.
    pub reason: &'static str,
}

/// What Chat reads of the app's model connections (`useModelConnections`).
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct ComputeSnapshot {
    pub revision: String,
    /// Each ready connection's source kind (`managed`, `api` or `local`).
    pub sources: HashMap<String, &'static str>,
    pub managed: Option<ManagedCompute>,
}

fn local_endpoint(endpoint: &str) -> bool {
    reqwest::Url::parse(endpoint)
        .is_ok_and(|url| matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]")))
}

/// Reads the connections (blocking: the configuration file and PuppyOne
/// compute's cached catalog).
pub(crate) fn read_compute_snapshot() -> ComputeSnapshot {
    use crate::agent::model_connections::configuration;
    let mut connections = configuration::load().unwrap_or_default();
    let managed = configuration::managed();
    let signed_in = crate::cloud::auth::current().is_some();
    let available = !managed.is_empty();
    connections.extend(managed);
    let catalog = connection_catalog(&connections);
    ComputeSnapshot {
        revision: catalog["revision"].as_str().unwrap_or_default().to_string(),
        sources: connections
            .iter()
            .map(|c| {
                let kind = if c.managed {
                    "managed"
                } else if local_endpoint(&c.endpoint) {
                    "local"
                } else {
                    "api"
                };
                (product_connection_id(&c.id), kind)
            })
            .collect(),
        managed: Some(ManagedCompute {
            signed_in,
            available,
            reason: if !signed_in {
                "sign-in-required"
            } else if !available {
                "insufficient-credit"
            } else {
                "ready"
            },
        }),
    }
}

/// The dock's derived state.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ComputeView {
    pub ready: bool,
    /// `ComputeAccessRequired`.
    pub access_required: Option<&'static str>,
    pub offered: Vec<Value>,
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
    models: &[Value],
    payments: bool,
    selected_model: Option<&str>,
    access_prompt: bool,
) -> ComputeView {
    let source_of = |model: &Value| {
        model["connectionId"]
            .as_str()
            .and_then(|id| snapshot.and_then(|s| s.sources.get(id)).copied())
    };
    let ready_models: Vec<&Value> = models.iter().filter(|m| source_of(m).is_some()).collect();
    let is_managed = |model: &Value| source_of(model) == Some("managed");
    let current = ready_models
        .iter()
        .find(|m| m["model"].as_str() == selected_model);
    let selected = models
        .iter()
        .find(|m| m["model"].as_str() == selected_model);
    let current_connection = selected.and_then(source_of);
    let source = current_connection.unwrap_or(if payments { "managed" } else { "api" });
    // Paid compute is the one route an install may not be allowed to offer.
    let managed = if payments {
        snapshot.and_then(|s| s.managed.clone())
    } else {
        None
    };
    let own: Vec<Value> = ready_models
        .iter()
        .filter(|m| !is_managed(m))
        .map(|m| (*m).clone())
        .collect();
    let offered: Vec<Value> = if payments {
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
            this.update(cx, |s, cx| {
                let revision = Some(snapshot.revision.clone());
                if s.compute_revision.is_some() && s.compute_revision != revision {
                    drop(s.controller.refresh_model_connections());
                }
                s.compute_revision = revision;
                s.compute = Some(snapshot);
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    pub(super) fn compute_view(&self, models: &[Value], selected: Option<&str>) -> ComputeView {
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
            let mut summary = h_flex()
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
                                    .get(model["connectionId"].as_str().unwrap_or_default())
                            }) == Some(&"managed");
                            let text = |key: &str| model[key].as_str().map(str::to_string);
                            AgentSessionControlOption {
                                value: text("model").unwrap_or_default(),
                                label: if managed {
                                    t("agent.compute.managed").to_string()
                                } else {
                                    text("displayName").unwrap_or_default()
                                },
                                description: (!managed).then(|| text("description")).flatten(),
                                keywords: (!managed).then(|| {
                                    format!(
                                        "{} {}",
                                        text("id").unwrap_or_default(),
                                        text("model").unwrap_or_default()
                                    )
                                }),
                            }
                        })
                        .collect(),
                };
                summary = summary.child(self.session_picker(&control, 220., disabled, cx));
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
    use serde_json::json;

    fn model(connection: &str, id: &str) -> Value {
        json!({ "model": format!("{connection}/{id}"), "id": id, "connectionId": connection, "displayName": id })
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
}
