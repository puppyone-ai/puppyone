//! Port of `local-agents/setup/LocalAgentsSettingsView.tsx`: detected agents with
//! launcher visibility, rescan, chat-history discovery and the Hooks section
//! (`LocalAgentHooksSettingsView.tsx`), whose checkboxes install or remove
//! PuppyOne's Hook in each Agent's configuration.
use crate::{
    agent::connections::local_agent_inventory::{self, Installation},
    features::settings::preferences_store::PreferencesStore,
    localization::{t, tf},
    platform::agent_activity::{
        host::Host,
        registration::{Enrollment, ProviderStatus},
    },
    theme::{self, Theme},
    ui::{
        appearance::ActiveAppearance,
        components::{
            Button, Icon, SettingsCategory, SettingsCategoryList, Switch, native_checkbox,
        },
    },
    wake::Wake,
};
use gpui::{prelude::*, *};
use gpui_kit::{base::h_flex, component::Sizable as _};
use std::sync::mpsc;

/// `EnrollmentPhase`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum HooksPhase {
    Loading,
    Ready,
    Error,
}
/// Work finished off the UI thread.
enum Done {
    Installations(Vec<Installation>),
    /// `readEnrollment` of one generation; a later read or change wins.
    Enrollment(u64, Option<Vec<ProviderStatus>>),
    /// `setEnabled`: the snapshot after the change, or the failed provider.
    Mutated(Result<Vec<ProviderStatus>, &'static str>),
}
/// Reads and changes Hook enrollment; the product's host by default.
pub type Enrollments = std::sync::Arc<
    dyn Fn(Option<(&'static str, bool)>) -> Result<Vec<ProviderStatus>, String> + Send + Sync,
>;

pub struct AgentSettings {
    preferences: Entity<PreferencesStore>,
    installations: Option<Vec<Installation>>,
    scanning: bool,
    hooks: Vec<ProviderStatus>,
    hooks_phase: HooksPhase,
    hooks_generation: u64,
    /// `pendingProviderId`.
    hook_pending: Option<&'static str>,
    /// `mutationError`: the provider whose change failed.
    hook_error: Option<&'static str>,
    enrollments: Enrollments,
    tx: mpsc::Sender<Done>,
    rx: mpsc::Receiver<Done>,
    wake: Wake,
}
impl AgentSettings {
    pub fn new(
        preferences: Entity<PreferencesStore>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let (wake, wakes) = Wake::channel();
        cx.spawn_in(window, async move |this, cx| {
            while wakes.recv().await.is_ok() {
                if this.update_in(cx, |s, _, cx| s.drain(cx)).is_err() {
                    break;
                }
            }
        })
        .detach();
        cx.observe(&preferences, |_, _, cx| cx.notify()).detach();
        let (tx, rx) = mpsc::channel();
        let mut s = Self {
            preferences,
            installations: None,
            scanning: false,
            hooks: vec![],
            hooks_phase: HooksPhase::Loading,
            hooks_generation: 0,
            hook_pending: None,
            hook_error: None,
            enrollments: std::sync::Arc::new(|change| {
                let host = Host::global();
                if let Some((provider, enabled)) = change {
                    host.set_enrollment(provider, enabled)?;
                }
                Ok(host.enrollment())
            }),
            tx,
            rx,
            wake,
        };
        s.refresh();
        s.read_enrollment(false);
        s
    }
    fn drain(&mut self, cx: &mut Context<Self>) {
        while let Ok(done) = self.rx.try_recv() {
            match done {
                Done::Installations(found) => {
                    self.scanning = false;
                    self.installations = Some(found);
                }
                Done::Enrollment(generation, _) if generation != self.hooks_generation => {}
                Done::Enrollment(_, Some(providers)) => {
                    self.hooks = providers;
                    self.hooks_phase = HooksPhase::Ready;
                }
                Done::Enrollment(_, None) => self.hooks_phase = HooksPhase::Error,
                Done::Mutated(result) => {
                    self.hook_pending = None;
                    match result {
                        Ok(providers) => {
                            self.hooks_generation += 1;
                            self.hooks_phase = HooksPhase::Ready;
                            // `onActivityIndicatorsEnabledChange(hasEnabledHook)`.
                            let any = providers
                                .iter()
                                .any(|p| p.enrollment == Enrollment::Enabled);
                            self.hooks = providers;
                            self.preferences.update(cx, |p, cx| {
                                p.change(|p| p.agent_file_activity_indicators = any, cx)
                            });
                        }
                        Err(provider) => self.hook_error = Some(provider),
                    }
                }
            }
        }
        cx.notify();
    }
    fn run(&self, work: impl FnOnce() -> Done + Send + 'static) {
        let (tx, wake) = (self.tx.clone(), self.wake.clone());
        std::thread::spawn(move || {
            let _ = tx.send(work());
            wake.notify();
        });
    }
    /// Rescans this machine's Agents.
    pub fn refresh(&mut self) {
        if self.scanning {
            return;
        }
        self.scanning = true;
        self.run(|| Done::Installations(local_agent_inventory::discover()));
    }
    /// `load` / `refresh`: the Hook enrollment, with a rescan when `rescan`.
    fn read_enrollment(&mut self, rescan: bool) {
        self.hooks_phase = HooksPhase::Loading;
        self.hook_error = None;
        if rescan {
            self.refresh();
        }
        self.hooks_generation += 1;
        let (read, generation) = (self.enrollments.clone(), self.hooks_generation);
        self.run(move || Done::Enrollment(generation, read(None).ok()));
    }
    /// `setEnabled`: one change at a time.
    fn set_hook(&mut self, provider: &'static str, enabled: bool) {
        if self.hook_pending.is_some() {
            return;
        }
        self.hook_pending = Some(provider);
        self.hook_error = None;
        let change = self.enrollments.clone();
        self.run(move || Done::Mutated(change(Some((provider, enabled))).map_err(|_| provider)));
    }
    /// Dev-capture: the lab's detected agents and a fresh machine's Hooks
    /// instead of this machine's.
    #[cfg(feature = "dev-capture")]
    pub fn lab_fixture(&mut self) {
        use crate::platform::agent_activity::registration::PROVIDERS;
        self.scanning = false;
        self.installations = Some(local_agent_inventory::lab_installations());
        self.enrollments = std::sync::Arc::new(|_| {
            Ok(PROVIDERS
                .iter()
                .map(
                    |&(provider_id, display_name, configurable)| ProviderStatus {
                        provider_id,
                        display_name,
                        enrollment: if configurable {
                            Enrollment::NotConfigured
                        } else {
                            Enrollment::BasicOnly
                        },
                        configurable,
                    },
                )
                .collect())
        });
        self.hooks = (self.enrollments)(None).unwrap_or_default();
        self.hooks_phase = HooksPhase::Ready;
    }
    #[cfg(test)]
    fn with_enrollments(&mut self, enrollments: Enrollments) {
        self.enrollments = enrollments;
        self.read_enrollment(false);
    }
    /// Category rows for the Settings page (rendered inside its section).
    fn categories(&self, t: Theme, cx: &mut Context<Self>) -> Vec<SettingsCategory> {
        use crate::features::desktop_agent::ui::agent_brand_mark::{
            LauncherIdentity, launcher_icon,
        };
        let dark = cx.is_dark();
        let scanning = self.scanning || self.installations.is_none();
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
            h_flex()
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
        };
        let control_row = move || table_row().hover(move |s| s.bg(t.hover));
        let identity = |icon: AnyElement, name: String| {
            h_flex()
                .gap(px(8.))
                .min_w_0()
                .child(icon)
                .child(div().truncate().text_color(t.text).child(name))
        };
        let agent_icon = |runtime| {
            launcher_icon(LauncherIdentity::Runtime(runtime), false, dark, t.muted)
                .into_any_element()
        };
        // `.desktop-local-agent-group-action`: a 20px quiet text action whose
        // RefreshCw turns while loading.
        let group_action =
            |id: &'static str, label: &'static str, spinning: bool, disabled: bool| {
                let icon = Icon::new("refresh-cw").xsmall().stroke(2.).color(t.subtle);
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
                    .when(disabled, |d| d.opacity(0.55))
                    .when(!disabled, |d| {
                        d.hover(move |s| s.bg(t.hover).text_color(t.text))
                    })
                    .child(if spinning {
                        icon.spinning(SharedString::from(format!("{id}-spin")))
                    } else {
                        icon
                    })
                    .child(label)
            };
        let mut rows: Vec<AnyElement> = vec![];
        for (index, agent) in detected.iter().enumerate() {
            let id = agent.id;
            let visible = prefs.agent_visible(id);
            let store = self.preferences.clone();
            let name = display_name(agent);
            rows.push(
                control_row()
                    .child(identity(agent_icon(agent.runtime), name.clone()))
                    .child(
                        Switch::new(
                            ("agent-visible", index),
                            tf("settings.localAgents.toggle", &[("agent", name.into())]),
                        )
                        .checked(visible)
                        .on_change(move |on, _, cx| {
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
                        }),
                    )
                    .into_any_element(),
            );
        }
        if detected.is_empty() {
            let key = if scanning {
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
            false,
        )
        .on_click(cx.listener(|s, _, _, cx| {
            s.refresh();
            cx.notify();
        }))
        .into_any_element();
        let store = self.preferences.clone();
        let history = control_row()
            .child(t_static("settings.localAgents.history.toggle"))
            .child(
                Switch::new(
                    "chat-history-discovery",
                    t_static("settings.localAgents.history.toggle"),
                )
                .checked(prefs.local_agents.chat_history_discovery)
                .on_change(move |on, _, cx| {
                    store.update(cx, |p, cx| {
                        p.change(|p| p.local_agents.chat_history_discovery = on, cx)
                    })
                }),
            )
            .into_any_element();

        // `LocalAgentHooksSettingsSection`: configurable providers that are
        // detected or already carry PuppyOne's Hook.
        let loading = self.hooks_phase == HooksPhase::Loading || scanning;
        let selectable: Vec<&ProviderStatus> = self
            .hooks
            .iter()
            .filter(|p| {
                p.configurable
                    && (detected.iter().any(|i| i.id == p.provider_id)
                        || matches!(p.enrollment, Enrollment::Enabled | Enrollment::NeedsRepair))
            })
            .collect();
        let mut hooks: Vec<AnyElement> = selectable
            .iter()
            .map(|provider| {
                let id = provider.provider_id;
                let installed = provider.enrollment == Enrollment::Enabled;
                let pending = self.hook_pending == Some(id);
                let icon = local_agent_inventory::runtime_for(id)
                    .map_or_else(|| div().size(px(18.)).into_any_element(), agent_icon);
                // The row is the checkbox's `<label>`.
                control_row()
                    .id(SharedString::from(format!("agent-hook-{id}")))
                    .when(pending, |d| d.opacity(0.62))
                    .when(!pending, |d| d.cursor(theme::clickable_cursor()))
                    .child(identity(icon, provider.display_name.to_owned()))
                    .child(native_checkbox(installed, cx))
                    .when(!pending, |d| {
                        d.on_click(cx.listener(move |s, _, _, cx| {
                            s.set_hook(id, !installed);
                            cx.notify();
                        }))
                    })
                    .into_any_element()
            })
            .collect();
        if loading && selectable.is_empty() {
            hooks.push(
                table_row()
                    .child(t_static("settings.localAgentHooks.loading"))
                    .into_any_element(),
            );
        }
        if self.hooks_phase == HooksPhase::Ready && !loading && selectable.is_empty() {
            hooks.push(
                table_row()
                    .child(t_static("settings.localAgentHooks.empty"))
                    .into_any_element(),
            );
        }
        if self.hooks_phase == HooksPhase::Error {
            hooks.push(
                control_row()
                    .child(t_static("settings.localAgentHooks.error"))
                    .child(
                        Button::new("retry-agent-hooks")
                            .label(t_static("settings.localAgentHooks.retry"))
                            .on_click(cx.listener(|s, _, _, cx| {
                                s.read_enrollment(true);
                                cx.notify();
                            })),
                    )
                    .into_any_element(),
            );
        }
        let busy = loading || self.hook_pending.is_some();
        let refresh_hooks = group_action(
            "refresh-agent-hooks",
            t_static("settings.localAgentHooks.refresh"),
            loading,
            busy,
        )
        .when(!busy, |d| {
            d.on_click(cx.listener(|s, _, _, cx| {
                s.read_enrollment(true);
                cx.notify();
            }))
        })
        .into_any_element();
        vec![
            SettingsCategory::new(t_static("settings.localAgents.activeChat.title"))
                .action(scan)
                .body(table(rows)),
            SettingsCategory::new(t_static("settings.localAgents.history.title"))
                .body(table(vec![history])),
            SettingsCategory::new(t_static("settings.localAgentHooks.title"))
                .action(refresh_hooks)
                .body(table(hooks)),
        ]
    }
}
fn t_static(key: &str) -> &'static str {
    t(key)
}
impl Render for AgentSettings {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.palette();
        SettingsCategoryList::new().children(self.categories(t, cx))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use std::sync::{Arc, Mutex};
    #[gpui::test]
    fn a_hook_checkbox_installs_the_hook_and_turns_on_file_activity(cx: &mut TestAppContext) {
        cx.executor().allow_parking();
        cx.update(gpui_kit::init);
        let preferences = cx.new(|_| PreferencesStore::memory());
        let changes: Arc<Mutex<Vec<(&str, bool)>>> = Arc::default();
        let log = changes.clone();
        let enabled = Arc::new(Mutex::new(false));
        let state = enabled.clone();
        let enrollments: Enrollments = Arc::new(move |change| {
            if let Some((provider, on)) = change {
                if provider == "claude" {
                    return Err("AGENT_ACTIVITY_CONFIG_CONFLICT".into());
                }
                log.lock().unwrap().push((provider, on));
                *state.lock().unwrap() = on;
            }
            let on = *state.lock().unwrap();
            Ok(vec![
                ProviderStatus {
                    provider_id: "codex",
                    display_name: "Codex",
                    enrollment: if on {
                        Enrollment::Enabled
                    } else {
                        Enrollment::NotConfigured
                    },
                    configurable: true,
                },
                ProviderStatus {
                    provider_id: "claude",
                    display_name: "Claude Code",
                    enrollment: Enrollment::NotConfigured,
                    configurable: true,
                },
            ])
        });
        let (view, cx) = cx.add_window_view(|window, cx| {
            let mut view = AgentSettings::new(preferences.clone(), window, cx);
            view.with_enrollments(enrollments);
            view
        });
        let settle = |cx: &mut VisualTestContext| {
            for _ in 0..50 {
                cx.run_until_parked();
                if view.read_with(cx, |v, _| {
                    !v.scanning && v.hook_pending.is_none() && v.hooks_phase != HooksPhase::Loading
                }) {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        };
        settle(cx);
        view.update(cx, |v, cx| {
            assert_eq!(v.hooks.len(), 2);
            v.set_hook("codex", true);
            // One change at a time.
            v.set_hook("claude", true);
            cx.notify();
        });
        settle(cx);
        assert_eq!(*changes.lock().unwrap(), [("codex", true)]);
        assert!(preferences.read_with(cx, |p, _| p.state.agent_file_activity_indicators));
        view.update(cx, |v, _| v.set_hook("claude", true));
        settle(cx);
        view.read_with(cx, |v, _| assert_eq!(v.hook_error, Some("claude")));
        view.update(cx, |v, _| v.set_hook("codex", false));
        settle(cx);
        assert!(!preferences.read_with(cx, |p, _| p.state.agent_file_activity_indicators));
    }
}
