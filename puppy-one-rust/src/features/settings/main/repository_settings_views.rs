//! Port of `RepositorySettingsViews.tsx`: `GitSettingsView` and the Host
//! Server page (`CloudHostingSettingsView`). Hosting configuration depends on
//! the Cloud workspace service, so that page states its unavailability.
use super::super::{
    components::*,
    repository_settings::{mask_remote_url, remote_kind_label},
    settings_workspace_surface::SettingsWorkspaceSurface,
};
use super::Page;
use crate::{
    localization::{t as tr, tf},
    theme::{self, Theme},
    ui::{Tone, action_button, column, row},
};
use gpui::{prelude::*, *};
impl SettingsWorkspaceSurface {
    fn refresh_action(&self, t: Theme, cx: &mut Context<Self>) -> AnyElement {
        let loading = self.repository.read(cx).loading;
        action_button(
            "refresh-repository",
            tr("common.action.refresh"),
            Some(if loading {
                "loader-circle"
            } else {
                "refresh-cw"
            }),
            Tone::Default,
            loading,
            t,
        )
        .on_click(cx.listener(|s, _, _, cx| s.repository.update(cx, |r, cx| r.refresh(cx))))
        .into_any_element()
    }
    /// Shared error/loading/not-a-repository states (`desktop-settings-lead-state`).
    fn repository_state(&self, t: Theme, cx: &App) -> Option<Div> {
        let repo = self.repository.read(cx);
        if let Some(error) = &repo.error {
            return Some(danger_row(error.clone(), t).min_h(px(54.)));
        }
        match &repo.info {
            None => Some(muted_row(tr("settings.git.reading"), t).min_h(px(54.))),
            Some(info) if !info.is_repo => {
                Some(muted_row(tr("settings.git.notRepository"), t).min_h(px(54.)))
            }
            _ => None,
        }
    }
    pub(super) fn host_server(&self, t: Theme, cx: &mut Context<Self>) -> Div {
        let action = self.refresh_action(t, cx);
        let content = section_with_action(tr(Page::Host.title()), Some(action), t);
        match self.repository_state(t, cx) {
            Some(state) => content.child(state),
            None => content.child(lead_list(vec![
                muted_row(
                    tf(
                        "settings.sidebar.notAvailable",
                        &[("section", tr("settings.sidebar.hostServer").into())],
                    ),
                    t,
                )
                .into_any_element(),
            ])),
        }
    }
    pub(super) fn git(&self, t: Theme, cx: &mut Context<Self>) -> Div {
        let action = self.refresh_action(t, cx);
        let content = section_with_action(tr(Page::Git.title()), Some(action), t);
        if let Some(state) = self.repository_state(t, cx) {
            return content.child(state);
        }
        let info = self.repository.read(cx).info.clone().unwrap_or_default();
        let repository = vec![
            value_row(
                tr("settings.git.branch"),
                info.branch
                    .clone()
                    .unwrap_or_else(|| tr("settings.git.detached").into()),
                false,
                None,
                t,
            )
            .into_any_element(),
            value_row(
                tr("settings.git.branches"),
                tf(
                    "settings.git.branchCounts",
                    &[
                        ("localCount", info.local_branches.into()),
                        ("remoteCount", info.remote_branches.into()),
                    ],
                ),
                false,
                None,
                t,
            )
            .into_any_element(),
            value_row(
                tr("settings.git.upstream"),
                info.upstream
                    .clone()
                    .unwrap_or_else(|| tr("settings.shared.notConfigured").into()),
                false,
                None,
                t,
            )
            .into_any_element(),
            value_row(
                tr("settings.git.syncStatus"),
                if info.upstream.is_some() {
                    tf(
                        "settings.git.syncCounts",
                        &[("ahead", info.ahead.into()), ("behind", info.behind.into())],
                    )
                } else {
                    tr("settings.git.localOnly").into()
                },
                false,
                None,
                t,
            )
            .into_any_element(),
            value_row(
                "HEAD",
                info.head
                    .as_ref()
                    .map(|h| h.chars().take(7).collect::<String>())
                    .unwrap_or_else(|| tr("settings.git.noCommits").into()),
                true,
                None,
                t,
            )
            .into_any_element(),
        ];
        let mut remotes: Vec<AnyElement> = vec![];
        if info.remotes.is_empty() {
            remotes.push(muted_row(tr("settings.git.noRemotes"), t).into_any_element());
        }
        for (index, remote) in info.remotes.iter().enumerate() {
            let url = remote.fetch_url.clone().or_else(|| remote.push_url.clone());
            let key: SharedString =
                format!("remote:{}:{}", remote.name, url.clone().unwrap_or_default()).into();
            let copied = self.is_copied(&key);
            let differs =
                matches!((&remote.fetch_url, &remote.push_url), (Some(f), Some(p)) if f != p);
            let copy = {
                let url = url.clone();
                action_button(
                    ("copy-remote", index),
                    tr(if copied {
                        "common.action.copied"
                    } else {
                        "common.action.copy"
                    }),
                    Some(if copied { "check" } else { "copy" }),
                    Tone::Default,
                    url.is_none(),
                    t,
                )
                .on_click(cx.listener(move |s, _, _, cx| {
                    if let Some(url) = url.clone() {
                        s.copy(key.clone(), url, cx)
                    }
                }))
            };
            remotes.push(
                row()
                    .w_full()
                    .gap(px(12.))
                    .px(px(10.))
                    .py(px(8.))
                    .rounded(px(6.))
                    .child(
                        column()
                            .flex_1()
                            .min_w_0()
                            .gap(px(3.))
                            .child(
                                row()
                                    .gap(px(8.))
                                    .child(
                                        div()
                                            .text_size(px(theme::ty().ui.label))
                                            .text_color(t.text)
                                            .child(remote.name.clone()),
                                    )
                                    .child(
                                        div()
                                            .px(px(6.))
                                            .rounded_full()
                                            .border_1()
                                            .border_color(t.border_subtle)
                                            .text_size(px(theme::ty().ui.caption))
                                            .text_color(t.subtle)
                                            .child(remote_kind_label(url.as_deref())),
                                    ),
                            )
                            .child(
                                div()
                                    .text_size(px(theme::ty().ui.caption))
                                    .text_color(t.subtle)
                                    .child(tf(
                                        "settings.git.remoteBranchCount",
                                        &[("count", remote.branches.into())],
                                    )),
                            )
                            .child(
                                div()
                                    .truncate()
                                    .font_family("Menlo")
                                    .text_size(px(theme::ty().ui.caption))
                                    .text_color(t.muted)
                                    .child(url.as_deref().map(mask_remote_url).unwrap_or_else(
                                        || tr("settings.shared.notConfigured").into(),
                                    )),
                            )
                            .when(differs, |d| {
                                d.child(
                                    div()
                                        .text_size(px(theme::ty().ui.caption))
                                        .text_color(t.subtle)
                                        .child(tr("settings.git.pushUrlDiffers")),
                                )
                            }),
                    )
                    .child(copy)
                    .into_any_element(),
            );
        }
        content
            .child(subsection(
                Some(tr("settings.git.repository").into()),
                None,
                true,
                repository,
                t,
            ))
            .child(subsection(
                Some(tr("settings.git.remotes").into()),
                None,
                false,
                remotes,
                t,
            ))
    }
}
