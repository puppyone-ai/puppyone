use super::super::{
    agent_theme::AgentTheme,
    elements::{ButtonTone, agent_button},
};
use super::AgentChatTabPanel;
use crate::features::local_agents::{
    ActivationDialog, RepairResult, activation_store, installation_store, repair_codex,
};
use crate::localization::t;
use crate::platform::local_agent_setup::Surface;
use gpui::{prelude::*, *};
use std::{path::PathBuf, rc::Rc};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum State {
    Idle,
    Searching,
    Missing,
    Unverified,
    Outdated,
    Error,
    Guided,
}
impl State {
    pub(super) fn message(self) -> &'static str {
        match self {
            Self::Idle => "native.codex.help",
            Self::Searching => "native.codex.searching",
            Self::Missing => "native.codex.notFound",
            Self::Unverified => "native.codex.unverified",
            Self::Outdated => "native.codex.outdated",
            Self::Error => "native.codex.error",
            Self::Guided => "native.codex.guided",
        }
    }
}

impl AgentChatTabPanel {
    pub(super) fn repair_actions(
        &self,
        theme: &AgentTheme,
        cx: &mut Context<Self>,
    ) -> Vec<AnyElement> {
        let button = |id: &'static str, key, tone, disabled| {
            agent_button(id, t(key).into(), tone, disabled, theme)
        };
        let mut actions = Vec::new();
        if self.repair == State::Outdated {
            actions.push(
                button(
                    "codex-update",
                    "native.codex.update",
                    ButtonTone::Primary,
                    false,
                )
                .on_click(cx.listener(|s, _, w, cx| s.open_codex_guide(w, cx)))
                .into_any_element(),
            );
        }
        if matches!(
            self.repair,
            State::Missing | State::Guided | State::Unverified
        ) {
            actions.push(
                button(
                    "codex-install",
                    "native.codex.install",
                    ButtonTone::Primary,
                    false,
                )
                .on_click(cx.listener(|s, _, w, cx| s.install_codex(w, cx)))
                .into_any_element(),
            );
        }
        if !matches!(self.repair, State::Idle | State::Searching) {
            actions.push(
                button(
                    "codex-select",
                    "native.codex.choose",
                    ButtonTone::Secondary,
                    false,
                )
                .on_click(cx.listener(|s, _, w, cx| s.pick_codex(w, cx)))
                .into_any_element(),
            );
        }
        actions.push(
            button(
                "codex-repair",
                if self.repair == State::Idle {
                    "native.codex.repair"
                } else {
                    "common.action.retry"
                },
                if self.repair == State::Idle {
                    ButtonTone::Primary
                } else {
                    ButtonTone::Secondary
                },
                self.repair == State::Searching,
            )
            .on_click(cx.listener(|s, _, _, cx| s.find_codex(None, cx)))
            .into_any_element(),
        );
        actions
    }

    fn find_codex(&mut self, selected: Option<PathBuf>, cx: &mut Context<Self>) {
        if self.repair == State::Searching {
            return;
        }
        let guided = self.repair == State::Guided;
        self.repair = State::Searching;
        let workspace = self.controller.workspace_root().into();
        let work = repair_codex(selected, workspace, cx);
        cx.spawn(async move |this, cx| {
            let result = work.await;
            let _ = this.update(cx, |s, cx| {
                s.repair = match result {
                    RepairResult::Refresh => {
                        s.install_subscription = None;
                        installation_store(cx).update(cx, |store, cx| store.refresh(cx));
                        if s.state().selected_runtime_id.as_deref() == Some("codex") {
                            drop(s.controller.initialize(true));
                        }
                        State::Idle
                    }
                    RepairResult::NotFound if guided => State::Guided,
                    RepairResult::NotFound => State::Missing,
                    RepairResult::Unverified => State::Unverified,
                    RepairResult::Outdated => State::Outdated,
                    RepairResult::Error => State::Error,
                };
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }

    fn pick_codex(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let prompt = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: Some(t("native.codex.choose").into()),
        });
        cx.spawn_in(window, async move |this, cx| {
            if let Ok(Ok(Some(paths))) = prompt.await
                && let Some(path) = paths.into_iter().next()
            {
                let _ = this.update(cx, |s, cx| s.find_codex(Some(path), cx));
            }
        })
        .detach();
    }

    fn open_codex_guide(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let route = crate::platform::local_agent_setup::route("codex").unwrap();
        cx.open_url(route.guide_url);
        self.repair = State::Guided;
        self.install_subscription = Some(cx.observe_window_activation(window, |s, w, cx| {
            if w.is_window_active()
                && s.repair == State::Guided
                && s.state().selected_runtime_id.as_deref() == Some("codex")
            {
                s.find_codex(None, cx);
            }
        }));
        cx.notify();
    }

    fn install_codex(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if cfg!(windows) {
            self.open_codex_guide(window, cx);
        } else {
            let store = activation_store(cx);
            let previous_ready = store
                .read(cx)
                .snapshot
                .operations
                .iter()
                .find(|op| {
                    op.setup_id == "codex"
                        && op.status
                            == crate::platform::local_agent_setup::activation::Status::Ready
                })
                .map(|op| op.operation_id.clone());
            self.install_subscription = Some(cx.observe(&store, move |s, store, cx| {
                if store.read(cx).snapshot.operations.iter().any(|op| {
                    op.setup_id == "codex"
                        && Some(&op.operation_id) != previous_ready.as_ref()
                        && op.status
                            == crate::platform::local_agent_setup::activation::Status::Ready
                }) {
                    s.install_dialog = None;
                    s.install_subscription = None;
                    s.find_codex(None, cx);
                }
            }));
            let panel = cx.weak_entity();
            let close = Rc::new(move |cx: &mut App| {
                let _ = panel.update(cx, |s, cx| {
                    s.install_dialog = None;
                    cx.notify();
                });
            });
            let owner = format!("window:{:?}", window.window_handle().window_id());
            self.install_dialog = Some(cx.new(|cx| {
                ActivationDialog::new(
                    "codex".into(),
                    "Codex".into(),
                    Surface::Chat,
                    owner,
                    true,
                    close,
                    window,
                    cx,
                )
            }));
        }
        cx.notify();
    }
}
