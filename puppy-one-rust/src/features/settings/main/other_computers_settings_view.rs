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
                    .debug_selector(|| "sharing-pause".into())
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
                            if let Some(failure) = hosts::start_at_login(&autostart, enabled) {
                                hosts::global(cx).update(cx, |c, cx| {
                                    c.action_error = Some(failure);
                                    cx.notify();
                                });
                            }
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
    let selector = format!("computer-{id}");
    h_flex()
        .id(SharedString::from(selector.clone()))
        .debug_selector(move || selector.clone())
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::features::{
        hosts::{HostStatus, SharedFolder},
        settings::PreferencesStore,
    };
    use crate::test_support::RecordingText;
    use core::prelude::v1::test;
    use gpui::{TestAppContext, TestDispatcher, VisualTestContext};
    use std::{sync::Arc, time::Duration};

    const THIS: &str = "0d9b7f61-1111-4c2a-8b2e-7a6b5c4d3e2f";
    const OFFICE: &str = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

    struct Page(Entity<SettingsWorkspaceSurface>);
    impl Render for Page {
        fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
            use crate::ui::appearance::ActiveAppearance as _;
            div().size_full().child(self.0.update(cx, |s, cx| {
                let t = cx.palette();
                s.other_computers(t, cx)
            }))
        }
    }
    struct Fixture {
        cx: VisualTestContext,
        text: Arc<RecordingText>,
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            self.cx.cx.quit();
        }
    }
    impl Fixture {
        fn mount(signed_in: bool) -> Self {
            let text = Arc::new(RecordingText::default());
            let app =
                TestAppContext::build_with_text_system(TestDispatcher::new(0), None, text.clone());
            app.executor().allow_parking();
            crate::localization::set_current("en");
            let (broker, browser) = if signed_in {
                crate::cloud::auth::responding_account_fixture(Arc::new(|_| {
                    Err(crate::cloud::auth::Error::Unavailable)
                }))
            } else {
                let (broker, browser, _control) = crate::cloud::auth::sign_in_fixture();
                (broker, browser)
            };
            app.update(|cx| {
                gpui_kit::init(cx);
                crate::features::cloud::account::install_fixture(broker, browser, cx);
            });
            let deadline = std::time::Instant::now() + Duration::from_secs(5);
            let settled = if signed_in {
                crate::cloud::auth::Status::Authenticated
            } else {
                crate::cloud::auth::Status::SignedOut
            };
            while app.update(|cx| crate::features::cloud::account::status(cx)) != Some(settled) {
                app.run_until_parked();
                assert!(std::time::Instant::now() < deadline);
            }
            let window = app.update(|cx| {
                cx.open_window(
                    WindowOptions {
                        window_bounds: Some(WindowBounds::Windowed(Bounds {
                            origin: Point::default(),
                            size: size(px(900.), px(1200.)),
                        })),
                        ..Default::default()
                    },
                    |w, cx| {
                        let prefs = cx.new(|_| PreferencesStore::memory());
                        let surface = cx.new(|cx| SettingsWorkspaceSurface::new(prefs, w, cx));
                        let view = cx.new(|_| Page(surface));
                        cx.new(|cx| gpui_kit::base::Root::new(view, w, cx))
                    },
                )
                .unwrap()
            });
            let mut fixture = Self {
                cx: VisualTestContext::from_window(window.into(), &app),
                text,
            };
            fixture.draw();
            fixture
        }
        fn draw(&mut self) {
            self.cx.update(|w, cx| {
                w.draw(cx).clear(cx);
            });
        }
        fn said(&self, expected: &str) -> bool {
            self.text
                .0
                .lock()
                .unwrap()
                .iter()
                .any(|s| s.contains(expected))
        }
        fn catalog(&mut self, devices: serde_json::Value, this: &str) {
            self.cx.update(|_, cx| {
                hosts::global(cx).update(cx, |c, cx| {
                    c.install_fixture(&serde_json::json!({ "devices": devices }), this);
                    cx.notify();
                })
            });
            self.draw();
        }
        fn sharing(&mut self, status: Option<HostStatus>) {
            self.cx.update(|_, cx| {
                hosts::host_link(cx).update(cx, |l, cx| {
                    l.status = status;
                    cx.notify();
                })
            });
            self.draw();
        }
    }
    fn device(id: &str, name: &str, online: bool, folders: serde_json::Value) -> serde_json::Value {
        let seen = (chrono::Utc::now() - chrono::Duration::hours(3)).to_rfc3339();
        serde_json::json!({"id": id, "name": name, "online": online, "last_seen_at": seen,
            "state": "active", "revision": 1, "folders": folders})
    }

    /// `OtherComputersSettings`: this computer reads as its host says — not
    /// sharing, with nothing to pause or start at login and a way to share
    /// from the Homepage; then its shared folders, by name and access, with
    /// Pause, and Resume while paused. The other computers are listed with
    /// their presence while this one never is among them; with none, it
    /// says so, and while the list loads this computer still shows.
    #[test]
    fn this_computer_and_the_others_read_as_the_host_and_the_catalog_say() {
        let mut f = Fixture::mount(true);
        // Nothing read yet of the computers: this computer still shows.
        f.sharing(Some(HostStatus {
            state: "off".into(),
            ..Default::default()
        }));
        assert!(f.said("Not sharing") && f.said("Share a folder from Homepage."));
        assert!(f.said("Loading"));
        assert!(f.cx.debug_bounds("sharing-pause").is_none());
        assert!(!f.said("Continue sharing at login"));
        // Only this computer: no others yet.
        f.catalog(
            serde_json::json!([device(THIS, "MacBook Pro", true, serde_json::json!([]))]),
            THIS,
        );
        assert!(f.said("No other computers."));
        // Sharing one folder, view only, with another computer offline.
        let notes = serde_json::json!([{"id": "notes", "name": "Notes", "state": "active",
            "revision": 1, "capabilities": ["folder.read"]}]);
        f.catalog(
            serde_json::json!([
                device(THIS, "MacBook Pro", true, notes),
                device(OFFICE, "Office PC", false, serde_json::json!([]))
            ]),
            THIS,
        );
        f.sharing(Some(HostStatus {
            state: "online".into(),
            device_id: Some(THIS.into()),
            folders: vec![SharedFolder {
                folder_id: "notes".into(),
                name: "Notes".into(),
                ..Default::default()
            }],
            ..Default::default()
        }));
        for said in [
            "MacBook Pro",
            "1 folder shared",
            "Notes",
            "View only",
            "Pause",
            "Office PC",
            "Last online 3 hours ago",
        ] {
            assert!(f.said(said), "{said}");
        }
        assert!(f.cx.debug_bounds("sharing-pause").is_some());
        assert!(f.cx.debug_bounds("computer-this-computer").is_some());
        assert!(
            f.cx.debug_bounds("computer-dddddddd-dddd-4ddd-8ddd-dddddddddddd")
                .is_some()
        );
        assert!(
            f.cx.debug_bounds("computer-0d9b7f61-1111-4c2a-8b2e-7a6b5c4d3e2f")
                .is_none()
        );
        // Paused: Resume where Pause was.
        f.sharing(Some(HostStatus {
            state: "online".into(),
            device_id: Some(THIS.into()),
            paused: true,
            folders: vec![SharedFolder {
                folder_id: "notes".into(),
                name: "Notes".into(),
                ..Default::default()
            }],
            ..Default::default()
        }));
        assert!(f.said("Paused") && f.said("Resume"));
    }

    /// Signed out it keeps its purpose and offers signing in.
    #[test]
    fn signed_out_it_keeps_its_purpose_and_offers_sign_in() {
        let f = Fixture::mount(false);
        assert!(f.said("Open shared folders across your computers."));
        assert!(f.said("Sign in"));
    }
}
