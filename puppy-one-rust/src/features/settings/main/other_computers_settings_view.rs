//! Port of `OtherComputersSettings.tsx` (Settings › Computer access, behind
//! `HOST_DEVICES_AVAILABLE`): this computer's sharing — pause, its shared
//! folders, start at login — and the owner's other computers, each of which
//! can be removed after the system's own confirmation (`host:revoke-device`).
use super::super::settings_workspace_surface::{SettingsEvent, SettingsWorkspaceSurface};
use super::Page;
use crate::{
    features::hosts::{self, HostLink},
    localization::{bidi_isolate, t as tr, tf},
    theme::{self, Theme},
    ui::components::{
        AnchoredMenu, Button, ButtonVariant, Icon, Menu, MenuItem, MutedRow, ProductIcon,
        SettingRow, SettingsSection, SettingsSubsection, Switch,
    },
};
use gpui::{prelude::*, *};
use gpui_kit::{
    base::{Disableable as _, h_flex, v_flex},
    component::Sizable as _,
};

impl SettingsWorkspaceSurface {
    /// The page shows: the catalog and this computer's host are read again
    /// (a host not running is not started for it), and followed.
    pub(in crate::features::settings) fn read_computers(&mut self, cx: &mut Context<Self>) {
        let catalog = hosts::global(cx);
        catalog.update(cx, |c, cx| c.ensure(true, true, true, cx));
        let link = hosts::host_link(cx);
        link.update(cx, |l, cx| {
            l.ensure(false, cx);
            l.refresh(cx);
        });
        self.computers = vec![
            cx.observe(&catalog, |_, _, cx| cx.notify()),
            cx.observe(&link, |_, _, cx| cx.notify()),
        ];
    }
    pub(super) fn other_computers(&mut self, t: Theme, cx: &mut Context<Self>) -> AnyElement {
        use crate::features::cloud::account::Status;
        let status = self
            .cloud
            .as_ref()
            .and_then(|c| c.read(cx).snapshot.as_ref().map(|s| s.status))
            .unwrap_or(Status::SignedOut);
        let restoring = status == Status::Restoring;
        let signed_in = crate::features::cloud::account::broker_and_binding(cx).is_some();
        let mut section = SettingsSection::new(tr(Page::OtherComputers.title()));
        if !signed_in || restoring {
            if !restoring {
                section = section.child(MutedRow::new(tr("hosts.settings.thisComputerDetail")));
            }
            let row = h_flex().px(px(10.)).py(px(6.));
            return section
                .child(if restoring {
                    row.child(MutedRow::new(tr("common.status.loading")))
                } else {
                    row.child(
                        Button::new("computers-sign-in")
                            .variant(ButtonVariant::OutlinePrimary)
                            .label(tr("settings.account.signInWithBrowser"))
                            .disabled(self.cloud.is_none())
                            .on_click(cx.listener(|s, _, _, cx| {
                                if let Some(cloud) = &s.cloud {
                                    cloud.read(cx).sign_in();
                                }
                            })),
                    )
                })
                .into_any_element();
        }
        section
            .child(self.this_computer(t, cx))
            .child(self.other_computer_list(t, cx))
            .children(
                hosts::read(cx)
                    .and_then(|c| c.action_error)
                    .map(|key| MutedRow::new(tr(key)).danger()),
            )
            .children(self.computer_menu(cx))
            .into_any_element()
    }
    fn this_computer(&self, t: Theme, cx: &mut Context<Self>) -> SettingsSubsection {
        let catalog = hosts::read(cx);
        let link = hosts::read_link(cx);
        let sharing = link.and_then(HostLink::sharing);
        let this_device = catalog.and_then(|c| c.this_device.clone());
        let mine = catalog.and_then(|c| {
            c.devices()
                .iter()
                .find(|d| Some(&d.id) == this_device.as_ref())
        });
        let rows = hosts::shared_rows(sharing.as_ref(), mine);
        let local_name = mine.map_or_else(
            || tr("hosts.settings.thisComputer").to_owned(),
            |d| d.name.clone(),
        );
        let no_folders =
            hosts::no_folders(rows.as_deref(), sharing.as_ref(), this_device.as_deref());
        let pending = catalog.is_some_and(|c| c.pending);
        let outdated = sharing.as_ref().is_some_and(|s| s.state == "outdated");
        let can_pause = this_device.is_some() && !no_folders && !outdated;
        let paused = sharing.as_ref().is_some_and(|s| s.paused);
        let presence = hosts::sharing_status(sharing.as_ref(), rows.as_ref().map(Vec::len));
        let mut device = computer_row(t, "this-computer", local_name.clone(), presence);
        if can_pause {
            device = device.child(
                Button::new("sharing-pause")
                    .label(tr(if paused {
                        "hosts.sharing.resume"
                    } else {
                        "hosts.sharing.pause"
                    }))
                    .disabled(pending)
                    .on_click(cx.listener(move |_, _, _, cx| {
                        hosts::host_link(cx).update(cx, |l, cx| l.set_paused(!paused, cx));
                    })),
            );
        }
        if let Some(id) = this_device.clone() {
            device = device.child(self.computer_more(id, local_name, true, pending, cx));
        }
        let mut list = SettingsSubsection::new()
            .title(tr("hosts.settings.localSharing"))
            .child(device);
        if no_folders {
            list = list.child(MutedRow::new(tr("hosts.settings.emptyFolders")));
        }
        for row in rows.into_iter().flatten() {
            list = list.child(self.folder_row(t, row, pending, cx));
        }
        if let Some(autostart) =
            HostLink::autostart().filter(|_| this_device.is_some() && !no_folders)
        {
            let surface = cx.weak_entity();
            let on = autostart.enabled();
            list = list.child(
                SettingRow::new(tr("hosts.sharing.startAtLogin")).control(
                    Switch::new("start-at-login", tr("hosts.sharing.startAtLogin"))
                        .checked(on)
                        .disabled(pending)
                        .on_change(move |enabled, _, cx| {
                            autostart.set(enabled);
                            let _ = surface.update(cx, |_, cx| cx.notify());
                        }),
                ),
            );
        }
        list
    }
    fn folder_row(
        &self,
        t: Theme,
        row: hosts::SharedRow,
        pending: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let ty = theme::ty();
        let (folder, name) = (row.id.clone(), row.name.clone());
        h_flex()
            .id(SharedString::from(format!("shared-folder-{}", row.id)))
            .w_full()
            .min_h(px(32.))
            .gap(px(8.))
            .pl(px(36.))
            .pr(px(10.))
            .rounded(px(6.))
            .text_size(px(ty.ui.body))
            .text_color(t.text)
            .child(
                Icon::product(ProductIcon::Folder)
                    .with_size(px(14.))
                    .color(t.muted),
            )
            .child(div().flex_1().min_w_0().truncate().child(row.name))
            .child(
                div()
                    .text_size(px(ty.ui.meta))
                    .text_color(t.subtle)
                    .child(tr(if row.writable {
                        "hosts.catalog.editable"
                    } else {
                        "hosts.catalog.readOnly"
                    })),
            )
            .when(row.manageable, |d| {
                d.child(
                    Icon::new("chevron-right")
                        .with_size(px(13.))
                        .color(t.subtle),
                )
                .when(!pending, |d| {
                    d.cursor(theme::clickable_cursor())
                        .hover(|d| d.bg(t.hover))
                        .on_click(cx.listener(move |_, _, _, cx| {
                            cx.emit(SettingsEvent::FolderSharing {
                                folder: folder.clone(),
                                name: name.clone(),
                            })
                        }))
                })
            })
            .into_any_element()
    }
    fn other_computer_list(&self, t: Theme, cx: &mut Context<Self>) -> SettingsSubsection {
        let catalog = hosts::read(cx);
        let failed = catalog.is_some_and(|c| c.error());
        let pending = catalog.is_some_and(|c| c.pending);
        let mut list = SettingsSubsection::new().title(tr("hosts.settings.others"));
        if failed {
            list = list.child(
                h_flex()
                    .w_full()
                    .justify_between()
                    .px(px(10.))
                    .py(px(4.))
                    .text_size(px(theme::ty().ui.body))
                    .text_color(t.muted)
                    .child(tr("hosts.catalog.unavailable"))
                    .child(
                        Button::new("computers-retry")
                            .label(tr("common.action.retry"))
                            .disabled(catalog.is_some_and(|c| c.reading()))
                            .on_click(cx.listener(|_, _, _, cx| {
                                hosts::global(cx).update(cx, |c, cx| c.ensure(true, true, true, cx))
                            })),
                    ),
            );
        }
        let Some(catalog) = catalog.filter(|c| c.loaded()) else {
            return if failed {
                list
            } else {
                list.child(MutedRow::new(tr("common.status.loading")))
            };
        };
        let now = chrono::Utc::now().timestamp();
        let others: Vec<_> = catalog
            .others()
            .map(|d| {
                let presence = hosts::presence(d.online, d.last_seen_at.as_deref(), now);
                (d.id.clone(), d.name.clone(), presence)
            })
            .collect();
        if others.is_empty() && !failed {
            return list.child(MutedRow::new(tr("hosts.settings.noOthers")));
        }
        for (id, name, presence) in others {
            list = list.child(
                computer_row(t, &id, name.clone(), presence)
                    .child(self.computer_more(id, name, false, pending, cx)),
            );
        }
        list
    }
    /// `ComputerActionsMenu`'s trigger.
    fn computer_more(
        &self,
        id: String,
        name: String,
        current: bool,
        pending: bool,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        Button::new(SharedString::from(format!("computer-more-{id}")))
            .variant(ButtonVariant::Ghost)
            .icon(Icon::new("ellipsis").with_size(px(16.)))
            .tooltip(tf(
                "hosts.home.computerActions",
                &[("host", bidi_isolate(&name).into())],
            ))
            .disabled(pending)
            .on_click(cx.listener(move |s, e: &ClickEvent, _, cx| {
                s.computer_menu = Some((id.clone(), name.clone(), current, e.position()));
                cx.notify();
            }))
    }
    /// The open computer's one action: remove it, after the system asks.
    fn computer_menu(&self, cx: &mut Context<Self>) -> Option<AnchoredMenu> {
        let (id, name, current, position) = self.computer_menu.clone()?;
        let close = cx.weak_entity();
        let label = tf(
            if current {
                "hosts.settings.removeThis"
            } else {
                "hosts.settings.removeComputer"
            },
            &[("host", bidi_isolate(&name).into())],
        );
        let remove = close.clone();
        let menu = Menu::new("computer-actions")
            .min_w(px(210.))
            .items([MenuItem::new(label)
                .icon("trash-2")
                .danger()
                .on_click(move |window, cx| {
                    let _ = remove.update(cx, |s, cx| {
                        s.computer_menu = None;
                        s.confirm_remove(id.clone(), window, cx);
                    });
                })])
            .on_dismiss({
                let close = close.clone();
                move |_, cx| {
                    let _ = close.update(cx, |s, cx| {
                        s.computer_menu = None;
                        cx.notify();
                    });
                }
            });
        Some(
            AnchoredMenu::new("computer-actions-anchor", position, menu).on_dismiss(
                move |_, cx| {
                    let _ = close.update(cx, |s, cx| {
                        s.computer_menu = None;
                        cx.notify();
                    });
                },
            ),
        )
    }
    /// `host:revoke-device`'s warning, then the removal.
    fn confirm_remove(&mut self, device: String, window: &mut Window, cx: &mut Context<Self>) {
        let answer = window.prompt(
            PromptLevel::Warning,
            tr("native.host.revoke.title"),
            Some(tr("native.host.revoke.message")),
            &[tr("native.host.cancel"), tr("native.host.remove")],
            cx,
        );
        cx.spawn(async move |_, cx| {
            if answer.await == Ok(1) {
                cx.update(|cx| hosts::global(cx).update(cx, |c, cx| c.remove_device(device, cx)));
            }
        })
        .detach();
        cx.notify();
    }
}

/// `.computer-access-device`: the computer mark, its name and presence;
/// actions follow.
fn computer_row(t: Theme, id: &str, name: String, presence: String) -> Stateful<Div> {
    let ty = theme::ty();
    h_flex()
        .id(SharedString::from(format!("computer-{id}")))
        .w_full()
        .min_h(px(44.))
        .gap(px(10.))
        .px(px(10.))
        .child(
            div()
                .size(px(26.))
                .flex_shrink_0()
                .flex()
                .items_center()
                .justify_center()
                .rounded(px(6.))
                .bg(t.control)
                .child(
                    Icon::product(ProductIcon::Local)
                        .with_size(px(16.))
                        .color(t.muted),
                ),
        )
        .child(
            v_flex()
                .flex_1()
                .min_w_0()
                .child(
                    div()
                        .truncate()
                        .text_size(px(ty.ui.body))
                        .text_color(t.text)
                        .child(name),
                )
                .child(
                    div()
                        .truncate()
                        .text_size(px(ty.ui.meta))
                        .text_color(t.subtle)
                        .child(presence),
                ),
        )
}
