//! Port of `CloudComputerSettings.tsx`: per-project `Desktop` and `Show screen`
//! choices backed by `GET /projects/{id}/workbench` and
//! `PUT /projects/{id}/workbench/sandbox`.
use super::super::settings_workspace_surface::{SettingsEvent, SettingsWorkspaceSurface};
use super::Page;
use crate::{
    cloud::auth::Cancellation,
    features::cloud::account,
    localization::t as tr,
    theme::{self, Theme, metric},
    ui::components::{Icon, MutedRow, SettingsSection},
    workspace::cloud::sandbox::{
        CloudSandbox, SandboxSettings, fetch_project_sandbox, update_project_sandbox,
    },
};
use gpui::{prelude::*, *};
use gpui_kit::{
    base::{h_flex, v_flex},
    component::Sizable as _,
};

#[derive(Clone, Copy, PartialEq, Eq)]
enum SavingKey {
    Desktop,
    Stream,
    IsolatedAgents,
}

#[derive(Default)]
pub(in crate::features::settings) struct ComputerPage {
    project: Option<String>,
    sandbox: Option<CloudSandbox>,
    saving: Option<SavingKey>,
    failed: bool,
    task: Option<Task<()>>,
}

impl SettingsWorkspaceSurface {
    pub(in crate::features::settings) fn load_cloud_computer(&mut self, cx: &mut Context<Self>) {
        let Some(project) = self.cloud_project.clone() else {
            self.computer_page = ComputerPage::default();
            return;
        };
        let Some((broker, binding)) = account::broker_and_binding(cx) else {
            self.computer_page = ComputerPage::default();
            return;
        };
        if self.computer_page.project.as_deref() != Some(project.as_str()) {
            self.computer_page.sandbox = None;
        }
        self.computer_page.project = Some(project.clone());
        self.computer_page.saving = None;
        self.computer_page.failed = false;

        let cancel = Cancellation::default();
        self.computer_page.task = Some(cx.spawn(async move |this, cx| {
            let fetched = cx
                .background_executor()
                .spawn({
                    let project = project.clone();
                    async move { fetch_project_sandbox(&broker, &binding, &project, &cancel) }
                })
                .await;
            let _ = this.update(cx, |s, cx| {
                if s.computer_page.project.as_deref() != Some(project.as_str()) {
                    return;
                }
                match fetched {
                    Ok(sandbox) => {
                        s.computer_page.sandbox = Some(sandbox);
                        s.computer_page.failed = false;
                    }
                    Err(_) => {
                        s.computer_page.sandbox = Some(CloudSandbox::default());
                        s.computer_page.failed = true;
                    }
                }
                cx.notify();
            });
        }));
    }

    fn save_cloud_computer(&mut self, key: SavingKey, value: bool, cx: &mut Context<Self>) {
        if self.computer_page.saving.is_some() || self.computer_page.sandbox.is_none() {
            return;
        }
        let Some(project) = self.cloud_project.clone() else {
            return;
        };
        let Some((broker, binding)) = account::broker_and_binding(cx) else {
            return;
        };
        self.computer_page.saving = Some(key);
        self.computer_page.failed = false;
        cx.notify();

        let patch = match key {
            SavingKey::Desktop => SandboxSettings {
                desktop: Some(value),
                ..Default::default()
            },
            SavingKey::Stream => SandboxSettings {
                screen_stream: Some(value),
                ..Default::default()
            },
            SavingKey::IsolatedAgents => SandboxSettings {
                isolated_agent_sandboxes: Some(value),
                ..Default::default()
            },
        };
        let cancel = Cancellation::default();
        self.computer_page.task = Some(cx.spawn(async move |this, cx| {
            let result =
                cx.background_executor()
                    .spawn({
                        let project = project.clone();
                        async move {
                            update_project_sandbox(&broker, &binding, &project, patch, &cancel)
                        }
                    })
                    .await;
            let _ = this.update(cx, |s, cx| {
                if s.computer_page.project.as_deref() != Some(project.as_str()) {
                    return;
                }
                s.computer_page.saving = None;
                match result {
                    Ok(updated) => {
                        s.computer_page.sandbox = Some(updated.clone());
                        s.computer_page.failed = false;
                        cx.emit(SettingsEvent::CloudSandboxChanged {
                            project,
                            sandbox: updated,
                        });
                    }
                    Err(_) => {
                        s.computer_page.failed = true;
                    }
                }
                cx.notify();
            });
        }));
    }

    pub(super) fn cloud_computer(&self, t: Theme, cx: &mut Context<Self>) -> AnyElement {
        let sandbox = self.computer_page.sandbox.as_ref();
        let show_desktop = crate::features::flags::cloud_screen_enabled(&self.preferences, cx);
        let show_isolated_agents =
            crate::features::flags::isolated_agent_sandboxes_enabled(&self.preferences, cx);
        let desktop_on = sandbox.is_some_and(CloudSandbox::desktop_enabled);
        let stream_on = sandbox.is_none_or(CloudSandbox::stream_enabled);
        let isolated_agents_on =
            sandbox.is_some_and(CloudSandbox::isolated_agent_sandboxes_enabled);
        let pending = sandbox.is_some_and(CloudSandbox::desktop_pending);
        let disabled = sandbox.is_none() || self.computer_page.saving.is_some();

        let meta = theme::ty().ui.meta;
        let desktop_help = tr(if pending {
            "cloud.settings.computer.desktopPending"
        } else {
            "cloud.settings.computer.desktopHelp"
        });
        let stream_help = tr("cloud.settings.computer.streamHelp");
        let isolated_agents_help = tr("cloud.settings.computer.isolatedAgentsHelp");

        let card = |id: &'static str,
                    key: SavingKey,
                    on: bool,
                    title: &'static str,
                    help: &'static str,
                    cx: &mut Context<Self>| {
            let border = if on { t.accent } else { t.border_subtle };
            let bg = if on {
                theme::fade(t.accent, 0.08)
            } else {
                theme::fade(t.accent, 0.)
            };
            v_flex()
                .id(id)
                .debug_selector(move || id.to_string())
                .flex_1()
                .min_w_0()
                .p(px(14.))
                .gap(px(6.))
                .rounded(px(metric::CONTROL_RADIUS + 2.))
                .border_1()
                .border_color(border)
                .bg(bg)
                .when(!disabled, |d| {
                    d.cursor(theme::clickable_cursor())
                        .hover(|s| {
                            s.bg(if on {
                                theme::fade(t.accent, 0.13)
                            } else {
                                t.hover
                            })
                        })
                        .on_click(cx.listener(move |s, _, _, cx| {
                            s.save_cloud_computer(key, !on, cx);
                        }))
                })
                .child(
                    h_flex()
                        .w_full()
                        .items_center()
                        .justify_between()
                        .gap(px(8.))
                        .child(
                            div()
                                .text_size(px(theme::ty().ui.label))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(if disabled { t.text_disabled } else { t.text })
                                .child(title),
                        )
                        .child(
                            div()
                                .size(px(18.))
                                .rounded(px(5.))
                                .border_1()
                                .border_color(if on { t.accent } else { t.border_subtle })
                                .bg(if on {
                                    theme::fade(t.accent, 0.18)
                                } else {
                                    theme::fade(t.accent, 0.)
                                })
                                .flex()
                                .items_center()
                                .justify_center()
                                .when(on, |d| {
                                    d.child(
                                        Icon::new("check")
                                            .with_size(px(12.))
                                            .stroke(2.)
                                            .color(t.accent),
                                    )
                                }),
                        ),
                )
                .child(
                    div()
                        .text_size(px(meta))
                        .line_height(relative(1.45))
                        .text_color(t.subtle)
                        .child(help),
                )
        };

        let mut section = SettingsSection::new(tr(Page::CloudComputer.title())).child(
            div()
                .pb(px(12.))
                .text_size(px(meta))
                .line_height(relative(1.45))
                .text_color(t.subtle)
                .child(tr("cloud.settings.computer.detail")),
        );
        if self.computer_page.failed {
            section = section.child(
                div()
                    .pb(px(10.))
                    .child(MutedRow::new(tr("cloud.settings.computer.failed")).danger()),
            );
        }
        let mut rows = v_flex().w_full().gap(px(12.));
        if show_desktop {
            rows = rows.child(
                h_flex()
                    .w_full()
                    .items_stretch()
                    .gap(px(12.))
                    .child(card(
                        "cloud-computer-desktop-toggle",
                        SavingKey::Desktop,
                        desktop_on,
                        tr("cloud.settings.computer.desktop"),
                        desktop_help,
                        cx,
                    ))
                    .child(card(
                        "cloud-computer-stream-toggle",
                        SavingKey::Stream,
                        stream_on,
                        tr("cloud.settings.computer.stream"),
                        stream_help,
                        cx,
                    )),
            );
        }
        if show_isolated_agents {
            rows = rows.child(h_flex().w_full().items_stretch().gap(px(12.)).child(card(
                "cloud-computer-isolated-agents-toggle",
                SavingKey::IsolatedAgents,
                isolated_agents_on,
                tr("cloud.settings.computer.isolatedAgents"),
                isolated_agents_help,
                cx,
            )));
        }
        section.child(rows).into_any_element()
    }

    #[cfg(test)]
    pub fn cloud_computer_state(&self) -> Option<(bool, bool, bool, bool)> {
        let sandbox = self.computer_page.sandbox.as_ref()?;
        Some((
            sandbox.desktop_enabled(),
            sandbox.stream_enabled(),
            sandbox.desktop_pending(),
            self.computer_page.failed,
        ))
    }
}
