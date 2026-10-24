//! Port of `RepositorySettingsViews.tsx`: `GitSettingsView` and the Host
//! Server page (`CloudHostingSettingsView` with
//! `PuppyoneWorkspaceConfigSettings` over `.puppyone/config.json`).
use super::super::{
    repository_settings::{is_puppyone_remote, mask_remote_url, remote_kind_label},
    settings_workspace_surface::SettingsWorkspaceSurface,
    workspace_config,
};
use super::Page;
use crate::{
    localization::{t as tr, tf},
    theme::{self, Theme},
    ui::components::{
        Button, ButtonVariant, MutedRow, Select, SelectOption, SettingRow, SettingsSection,
        SettingsSubsection, Switch, ValueRow,
    },
};
use gpui::{prelude::*, *};
use gpui_kit::base::{Disableable as _, h_flex};
impl SettingsWorkspaceSurface {
    fn refresh_action(&self, cx: &mut Context<Self>) -> Button {
        let loading = self.repository.read(cx).loading;
        Button::new("refresh-repository")
            .icon(if loading {
                "loader-circle"
            } else {
                "refresh-cw"
            })
            .label(tr("common.action.refresh"))
            .disabled(loading)
            .on_click(cx.listener(|s, _, _, cx| s.repository.update(cx, |r, cx| r.refresh(cx))))
    }
    /// Shared error/loading/not-a-repository states (`desktop-settings-lead-state`).
    fn repository_state(&self, cx: &App) -> Option<MutedRow> {
        let repo = self.repository.read(cx);
        if let Some(error) = &repo.error {
            return Some(MutedRow::new(error.clone()).danger().min_h(px(54.)));
        }
        match &repo.info {
            None => Some(MutedRow::new(tr("settings.git.reading")).min_h(px(54.))),
            Some(info) if !info.is_repo => {
                Some(MutedRow::new(tr("settings.git.notRepository")).min_h(px(54.)))
            }
            _ => None,
        }
    }
    pub(super) fn host_server(&mut self, t: Theme, cx: &mut Context<Self>) -> AnyElement {
        let content = SettingsSection::new(tr(Page::Host.title())).action(self.refresh_action(cx));
        match self.repository_state(cx) {
            Some(state) => content.child(state),
            None => content.child(self.workspace_config(t, cx)),
        }
        .into_any_element()
    }
    /// `PuppyoneWorkspaceConfigSettings` (`.desktop-puppyone-config-*`).
    fn workspace_config(&mut self, t: Theme, cx: &mut Context<Self>) -> SettingsSubsection {
        const CLOUD_ENABLED: bool = true;
        let repo = self.repository.read(cx);
        let Some(saved) = repo.config.clone() else {
            return SettingsSubsection::new()
                .lead(true)
                .child(MutedRow::new(tr("settings.workspaceConfig.reading")));
        };
        let saving = repo.config_saving;
        let error = repo.config_error.clone();
        let info = repo.info.clone().unwrap_or_default();
        let saved = saved.draft(CLOUD_ENABLED);
        // `useEffect(setDraft(normalize(config)))` whenever the saved document changes.
        if self.hosting_base.as_ref() != Some(&saved) {
            self.hosting_base = Some(saved.clone());
            self.hosting_draft = saved.clone();
            let (source, backup) = (saved.source_branch.clone(), saved.backup_branch.clone());
            self.hosting_branch
                .update(cx, |i, cx| i.set_text(source.unwrap_or_default(), cx));
            self.hosting_backup_branch
                .update(cx, |i, cx| i.set_text(backup.unwrap_or_default(), cx));
        }
        // The branch fields are the draft's source of truth for their values.
        let field = |input: &Entity<crate::ui::form_input::TextInput>, cx: &App| {
            Some(input.read(cx).text().trim().to_owned()).filter(|s| !s.is_empty())
        };
        let source_branch = field(&self.hosting_branch, cx);
        if self.hosting_draft.source_service != workspace_config::Service::Puppyone {
            self.hosting_draft.source_branch = source_branch.clone();
            self.hosting_draft.watched_branch = source_branch;
        }
        if self.hosting_draft.backup_service != workspace_config::Service::Puppyone {
            self.hosting_draft.backup_branch = field(&self.hosting_backup_branch, cx);
        }
        let draft = self.hosting_draft.draft(CLOUD_ENABLED);
        let dirty = !draft.same(&saved);
        let m = theme::ty();
        let current_branch = info
            .branch
            .clone()
            .filter(|b| b != "detached")
            .unwrap_or_else(|| tr("settings.workspaceConfig.currentBranch").into());
        let remote_names = |service: workspace_config::Service| -> Vec<String> {
            info.remotes
                .iter()
                .filter(|r| {
                    let url = r.fetch_url.as_deref().or(r.push_url.as_deref());
                    match service {
                        workspace_config::Service::Puppyone => {
                            url.is_some_and(|u| u.to_lowercase().contains("puppyone"))
                        }
                        workspace_config::Service::Github => remote_kind_label(url) == "GitHub",
                        workspace_config::Service::Custom => true,
                    }
                })
                .map(|r| r.name.clone())
                .collect()
        };
        let host = cx.weak_entity();
        let remote_select = |id: &'static str, service, value: Option<String>, backup: bool| {
            let names = remote_names(service);
            let value = value.filter(|v| names.contains(v));
            let label: SharedString = value
                .clone()
                .unwrap_or_else(|| tr("settings.workspaceConfig.auto").into())
                .into();
            let host = host.clone();
            Select::new(id, label, move |_| {
                std::iter::once(None)
                    .chain(names.iter().cloned().map(Some))
                    .map(|choice| {
                        let host = host.clone();
                        let text = choice
                            .clone()
                            .unwrap_or_else(|| tr("settings.workspaceConfig.auto").into());
                        SelectOption::new(text)
                            .selected(choice == value)
                            .on_select(move |_, cx| {
                                let choice = choice.clone();
                                let _ = host.update(cx, |s, cx| {
                                    if backup {
                                        s.hosting_draft.backup_remote = choice;
                                    } else {
                                        s.hosting_draft.source_remote = choice.clone();
                                        s.hosting_draft.primary_remote = choice;
                                    }
                                    cx.notify();
                                });
                            })
                    })
                    .collect()
            })
            .width_range(220., 220.)
            .disabled(saving)
        };
        // `.desktop-settings-text-input`: 220×28, 9px inset, 13px over `--po-input`.
        let text_input = |input: &Entity<crate::ui::form_input::TextInput>,
                          placeholder: String,
                          cx: &mut Context<Self>| {
            input.update(cx, |i, _| {
                i.appearance = false;
                i.prompt_text = Some((m.ui.meta, 17.));
                i.placeholder_color = Some(t.subtle);
                i.set_placeholder(placeholder);
                i.min_height = 17.;
            });
            div()
                .w(px(220.))
                .h(px(theme::control_compact()))
                .px(px(5.))
                .flex()
                .items_center()
                .border_1()
                .border_color(t.divider)
                .rounded(px(6.))
                .bg(t.input)
                .when(saving, |d| d.opacity(0.62))
                .child(div().w_full().child(input.clone()))
        };
        let config_row = |label: String, control: AnyElement| {
            SettingRow::new(label)
                .control(control)
                .py(px(7.))
                .into_any_element()
        };
        // `.desktop-hosting-service-options`: a 2px-inset group; the active
        // option is raised with a 1px divider ring.
        let mut services = h_flex()
            .gap(px(3.))
            .p(px(2.))
            .border_1()
            .border_color(t.divider)
            .rounded(px(7.))
            .bg(t.control);
        for service in [
            workspace_config::Service::Puppyone,
            workspace_config::Service::Github,
        ] {
            if service == workspace_config::Service::Puppyone && !CLOUD_ENABLED {
                continue;
            }
            let active = draft.source_service == service;
            let names = remote_names(service);
            let fallback = self.hosting_draft.source_remote.clone();
            services = services.child(
                div()
                    .id(SharedString::from(format!(
                        "hosting-service-{}",
                        service.key()
                    )))
                    .h(px(theme::control_compact()))
                    .min_w(px(82.))
                    .px(px(9.))
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(px(5.))
                    .text_size(px(m.ui.meta))
                    .line_height(px(m.ui.meta))
                    .text_color(if active { t.text } else { t.muted })
                    .relative()
                    // `box-shadow: 0 0 0 1px var(--po-divider)`: a ring
                    // outside the option, so it never narrows the label box.
                    .when(active, |d| {
                        d.bg(t.panel_raised).font_weight(FontWeight::MEDIUM).child(
                            div()
                                .absolute()
                                .top(px(-1.))
                                .left(px(-1.))
                                .right(px(-1.))
                                .bottom(px(-1.))
                                .rounded(px(6.))
                                .border_1()
                                .border_color(t.divider),
                        )
                    })
                    .when(saving, |d| d.opacity(0.62))
                    .when(!active && !saving, |d| {
                        d.hover(move |s| s.bg(t.hover).text_color(t.text))
                            .cursor(theme::clickable_cursor())
                            .on_click(cx.listener(move |s, _, _, cx| {
                                // `selectSourceService` / `inferBackupRemote`.
                                let remote = match service {
                                    workspace_config::Service::Puppyone => {
                                        names.first().cloned().or(fallback.clone())
                                    }
                                    _ => names.first().cloned(),
                                };
                                let branch = (service != workspace_config::Service::Puppyone)
                                    .then(|| s.hosting_draft.source_branch.clone())
                                    .flatten();
                                s.hosting_draft.set_source(service, remote, branch);
                                cx.notify();
                            }))
                    })
                    .child(service.label()),
            );
        }
        let mut rows: Vec<AnyElement> = vec![config_row(
            tr("settings.workspaceConfig.sourceService.title").into(),
            services.into_any_element(),
        )];
        if draft.source_service != workspace_config::Service::Puppyone {
            rows.push(config_row(
                tr("settings.workspaceConfig.gitRemote.title").into(),
                remote_select(
                    "hosting-remote",
                    draft.source_service,
                    draft.source_remote.clone(),
                    false,
                )
                .into_any_element(),
            ));
            let branch = self.hosting_branch.clone();
            rows.push(config_row(
                tr("settings.workspaceConfig.gitBranch.title").into(),
                text_input(&branch, current_branch.clone(), cx).into_any_element(),
            ));
        }
        rows.push(config_row(
            tr("settings.workspaceConfig.backupEnabled.title").into(),
            Switch::new(
                "hosting-backup",
                tr("settings.workspaceConfig.backupEnabled.title"),
            )
            .checked(draft.backup_enabled)
            .disabled(saving)
            .on_change({
                let host = cx.weak_entity();
                move |on, _, cx| {
                    let _ = host.update(cx, |s, cx| {
                        s.hosting_draft.backup_enabled = on;
                        cx.notify();
                    });
                }
            })
            .into_any_element(),
        ));
        if draft.backup_enabled {
            let target = draft.backup_service;
            let host = cx.weak_entity();
            let targets: Vec<workspace_config::Service> = [
                workspace_config::Service::Puppyone,
                workspace_config::Service::Github,
            ]
            .into_iter()
            .filter(|s| CLOUD_ENABLED || *s != workspace_config::Service::Puppyone)
            .collect();
            let remotes = info.remotes.clone();
            rows.push(config_row(
                tr("settings.workspaceConfig.backupTarget.title").into(),
                Select::new("hosting-backup-target", target.label(), move |_| {
                    targets
                        .iter()
                        .map(|service| {
                            let host = host.clone();
                            let service = *service;
                            let remotes = remotes.clone();
                            SelectOption::new(service.label())
                                .selected(service == target)
                                .on_select(move |_, cx| {
                                    let remotes = remotes.clone();
                                    let _ = host.update(cx, |s, cx| {
                                        s.hosting_draft.backup_service = service;
                                        let pick = |f: &dyn Fn(Option<&str>) -> bool| {
                                            remotes
                                                .iter()
                                                .find(|r| {
                                                    f(r.fetch_url
                                                        .as_deref()
                                                        .or(r.push_url.as_deref()))
                                                })
                                                .map(|r| r.name.clone())
                                        };
                                        s.hosting_draft.backup_remote = match service {
                                            workspace_config::Service::Puppyone => pick(&|u| {
                                                u.is_some_and(|u| {
                                                    u.to_lowercase().contains("puppyone")
                                                })
                                            })
                                            .or(s.hosting_draft.backup_remote.clone()),
                                            _ => pick(&|u| remote_kind_label(u) == "GitHub"),
                                        };
                                        cx.notify();
                                    });
                                })
                        })
                        .collect()
                })
                .width_range(220., 220.)
                .disabled(saving)
                .into_any_element(),
            ));
            if target != workspace_config::Service::Puppyone {
                rows.push(config_row(
                    tr("settings.workspaceConfig.backupRemote.title").into(),
                    remote_select(
                        "hosting-backup-remote",
                        target,
                        draft.backup_remote.clone(),
                        true,
                    )
                    .into_any_element(),
                ));
                let branch = self.hosting_backup_branch.clone();
                rows.push(config_row(
                    tr("settings.workspaceConfig.backupBranch.title").into(),
                    text_input(&branch, current_branch.clone(), cx).into_any_element(),
                ));
            }
        }
        let status = error.unwrap_or_else(|| {
            tr(if dirty {
                "settings.workspaceConfig.unsaved"
            } else {
                "settings.workspaceConfig.upToDate"
            })
            .into()
        });
        let reset = Button::new("hosting-reset")
            .icon("refresh-cw")
            .label(tr("common.action.reset"))
            .disabled(!dirty || saving)
            .on_click(cx.listener(|s, _, _, cx| {
                s.hosting_base = None;
                cx.notify();
            }));
        let save_enabled = dirty && !saving;
        let save = Button::new("hosting-save")
            .variant(ButtonVariant::Success)
            .icon("check")
            .label(tr(if saving {
                "settings.workspaceConfig.saving"
            } else {
                "common.action.save"
            }))
            .disabled(!save_enabled)
            .on_click(cx.listener(move |s, _, _, cx| {
                let config = draft.clone();
                s.repository.update(cx, |r, cx| r.save_config(config, cx));
            }));
        // `.desktop-puppyone-config-footer`.
        rows.push(
            h_flex()
                .w_full()
                .min_h(px(40.))
                .justify_between()
                .gap(px(12.))
                .px(px(10.))
                .py(px(7.))
                .text_size(px(m.ui.hint))
                .text_color(t.subtle)
                .child(div().min_w_0().truncate().child(status))
                .child(h_flex().gap(px(6.)).child(reset).child(save))
                .into_any_element(),
        );
        SettingsSubsection::new().lead(true).children(rows)
    }
    pub(super) fn git(&self, t: Theme, cx: &mut Context<Self>) -> AnyElement {
        let content = SettingsSection::new(tr(Page::Git.title())).action(self.refresh_action(cx));
        if let Some(state) = self.repository_state(cx) {
            return content.child(state).into_any_element();
        }
        let info = self.repository.read(cx).info.clone().unwrap_or_default();
        let repository = vec![
            ValueRow::new(
                tr("settings.git.branch"),
                info.branch
                    .clone()
                    .unwrap_or_else(|| tr("settings.git.detached").into()),
            )
            .into_any_element(),
            ValueRow::new(
                tr("settings.git.branches"),
                tf(
                    "settings.git.branchCounts",
                    &[
                        ("localCount", info.local_branches.into()),
                        ("remoteCount", info.remote_branches.into()),
                    ],
                ),
            )
            .into_any_element(),
            ValueRow::new(
                tr("settings.git.upstream"),
                info.upstream
                    .clone()
                    .unwrap_or_else(|| tr("settings.shared.notConfigured").into()),
            )
            .into_any_element(),
            ValueRow::new(
                tr("settings.git.syncStatus"),
                if info.upstream.is_some() {
                    tf(
                        "settings.git.syncCounts",
                        &[("ahead", info.ahead.into()), ("behind", info.behind.into())],
                    )
                } else {
                    tr("settings.git.localOnly").into()
                },
            )
            .into_any_element(),
            ValueRow::new(
                "HEAD",
                info.head
                    .as_ref()
                    // `shortCommit`: the first 8 characters.
                    .map(|h| h.chars().take(8).collect::<String>())
                    .unwrap_or_else(|| tr("settings.git.noCommits").into()),
            )
            .monospace(true)
            .into_any_element(),
        ];
        let mut remotes: Vec<AnyElement> = vec![];
        if info.remotes.is_empty() {
            remotes.push(MutedRow::new(tr("settings.git.noRemotes")).into_any_element());
        }
        for (index, remote) in info.remotes.iter().enumerate() {
            let url = remote.fetch_url.clone().or_else(|| remote.push_url.clone());
            let key: SharedString =
                format!("remote:{}:{}", remote.name, url.clone().unwrap_or_default()).into();
            let copied = self.is_copied(&key);
            let differs =
                matches!((&remote.fetch_url, &remote.push_url), (Some(f), Some(p)) if f != p);
            // `CopyAction`: always the Copy glyph; only the label changes.
            let copy = {
                let url = url.clone();
                Button::new(("copy-remote", index))
                    .icon("copy")
                    .label(tr(if copied {
                        "common.action.copied"
                    } else {
                        "common.action.copy"
                    }))
                    .disabled(url.is_none())
                    .on_click(cx.listener(move |s, _, _, cx| {
                        if let Some(url) = url.clone() {
                            s.copy(key.clone(), url, cx)
                        }
                    }))
            };
            remotes.push(
                remote_row(
                    index > 0,
                    remote.name.clone(),
                    url.as_deref(),
                    remote.branches,
                    differs,
                    t,
                )
                .child(copy)
                .into_any_element(),
            );
        }
        content
            .child(
                SettingsSubsection::new()
                    .title(tr("settings.git.repository"))
                    .lead(true)
                    .children(repository),
            )
            .child(
                SettingsSubsection::new()
                    .title(tr("settings.git.remotes"))
                    .children(remotes),
            )
            .into_any_element()
    }
}
/// `.desktop-settings-remote-setting`: a 48px grid of
/// `minmax(120px, .28fr) minmax(76px, auto) minmax(0, 1fr) auto` with 12px
/// gaps. The two `fr` tracks share the space the fixed tracks leave at
/// .28 : 1 (their factors sum past 1, so the space is fully divided), which
/// flex reproduces with zero bases, those grow factors and the 120px floor.
/// The caller appends the `CopyAction` as the last track.
fn remote_row(
    divided: bool,
    name: String,
    url: Option<&str>,
    branches: usize,
    push_differs: bool,
    t: Theme,
) -> Div {
    let track = |grow: f32| {
        let mut d = div().flex_basis(px(0.));
        d.style().flex_grow = Some(grow);
        d
    };
    let connected = is_puppyone_remote(url);
    // `.desktop-settings-badge(.connected)`.
    let badge = h_flex()
        .flex_shrink_0()
        .justify_center()
        .h(px(theme::control_mini()))
        .px(px(7.))
        .rounded_full()
        .bg(if connected {
            theme::alpha(t.success, 0.12)
        } else {
            t.control
        })
        .text_color(if connected { t.success } else { t.subtle })
        .text_size(px(theme::ty().ui.caption))
        .line_height(px(16.))
        .font_weight(FontWeight::MEDIUM)
        .child(if connected {
            "puppyone"
        } else {
            remote_kind_label(url)
        });
    let main = track(0.28)
        .min_w(px(120.))
        .overflow_hidden()
        .flex()
        .items_center()
        .gap(px(8.))
        .child(
            div()
                .min_w_0()
                .truncate()
                .text_color(t.text)
                .text_size(px(theme::ty().ui.label))
                .line_height(px(18.))
                .child(name),
        )
        .child(badge);
    let meta = div()
        .flex_none()
        .min_w(px(76.))
        .whitespace_nowrap()
        .text_color(t.subtle)
        .text_size(px(theme::ty().ui.meta))
        .line_height(px(17.))
        .child(tf(
            "settings.git.remoteBranchCount",
            &[("count", branches.into())],
        ));
    // `.desktop-settings-remote-setting-url`: end-aligned lines, 2px apart.
    // Each line spans the track and right-aligns its glyphs, since GPUI
    // rounds measured text widths up.
    let line = |text: SharedString| {
        div()
            .w_full()
            .min_w_0()
            .truncate()
            .text_right()
            .text_size(px(theme::ty().ui.hint))
            .line_height(px(17.))
            .child(text)
    };
    let address = track(1.)
        .min_w_0()
        .flex()
        .flex_col()
        .gap(px(2.))
        .child(
            line(
                url.map(mask_remote_url)
                    .unwrap_or_else(|| tr("settings.shared.notConfigured").into())
                    .into(),
            )
            .font_family(theme::MONO)
            .text_color(t.text),
        )
        .when(push_differs, |d| {
            d.child(line(tr("settings.git.pushUrlDiffers").into()).text_color(t.subtle))
        });
    h_flex()
        .w_full()
        .min_w_0()
        .min_h(px(48.))
        .gap(px(12.))
        .px(px(10.))
        .text_color(t.muted)
        .when(divided, |d| d.border_t_1().border_color(t.divider))
        .child(main)
        .child(meta)
        .child(address)
}
