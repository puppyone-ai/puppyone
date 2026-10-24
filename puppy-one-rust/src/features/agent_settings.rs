//! Port of `local-agents/setup/LocalAgentsSettingsView.tsx`: detected agents with
//! launcher visibility, rescan, chat-history discovery and the Hooks list.
//! Guided installation depends on a platform service that is not native yet;
//! the product hides that section when unsupported, and so does this view.
use crate::{
    agent::connections::local_agent_inventory::{self, Installation},
    features::settings::preferences_store::PreferencesStore,
    localization::{t, tf},
    theme::{self, Theme},
    ui::{row, switch},
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
    /// Dev-capture: the lab's detected agents instead of this machine's.
    #[cfg(feature = "dev-capture")]
    pub fn lab_fixture(&mut self) {
        self.pending = None;
        self.installations = Some(local_agent_inventory::lab_installations());
    }
    /// Category rows for the Settings page (rendered inside its section).
    pub fn categories(&self, t: Theme, cx: &mut Context<Self>) -> Vec<Div> {
        use crate::features::desktop_agent::ui::agent_brand_mark::{
            LauncherIdentity, launcher_icon,
        };
        use crate::features::settings::components::category_body;
        let scanning = self.pending.is_some();
        let prefs = self.preferences.read(cx).state.clone();
        // `LOCAL_AGENT_CHAT_RECIPES` order; terminal launchers name the agent.
        const ORDER: [&str; 7] = [
            "claude",
            "codex",
            "cursor",
            "opencode",
            "pi",
            "hermes",
            "workbuddy-china",
        ];
        let mut detected: Vec<Installation> = self
            .installations
            .iter()
            .flatten()
            .filter(|i| !i.bundled())
            .cloned()
            .collect();
        detected.sort_by_key(|i| {
            ORDER
                .iter()
                .position(|id| *id == i.id)
                .unwrap_or(ORDER.len())
        });
        let display_name = |agent: &Installation| -> String {
            let key = format!("terminal.launcher.{}.name", agent.id);
            let name = t_static(&key);
            if name == key {
                agent.label.clone()
            } else {
                name.to_owned()
            }
        };
        // `.desktop-local-agent-settings-table` and its 34px rows.
        let table = |rows: Vec<AnyElement>| {
            div()
                .flex()
                .flex_col()
                .w_full()
                .p(px(4.))
                .border_1()
                .border_color(t.border_subtle)
                .rounded(px(7.))
                .bg(t.panel)
                .children(rows)
        };
        let table_row = || {
            row()
                .w_full()
                .min_w_0()
                .min_h(px(theme::control_large()))
                .justify_between()
                .gap(px(18.))
                .px(px(8.))
                .rounded(px(6.))
                .text_size(px(theme::ty().ui.label))
                .line_height(px(18.))
                .text_color(t.subtle)
                .hover(move |s| s.bg(t.hover))
        };
        let identity = |agent: &Installation, name: String| {
            row()
                .gap(px(8.))
                .min_w_0()
                .child(launcher_icon(
                    LauncherIdentity::Runtime(agent.runtime),
                    false,
                    self.dark,
                    t.muted,
                ))
                .child(div().truncate().text_color(t.text).child(name))
        };
        // `.desktop-local-agent-group-action`: a 20px quiet text action.
        let group_action = |id: &'static str, label: &'static str, spinning: bool| {
            div()
                .id(id)
                .h(px(theme::control_micro()))
                .px(px(4.))
                .flex()
                .items_center()
                .gap(px(5.))
                .rounded(px(4.))
                .text_size(px(theme::ty().ui.caption))
                .text_color(t.subtle)
                .hover(move |s| s.bg(t.hover).text_color(t.text))
                .child(crate::ui::icon_stroke(
                    if spinning {
                        "loader-circle"
                    } else {
                        "refresh-cw"
                    },
                    12.,
                    2.,
                    t.subtle,
                ))
                .child(label)
        };
        let mut rows: Vec<AnyElement> = vec![];
        for (index, agent) in detected.iter().enumerate() {
            let id = agent.id;
            let visible = prefs.agent_visible(id);
            let store = self.preferences.clone();
            let name = display_name(agent);
            rows.push(
                table_row()
                    .child(identity(agent, name.clone()))
                    .child(switch(
                        ("agent-visible", index),
                        tf("settings.localAgents.toggle", &[("agent", name.into())]),
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
        if detected.is_empty() {
            let key = if scanning || self.installations.is_none() {
                "settings.localAgents.scanning"
            } else {
                "settings.localAgents.empty"
            };
            rows.push(table_row().child(t_static(key)).into_any_element());
        }
        let scan = group_action(
            "scan-local-agents",
            t_static("settings.localAgents.scan"),
            scanning,
        )
        .on_click(cx.listener(|s, _, _, cx| {
            s.refresh();
            cx.notify();
        }))
        .into_any_element();
        let store = self.preferences.clone();
        let history = table_row()
            .child(t_static("settings.localAgents.history.toggle"))
            .child(switch(
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
            ))
            .into_any_element();
        // `LocalAgentHooksSettingsSection`: the configurable providers that are
        // detected (`hook-registration-service.mjs`). Installing the PuppyOne
        // Hook needs the activity bridge, which is not native yet, so each
        // checkbox stays unchecked and inert and says so.
        const HOOKS: [(&str, &str); 3] = [
            ("codex", "Codex"),
            ("claude", "Claude Code"),
            ("cursor", "Cursor Agent CLI"),
        ];
        let (checkbox_fill, checkbox_border) = crate::theme::native_checkbox(t.dark);
        let mut hooks: Vec<AnyElement> = HOOKS
            .iter()
            .filter_map(|(id, name)| {
                detected
                    .iter()
                    .find(|i| i.id == *id)
                    .map(|agent| (agent, *name))
            })
            .map(|(agent, name)| {
                let label = tf("settings.localAgentHooks.toggle", &[("agent", name.into())]);
                table_row()
                    .id(SharedString::from(format!("agent-hook-{}", agent.id)))
                    .tooltip(crate::ui::tooltip(tf(
                        "settings.sidebar.notAvailable",
                        &[("section", label.into())],
                    )))
                    .child(identity(agent, name.to_owned()))
                    .child(
                        // An unchecked native checkbox (14px, 13px box).
                        div()
                            .size(px(14.))
                            .flex()
                            .items_center()
                            .justify_center()
                            .child(
                                div()
                                    .size(px(13.))
                                    .rounded(px(2.))
                                    .border(px(0.5))
                                    .border_color(checkbox_border)
                                    .bg(checkbox_fill),
                            ),
                    )
                    .into_any_element()
            })
            .collect();
        if hooks.is_empty() {
            hooks.push(
                table_row()
                    .child(t_static(if scanning {
                        "settings.localAgentHooks.loading"
                    } else {
                        "settings.localAgentHooks.empty"
                    }))
                    .into_any_element(),
            );
        }
        let refresh_hooks = group_action(
            "refresh-agent-hooks",
            t_static("settings.localAgentHooks.refresh"),
            scanning,
        )
        .on_click(cx.listener(|s, _, _, cx| {
            s.refresh();
            cx.notify();
        }))
        .into_any_element();
        vec![
            category_body(
                t_static("settings.localAgents.activeChat.title"),
                Some(scan),
                table(rows),
                t,
            ),
            category_body(
                t_static("settings.localAgents.history.title"),
                None,
                table(vec![history]),
                t,
            ),
            category_body(
                t_static("settings.localAgentHooks.title"),
                Some(refresh_hooks),
                table(hooks),
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
