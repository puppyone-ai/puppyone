//! Port of `local-agents/setup/LocalAgentsSettingsView.tsx`: detected agents with
//! launcher visibility, rescan and chat-history discovery. Guided installation
//! and activity hooks depend on platform services that are not native yet; the
//! product hides those sections when unsupported, and so does this view.
use crate::{
    agent::connections::local_agent_inventory::{self, Installation},
    features::settings::preferences_store::PreferencesStore,
    localization::{t, tf},
    theme::{self, Theme},
    ui::{Tone, action_button, row, switch},
    wake::Wake,
};
use gpui::{prelude::*, *};
pub struct AgentSettings {
    pub dark: bool,
    preferences: Entity<PreferencesStore>,
    installations: Option<Vec<Installation>>,
    pending: Option<std::sync::mpsc::Receiver<Vec<Installation>>>,
    wake: Wake,
}
impl AgentSettings {
    pub fn new(
        preferences: Entity<PreferencesStore>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let (wake, rx) = Wake::channel();
        cx.spawn_in(window, async move |this, cx| {
            while rx.recv().await.is_ok() {
                if this
                    .update_in(cx, |s, _, cx| {
                        if let Some(result) = s.pending.as_ref().and_then(|rx| rx.try_recv().ok()) {
                            s.pending = None;
                            s.installations = Some(result);
                            cx.notify();
                        }
                    })
                    .is_err()
                {
                    break;
                }
            }
        })
        .detach();
        cx.observe(&preferences, |_, _, cx| cx.notify()).detach();
        let mut s = Self {
            dark: true,
            preferences,
            installations: None,
            pending: None,
            wake,
        };
        s.refresh();
        s
    }
    pub fn refresh(&mut self) {
        if self.pending.is_some() {
            return;
        }
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        let wake = self.wake.clone();
        self.pending = Some(rx);
        std::thread::spawn(move || {
            let _ = tx.send(local_agent_inventory::discover());
            wake.notify();
        });
    }
    /// Category rows for the Settings page (rendered inside its section).
    pub fn categories(&self, t: Theme, cx: &mut Context<Self>) -> Vec<Div> {
        use crate::features::settings::components::category;
        let scanning = self.pending.is_some();
        let prefs = self.preferences.read(cx).state.clone();
        let mut rows: Vec<AnyElement> = vec![];
        let detected: Vec<Installation> = self
            .installations
            .iter()
            .flatten()
            .filter(|i| !i.bundled())
            .cloned()
            .collect();
        for (index, agent) in detected.iter().enumerate() {
            let id = agent.id;
            let visible = prefs.agent_visible(id);
            let store = self.preferences.clone();
            rows.push(
                row()
                    .w_full()
                    .min_h(px(42.))
                    .justify_between()
                    .gap(px(18.))
                    .px(px(10.))
                    .child(
                        row()
                            .gap(px(8.))
                            .min_w_0()
                            .child(crate::features::desktop_agent::ui::agent_brand_mark::brand(
                                agent.runtime,
                                self.dark,
                                18.,
                                t.text,
                            ))
                            .child(
                                div()
                                    .truncate()
                                    .text_size(px(theme::ty().ui.label))
                                    .text_color(t.text)
                                    .child(agent.label.clone()),
                            ),
                    )
                    .child(switch(
                        ("agent-visible", index),
                        tf(
                            "settings.localAgents.toggle",
                            &[("agent", agent.label.clone().into())],
                        ),
                        visible,
                        false,
                        t,
                        move |on, _, cx| {
                            store.update(cx, |p, cx| {
                                p.change(
                                    |p| {
                                        let hidden = &mut p.local_agents.hidden_agent_ids;
                                        hidden.retain(|h| h != id);
                                        if !on {
                                            hidden.push(id.into());
                                        }
                                    },
                                    cx,
                                )
                            })
                        },
                    ))
                    .into_any_element(),
            );
        }
        let muted = |text: &'static str| {
            crate::features::settings::components::muted_row(text, t).into_any_element()
        };
        if detected.is_empty() {
            rows.push(if scanning || self.installations.is_none() {
                muted(t_static("settings.localAgents.scanning"))
            } else {
                muted(t_static("settings.localAgents.empty"))
            });
        }
        let scan = action_button(
            "scan-local-agents",
            t_static("settings.localAgents.scan"),
            Some(if scanning {
                "loader-circle"
            } else {
                "refresh-cw"
            }),
            Tone::Default,
            scanning,
            t,
        )
        .on_click(cx.listener(|s, _, _, cx| {
            s.refresh();
            cx.notify();
        }))
        .into_any_element();
        let store = self.preferences.clone();
        let history = crate::features::settings::components::setting_row(
            t_static("settings.localAgents.history.toggle"),
            switch(
                "chat-history-discovery",
                t_static("settings.localAgents.history.toggle"),
                prefs.local_agents.chat_history_discovery,
                false,
                t,
                move |on, _, cx| {
                    store.update(cx, |p, cx| {
                        p.change(|p| p.local_agents.chat_history_discovery = on, cx)
                    })
                },
            ),
            t,
        )
        .into_any_element();
        vec![
            category(
                t_static("settings.localAgents.activeChat.title"),
                Some(scan),
                rows,
                t,
            ),
            category(
                t_static("settings.localAgents.history.title"),
                None,
                vec![history],
                t,
            ),
        ]
    }
}
fn t_static(key: &str) -> &'static str {
    t(key)
}
impl Render for AgentSettings {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = Theme::new(self.dark);
        crate::features::settings::components::category_list(self.categories(t, cx))
    }
}
