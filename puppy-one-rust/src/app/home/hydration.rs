//! Remembered-project hydration, Cloud space/computer sharing sync, first-paint
//! and list-hold budgets, place focus, and per-project audience projection
//! (`useHomepageFirstPaint`, `useHomepageListHold`, `useHomepageCloudProjects`,
//! `useProjectGroupFocus`, `HomepageComputers`).
use super::{display::project_name, *};
use crate::platform::local_computers::normalize_path;
use std::collections::HashSet;

/// `HOMEPAGE_FIRST_PAINT_BUDGET_MS`: the longest a list waits.
const FIRST_PAINT_BUDGET: Duration = Duration::from_millis(4000);
/// `SPACES_WAIT_MS`: how long a first visit waits for the spaces that group
/// its Cloud projects.
const SPACES_WAIT: Duration = Duration::from_millis(3000);

impl Homepage {
    /// `useHostCatalog`: the account's computers, while Other computers is
    /// on and the page shows.
    pub(in crate::app) fn read_hosts(&mut self, retry: bool, cx: &mut Context<Self>) {
        let enabled = crate::features::flags::host_devices_enabled(&self.preferences, cx);
        let visible = self.session.home;
        self.hosts
            .update(cx, |h, cx| h.ensure(enabled, visible, retry, cx));
    }

    /// This computer's own sharing (`HomepageComputers`): what it offers, its
    /// id among the account's computers, and whether a folder may be offered.
    pub(in crate::app::home) fn sync_sharing(&mut self, cx: &mut Context<Self>) {
        let fixture = self.hosts.read(cx).is_fixture();
        let on = fixture || crate::features::flags::host_devices_enabled(&self.preferences, cx);
        let account = crate::features::cloud::account::broker_and_binding(cx).map(|(_, b)| b.user);
        let link = crate::features::hosts::host_link(cx);
        if on {
            link.update(cx, |l, cx| {
                l.sync_account(cx);
                l.ensure(false, cx);
            });
        }
        let device = account.as_deref().and_then(|a| link.read(cx).device_for(a));
        if !fixture && self.hosts.read(cx).this_device != device {
            self.hosts.update(cx, |h, cx| {
                h.this_device = device;
                cx.notify();
            });
        }
        let own: Option<HashSet<String>> = link
            .read(cx)
            .status
            .as_ref()
            .filter(|_| on)
            .map(|s| s.folders.iter().map(|f| f.folder_id.clone()).collect());
        let hosts = self.hosts.read(cx);
        self.other_computers = hosts
            .others()
            .filter(|_| on)
            .map(|d| d.name.clone())
            .collect();
        self.shared_ids = own.or_else(|| hosts.offered_here().filter(|_| on && !hosts.error()));
        self.local_share = on && account.is_some() && cfg!(target_os = "macos");
        self.presence = link.read(cx).status.as_ref().filter(|_| on).and_then(|s| {
            let key = if s.state == "outdated" {
                Some("hosts.sharing.outdated")
            } else if s.folders.is_empty() {
                return None;
            } else if s.paused {
                Some("hosts.sharing.paused")
            } else if s.state == "connecting" {
                Some("hosts.sharing.connecting")
            } else if s.state == "offline" {
                Some("hosts.sharing.reconnecting")
            } else {
                None
            };
            let running = (!s.running.is_empty()).then(|| {
                tf(
                    "hosts.execution.running",
                    &[("count", s.running.len().into())],
                )
            });
            let text = [key.map(|k| tr(k).to_owned()), running]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join(" · ");
            (!text.is_empty()).then(|| (text, s.paused && s.state != "outdated"))
        });
    }

    /// The folders my other computers offer, minus those this computer shares.
    pub(in crate::app::home) fn remote_items(&self, cx: &App) -> Vec<Item> {
        if !crate::features::flags::host_devices_enabled(&self.preferences, cx)
            && !self.hosts.read(cx).is_fixture()
        {
            return vec![];
        }
        let local: HashSet<String> = self
            .recent(cx)
            .iter()
            .filter_map(|p| p.host_folder.clone())
            .collect();
        self.hosts.read(cx).remote_items(&local)
    }

    /// Hydrates remembered projects (modification time, canonical Cloud locator,
    /// availability, and top-level asset previews) off the main thread.
    pub(in crate::app::home) fn refresh_activity(&mut self, cx: &mut Context<Self>) {
        let shown = self.session.listing;
        let appeared = shown && !self.shown;
        if appeared && self.session.home {
            self.shown_dates.clear();
            self.menu = None;
        }
        self.shown = shown;
        let paths: Vec<PathBuf> = self.recent(cx).iter().map(|p| p.path.clone()).collect();
        if !shown || (!appeared && self.read_for.as_ref() == Some(&paths)) {
            return;
        }
        self.read_for = Some(paths.clone());
        self.reading = true;
        self.read_id += 1;
        let read_id = self.read_id;
        let identities: HashMap<PathBuf, Option<String>> = self
            .recent(cx)
            .iter()
            .map(|p| (p.path.clone(), p.fs_identity.clone()))
            .collect();
        let read = cx.background_executor().spawn(async move {
            paths
                .into_iter()
                .map(|path| {
                    let changed = project_activity::last_modified(&path);
                    let remote = project_activity::remote_urls(&path)
                        .map(|urls| locator::canonical_locator(urls.iter().map(String::as_str)));
                    let was = identities.get(&path).cloned().flatten();
                    let status = folder_status::read_status(&path, was.as_deref());
                    let identity = status
                        .is_none()
                        .then(|| crate::platform::folder_availability::identity(&path))
                        .flatten()
                        .filter(|now| Some(now) != was.as_ref());
                    let previews = if status.is_none() {
                        previews::select_local_previews(&path)
                    } else {
                        Vec::new()
                    };
                    (path, changed, remote, status, identity, previews)
                })
                .collect::<Vec<_>>()
        });
        cx.spawn(async move |this, cx| {
            let read = read.await;
            let _ = this.update(cx, |s, cx| {
                // A read a newer one replaced settles nothing.
                if s.read_id != read_id {
                    return;
                }
                s.locators = read
                    .iter()
                    .filter_map(|(path, _, remote, _, _, _)| Some((path.clone(), remote.clone()?)))
                    .collect();
                s.unavailable = read
                    .iter()
                    .filter_map(|(path, _, _, status, _, _)| Some((path.clone(), status.clone()?)))
                    .collect();
                s.discovery.local_previews = read
                    .iter()
                    .filter(|(_, _, _, _, _, previews)| !previews.is_empty())
                    .map(|(path, _, _, _, _, previews)| (path.clone(), previews.clone()))
                    .collect();
                let learned: Vec<(PathBuf, String)> = read
                    .iter()
                    .filter_map(|(path, _, _, _, identity, _)| {
                        Some((path.clone(), identity.clone()?))
                    })
                    .collect();
                if !learned.is_empty() {
                    s.preferences.update(cx, |p, cx| {
                        p.change(
                            |p| {
                                for (path, identity) in &learned {
                                    if let Some(project) =
                                        p.recent_projects.iter_mut().find(|r| r.path == *path)
                                    {
                                        project.fs_identity = Some(identity.clone());
                                    }
                                }
                            },
                            cx,
                        )
                    });
                }
                s.activity = read
                    .into_iter()
                    .map(|(path, changed, _, _, _, _)| (path, changed))
                    .collect();
                s.reading = false;
                s.list_held_since = None;
                s.refresh(cx);
            });
        })
        .detach();
    }

    /// `useHomepageListHold`: Home leaves at once and only the list waits,
    /// so the project just left is in its new place the first time it shows.
    /// The list waits at most the first-paint budget; an earlier hold's
    /// budget never releases a later one.
    pub(in crate::app) fn hold_list(&mut self, cx: &mut Context<Self>) {
        self.list_held_since = Some(Instant::now());
        self.read_for = None;
        // A hold is a new visit: the dates read for it may move projects.
        self.shown_dates.clear();
        self.hold_id += 1;
        let hold = self.hold_id;
        let budget = cx.background_executor().timer(FIRST_PAINT_BUDGET);
        cx.spawn(async move |this, cx| {
            budget.await;
            let _ = this.update(cx, |s, cx| {
                if s.hold_id == hold && s.list_held_since.take().is_some() {
                    cx.notify();
                }
            });
        })
        .detach();
    }

    /// `useCloudSpaces` (`App.tsx`): the spaces of the signed-in account.
    pub(in crate::app::home) fn read_spaces(&mut self, retry: bool, cx: &mut Context<Self>) {
        let enabled = crate::features::flags::cloud_enabled(&self.preferences, cx);
        let visible = !self.session.restoring;
        self.spaces
            .update(cx, |s, cx| s.ensure(enabled, visible, retry, cx));
    }

    /// Holds groups as one while a first visit's spaces are loading (up to 3s).
    pub(in crate::app::home) fn groups_held(
        &mut self,
        items: &[Item],
        window: &mut Window,
        cx: &App,
    ) -> bool {
        let awaiting = self.spaces.read(cx).status() == SpacesStatus::Loading
            && items.iter().any(|item| item.local_path.is_none());
        if !awaiting {
            self.spaces_wait = None;
            return false;
        }
        let since = *self.spaces_wait.get_or_insert_with(Instant::now);
        let held = since.elapsed() < SPACES_WAIT;
        if held {
            window.request_animation_frame();
        }
        held
    }

    /// `showHomepagePlace`: brings `place`'s group to the top once and marks it.
    pub(in crate::app) fn focus_place(&mut self, place: &str, cx: &mut Context<Self>) {
        self.place_focus = Some((groups::GroupId::of_place(place), Instant::now(), None));
        cx.notify();
    }

    /// `useProjectGroupFocus`: scrolls to the requested group once available and
    /// highlights it for 1.6s.
    pub(in crate::app::home) fn settle_place_focus(
        &mut self,
        groups: &[groups::Group],
        cx: &mut Context<Self>,
    ) -> Option<groups::GroupId> {
        const FOCUS: Duration = Duration::from_millis(1600);
        const WAIT: Duration = Duration::from_millis(2000);
        let (id, asked, shown) = self.place_focus.clone()?;
        match shown {
            Some(at) if at.elapsed() < FOCUS => Some(id),
            Some(_) => {
                self.place_focus = None;
                None
            }
            None => match groups.iter().position(|g| g.id == id) {
                Some(index) => {
                    self.scroll.scroll_to_top_of_item(index);
                    self.place_focus = Some((id.clone(), asked, Some(Instant::now())));
                    cx.spawn(async move |this, cx| {
                        cx.background_executor().timer(FOCUS).await;
                        let _ = this.update(cx, |_, cx| cx.notify());
                    })
                    .detach();
                    Some(id)
                }
                None if asked.elapsed() < WAIT => {
                    cx.spawn(async move |this, cx| {
                        cx.background_executor()
                            .timer(Duration::from_millis(100))
                            .await;
                        let _ = this.update(cx, |_, cx| cx.notify());
                    })
                    .detach();
                    None
                }
                None => {
                    self.place_focus = None;
                    None
                }
            },
        }
    }

    /// The place groups for the visible projects.
    pub(in crate::app) fn project_groups_now(
        &self,
        items: Vec<Item>,
        cx: &App,
    ) -> Vec<groups::Group> {
        let spaces = self.spaces.read(cx);
        let cloud = crate::features::flags::cloud_enabled(&self.preferences, cx)
            && crate::features::cloud::account::has_account(cx);
        // Computer Mode: which folders are this computer's computers.
        let computers = self.computer_paths(cx);
        let is_computer = |item: &Item| {
            item.local_path.as_deref().is_some_and(|path| {
                computers
                    .as_ref()
                    .is_some_and(|c| c.contains(&normalize_path(path)))
            })
        };
        groups::groups(groups::Inputs {
            spaces: if cloud { spaces.spaces() } else { &[] },
            items,
            dragging_path: self
                .dragging_path
                .as_deref()
                .filter(|_| cx.has_active_drag()),
            busy: self.session.busy,
            can_publish: cloud,
            can_manage: cloud,
            shared: &|item: &Item| {
                item.host_folder
                    .as_ref()
                    .is_some_and(|id| self.shared_ids.as_ref().is_none_or(|ids| ids.contains(id)))
            },
            local_share: self.local_share,
            remote: self.remote_items(cx),
            presence: self.presence.clone(),
            computers: computers
                .is_some()
                .then_some(&is_computer as &dyn Fn(&Item) -> bool),
            can_create: !self.session.busy,
        })
    }

    /// Computer Mode's computers on this computer, by their folder; `None`
    /// while the mode is off.
    pub(in crate::app::home) fn computer_paths(&self, cx: &App) -> Option<HashSet<String>> {
        if !crate::features::flags::computer_mode_enabled(&self.preferences, cx) {
            return None;
        }
        Some(
            crate::features::computer_mode::read(cx)
                .map(|c| c.computers())
                .unwrap_or_default()
                .iter()
                .map(|record| normalize_path(&record.workspace_path))
                .collect(),
        )
    }

    /// `projectAudience` of `MinimalOnboarding`: who can open a local folder
    /// listed here, and how its menu changes that.
    pub(in crate::app) fn audience_of_id(
        &self,
        id: &str,
        cx: &App,
    ) -> Option<super::super::audience::ProjectAudience> {
        use super::super::audience::{
            AudienceAction as A, CloudCopy, Devices, ProjectAudience, Team,
        };
        let items = self.visible_projects(cx);
        let item = items.iter().find(|i| i.id == id)?;
        let path = PathBuf::from(item.local_path.clone()?);
        let cloud = crate::features::flags::cloud_enabled(&self.preferences, cx)
            && crate::features::cloud::account::has_account(cx);
        let spaces = self.spaces.read(cx);
        let spaces = if cloud { spaces.spaces() } else { &[] };
        let shared = item
            .host_folder
            .as_ref()
            .is_some_and(|f| self.shared_ids.as_ref().is_none_or(|ids| ids.contains(f)));
        let linked = item.linked.clone();
        let copy = linked.as_ref().map(|l| CloudCopy {
            open: Some(A::OpenCloud(l.id.clone())),
            ..Default::default()
        });
        let first_space = spaces.iter().find(|s| s.can_create_projects);
        let devices = (self.local_share || (shared && item.host_folder.is_some())).then(|| {
            let folder = item.host_folder.clone().unwrap_or_default();
            Devices {
                on: shared,
                detail: shared
                    .then(|| super::super::audience::other_computers(&self.other_computers, false)),
                turn_on: (self.local_share && !shared)
                    .then(|| A::TurnOnDevices { path: path.clone() }),
                stop: shared.then(|| A::StopDevices {
                    folder: folder.clone(),
                    path: path.clone(),
                }),
                settings: shared.then(|| A::DeviceSettings {
                    folder: folder.clone(),
                    name: item.label.clone(),
                    path: path.clone(),
                }),
            }
        });
        let team = (first_space.is_some() || copy.is_some()).then(|| Team {
            copy: copy.clone(),
            on_copy: first_space
                .filter(|_| linked.is_none() && cloud)
                .map(|space| A::CopyToTeam {
                    path: path.clone(),
                    space: space.id.clone(),
                }),
        });
        Some(ProjectAudience {
            devices,
            devices_copy: None,
            team,
        })
        .filter(|a| a.any())
    }

    pub(in crate::app::home) fn first_paint_account(&self, cx: &App) -> Option<String> {
        crate::features::cloud::account::broker_and_binding(cx)
            .filter(|_| crate::features::flags::cloud_enabled(&self.preferences, cx))
            .map(|(_, b)| format!("{}\n{}", b.environment.api(), b.user))
    }

    /// `useHomepageFirstPaint`: waits up to four seconds for the initial
    /// settled list of `account`.
    pub(in crate::app::home) fn first_paint_released(&self, cx: &App) -> Option<Option<String>> {
        let account = self.first_paint_account(cx);
        if self.session.restoring || self.released_for.as_ref() == Some(&account) {
            return Some(account);
        }
        // A Homepage released before a slow session turned up is not taken
        // back when it does.
        if self.released_restoring && self.released_for == Some(None) && account.is_some() {
            return Some(account);
        }
        let catalog = self.catalog.read(cx);
        // Signed out is not yet known while the session restores.
        let catalog_settled = !self.cloud_session_restoring(cx)
            && (account.is_none()
                || matches!(catalog.state, crate::features::cloud::CatalogState::Failed)
                || (matches!(
                    catalog.state,
                    crate::features::cloud::CatalogState::Ready(_)
                ) && catalog.fresh));
        let settled = !self.reading && self.read_for.is_some() && catalog_settled;
        let over = self
            .first_paint
            .is_some_and(|since| since.elapsed() >= FIRST_PAINT_BUDGET);
        (settled || over).then_some(account)
    }

    /// Whether the Cloud session (with Cloud on) is still being restored.
    pub(in crate::app::home) fn cloud_session_restoring(&self, cx: &App) -> bool {
        crate::features::flags::cloud_enabled(&self.preferences, cx)
            && crate::features::cloud::account::status(cx)
                == Some(crate::cloud::auth::Status::Restoring)
    }

    /// Tests: whether the list still waits for its first paint.
    #[cfg(test)]
    pub(in crate::app) fn first_paint_held(&self, cx: &App) -> bool {
        self.first_paint_released(cx).is_none()
    }
    /// Tests: the first-paint budget has run out.
    #[cfg(test)]
    pub(in crate::app) fn expire_first_paint(&mut self) {
        self.first_paint = Some(Instant::now() - FIRST_PAINT_BUDGET);
    }
    /// Tests: a new launch's Homepage, nothing released yet.
    #[cfg(test)]
    pub(in crate::app) fn relaunch_first_paint(&mut self) {
        self.released_for = None;
        self.released_restoring = false;
        self.first_paint = Some(Instant::now());
    }
    /// Tests: a new first-paint wait starts now.
    #[cfg(test)]
    pub(in crate::app) fn restart_first_paint(&mut self) {
        self.first_paint = Some(Instant::now());
    }

    pub(in crate::app::home) fn release_first_paint(&mut self, cx: &mut Context<Self>) {
        if let Some(account) = self.first_paint_released(cx)
            && self.released_for.as_ref() != Some(&account)
            && !self.session.restoring
        {
            self.released_restoring = self.cloud_session_restoring(cx);
            self.released_for = Some(account);
            self.first_paint = None;
            self.list_held_since = None;
            cx.notify();
        }
    }

    /// `useHomepageCloudProjects().items`: the flat project list shared by Home
    /// and the Header project menu.
    pub(in crate::app) fn project_items(&self, cx: &App) -> Vec<Item> {
        use crate::features::cloud::CatalogState as State;
        let account = crate::features::cloud::account::broker_and_binding(cx)
            .map(|(_, binding)| binding)
            .filter(|_| crate::features::flags::cloud_enabled(&self.preferences, cx));
        let catalog = self.catalog.read(cx);
        let (cloud, activity) = match (&catalog.state, &account) {
            (State::Ready(entries), Some(_)) => (entries.as_slice(), &catalog.activity),
            _ => (&[][..], &catalog.activity),
        };
        let api = account.as_ref().map(|b| b.environment.api().to_owned());
        let hosted_git_origin = account
            .as_ref()
            .and_then(|b| b.environment.hosted_git_origin());
        let millis = |t: SystemTime| {
            t.duration_since(UNIX_EPOCH)
                .ok()
                .map(|d| d.as_millis() as i64)
        };
        let local: Vec<catalog::LocalEntry> = self
            .recent(cx)
            .iter()
            .map(|p| catalog::LocalEntry {
                path: p.path.to_string_lossy().into_owned(),
                name: project_name(p),
                modified: self
                    .activity
                    .get(&p.path)
                    .copied()
                    .flatten()
                    .and_then(millis),
                trusted_locator: api.as_deref().and_then(|api| {
                    self.locators.get(&p.path).cloned().flatten().filter(|l| {
                        locator::is_trusted_git_origin(&l.origin, api, hosted_git_origin.as_deref())
                    })
                }),
                host_folder: p.host_folder.clone(),
            })
            .collect();
        catalog::build(&local, cloud, activity)
    }
}
