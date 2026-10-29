//! The homepage: port of `MinimalOnboarding`, `OnboardingHomeLayout`,
//! `OnboardingBrandLockup`, `OnboardingProjectList`, `OnboardingEntryActions`
//! and `styles/onboarding.css`. Shown with no open project and from the
//! project menu's Home item.
//!
//! One column, 440px wide: the brand lockup, a framed primary section (the
//! project list, or "New empty project" when there is none) and the entry
//! actions. Projects are ordered by when they last changed
//! ([`project_activity`]), newest first, and show that time.
//!
//! - [`create_project`]: the "Create a project" dialog
use super::*;
use crate::workspace::cloud::{
    catalog::{self, Item, Location, Opening, history},
    locator::{self, Locator},
};
use crate::{
    features::settings::preference_types::RecentProject,
    localization::{TimeUnit, relative_past, t as tr, tf},
    platform::project_activity,
    theme::metric,
    ui::{
        appearance::ActiveAppearance,
        components::{
            Button, ButtonVariant, Icon, IconButton, MenuItem, MenuRow, MenuVariant, ProductIcon,
        },
    },
};
use gpui_kit::{
    base::{Disableable as _, h_flex, v_flex},
    component::Sizable as _,
};
use std::{
    collections::HashMap,
    path::Path,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

mod create_project;
pub(super) use create_project::CreateProject;

/// `--onboarding-column-width`.
const COLUMN_WIDTH: f32 = 440.;
/// `scrollbar-gutter: stable` on the project list.
const SCROLLBAR_GUTTER: f32 = 12.;

/// Homepage state held by the shell.
#[derive(Default)]
pub(super) struct Homepage {
    /// When each project last changed (`None`: unknown), by path.
    activity: HashMap<PathBuf, Option<SystemTime>>,
    /// `puppyoneGitRemote` of each checkout whose remotes were read
    /// (`hydrationState: "ready"`); an absent path never merges.
    locators: HashMap<PathBuf, Option<Locator>>,
    /// The row whose Open menu is showing.
    pub open_menu: Option<String>,
    /// The projects the activity was read for; a new list reads again.
    read_for: Option<Vec<PathBuf>>,
    /// The homepage was showing at the last frame.
    shown: bool,
    /// Activity is being read.
    pub reading: bool,
}

/// `preferredWidth={252}` of the Homepage Open menu.
const OPEN_MENU_WIDTH: f32 = 252.;

/// `HomeProjectIcon`: a neutral folder, the folder with a small Cloud badge
/// when linked, or the outline Cloud (`--po-brand-blue`) when hosted only.
pub(super) fn project_icon(location: Location, t: Theme) -> AnyElement {
    let glyph = |meaning: ProductIcon| Icon::product(meaning).small().stroke(1.85);
    div()
        .relative()
        .size(px(14.))
        .flex_shrink_0()
        .child(match location {
            Location::CloudOnly => glyph(ProductIcon::Cloud).color(t.brand_blue),
            _ => glyph(ProductIcon::Folder),
        })
        .when(location == Location::Linked, |d| {
            d.child(
                div().absolute().right(px(-4.)).bottom(px(-3.)).child(
                    Icon::product(ProductIcon::Cloud)
                        .with_size(px(9.))
                        .color(t.brand_blue),
                ),
            )
        })
        .into_any_element()
}
/// `getProjectName` for a catalog row.
fn item_name(item: &Item) -> String {
    let label = item.label.trim();
    if !label.is_empty() && Some(label) != item.local_path.as_deref() {
        return label.to_owned();
    }
    item.local_path
        .as_deref()
        .and_then(|p| Path::new(p).file_name())
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| tr("onboarding.projects.untitled").to_owned())
}
/// `useProjectOpenCaption`: where a Cloud-linked row opens.
fn open_caption(item: &Item) -> String {
    let mac = cfg!(target_os = "macos");
    tr(match (item.last_opened.is_some(), item.opening()) {
        (true, Opening::Cloud) => "shell.projectOpen.lastCloud",
        (true, Opening::Local) if mac => "shell.projectOpen.lastMac",
        (true, Opening::Local) => "shell.projectOpen.lastComputer",
        (false, Opening::Cloud) => "shell.projectRuntime.label",
        (false, Opening::Local) if mac => "shell.workspaceSwitcher.location.thisMac",
        (false, Opening::Local) => "shell.workspaceSwitcher.location.thisComputer",
    })
    .to_owned()
}
/// `getProjectName`: the label, else the folder's name.
fn project_name(project: &RecentProject) -> String {
    let label = project.name.trim();
    if !label.is_empty() && Path::new(label) != project.path {
        return label.to_owned();
    }
    project
        .path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| tr("onboarding.projects.untitled").to_owned())
}
/// `getWorkspaceParentPathForDisplay`: the parent folder, home as `~`.
fn parent_for_display(path: &Path) -> String {
    let Some(parent) = path.parent() else {
        return String::new();
    };
    let text = parent.to_string_lossy().into_owned();
    match text.strip_prefix("/Users/") {
        Some(rest) => match rest.split_once('/') {
            Some((_, below)) => format!("~/{below}"),
            None => "~".into(),
        },
        None => text,
    }
}
/// `formatModificationTime`: "Just now", then whole minutes, hours or days.
fn modification_time(changed: SystemTime, now: SystemTime) -> String {
    const MINUTE: u64 = 60;
    const HOUR: u64 = 60 * MINUTE;
    const DAY: u64 = 24 * HOUR;
    let elapsed = now
        .duration_since(changed)
        .unwrap_or(Duration::ZERO)
        .as_secs();
    if elapsed < MINUTE {
        return tr("onboarding.time.justNow").into();
    }
    let (n, unit) = if elapsed < HOUR {
        (elapsed / MINUTE, TimeUnit::Minute)
    } else if elapsed < DAY {
        (elapsed / HOUR, TimeUnit::Hour)
    } else {
        (elapsed / DAY, TimeUnit::Day)
    };
    relative_past(n.max(1) as i64, unit)
}

impl Shell {
    /// Web hides the workspace chrome on the homepage; so does the native shell.
    pub(super) fn home_visible(&self) -> bool {
        !self.fixture && (self.home || self.files.workspace.is_none())
    }
    /// Hydrates the remembered projects (when each last changed, and its
    /// canonical Cloud locator) whenever the homepage or the Header project
    /// menu appears or the list changes, off the main thread.
    pub(super) fn refresh_home_activity(&mut self, cx: &mut Context<Self>) {
        // The Header menus read the same list (projects; This Mac for a
        // hosted-only window).
        let shown = self.home_visible() || self.popover.is_some();
        let appeared = shown && !self.homepage.shown;
        self.homepage.shown = shown;
        let paths: Vec<PathBuf> = self
            .recent_projects
            .iter()
            .map(|p| p.path.clone())
            .collect();
        if !shown || (!appeared && self.homepage.read_for.as_ref() == Some(&paths)) {
            return;
        }
        self.homepage.read_for = Some(paths.clone());
        self.homepage.reading = true;
        let read = cx.background_executor().spawn(async move {
            paths
                .into_iter()
                .map(|path| {
                    let changed = project_activity::last_modified(&path);
                    let remote = project_activity::remote_urls(&path)
                        .map(|urls| locator::canonical_locator(urls.iter().map(String::as_str)));
                    (path, changed, remote)
                })
                .collect::<Vec<_>>()
        });
        cx.spawn(async move |this, cx| {
            let read = read.await;
            let _ = this.update(cx, |s, cx| {
                s.homepage.locators = read
                    .iter()
                    .filter_map(|(path, _, remote)| Some((path.clone(), remote.clone()?)))
                    .collect();
                s.homepage.activity = read
                    .into_iter()
                    .map(|(path, changed, _)| (path, changed))
                    .collect();
                s.homepage.reading = false;
                cx.notify();
            });
        })
        .detach();
    }
    /// `useHomepageCloudProjects().items`: the one flat project list the
    /// Homepage and the Header project menu share. Location chooses icons
    /// and actions, never the rank; Cloud rows come only from the current
    /// account's catalog and merge with a checkout only through its freshly
    /// read, trusted Project-root locator.
    pub(super) fn project_items(&self, cx: &App) -> Vec<Item> {
        use crate::features::cloud_catalog::State;
        let account = crate::features::cloud_account::broker_and_binding(cx)
            .map(|(_, binding)| binding)
            .filter(|_| crate::features::flags::cloud_enabled(&self.preferences, cx));
        let catalog = self.cloud_catalog.read(cx);
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
            .recent_projects
            .iter()
            .map(|p| catalog::LocalEntry {
                path: p.path.to_string_lossy().into_owned(),
                name: project_name(p),
                modified: self
                    .homepage
                    .activity
                    .get(&p.path)
                    .copied()
                    .flatten()
                    .and_then(millis),
                trusted_locator: api.as_deref().and_then(|api| {
                    self.homepage
                        .locators
                        .get(&p.path)
                        .cloned()
                        .flatten()
                        .filter(|l| {
                            locator::is_trusted_git_origin(
                                &l.origin,
                                api,
                                hosted_git_origin.as_deref(),
                            )
                        })
                }),
            })
            .collect();
        let mut items = catalog::build(&local, cloud, activity);
        if let Some(binding) = &account
            && let Some(remembered) = self
                .preferences
                .read(cx)
                .state
                .project_open_history
                .get(&history::scope(binding.environment.api(), &binding.user))
        {
            history::apply(&mut items, remembered);
        }
        items
    }
    /// `useProjectOpenHistory`: remember where this account last opened a
    /// Cloud-linked Project successfully (a committed hosted Project, or a
    /// linked checkout). Failed and cancelled openings never get here.
    pub(super) fn sync_open_history(&mut self, cx: &mut Context<Self>) {
        let Some(binding) = crate::features::cloud_account::broker_and_binding(cx)
            .map(|(_, b)| b)
            .filter(|_| crate::features::flags::cloud_enabled(&self.preferences, cx))
        else {
            return;
        };
        let cloud = self.hosted_project();
        let local = self
            .workspace_root()
            .map(|p| p.to_string_lossy().into_owned());
        if cloud.is_none() && local.is_none() {
            return;
        }
        let items = if cloud.is_some() {
            vec![]
        } else {
            self.project_items(cx)
        };
        let Some(entry) = history::current(&items, local.as_deref(), cloud.as_deref()) else {
            return;
        };
        let scope = history::scope(binding.environment.api(), &binding.user);
        let known = self
            .preferences
            .read(cx)
            .state
            .project_open_history
            .get(&scope)
            .is_some_and(|h| h.contains(&entry));
        if !known {
            self.preferences.update(cx, |p, cx| {
                p.change(
                    |p| {
                        history::record(p.project_open_history.entry(scope).or_default(), entry);
                    },
                    cx,
                )
            });
        }
    }
    pub(super) fn home_view(&self, cx: &mut Context<Self>) -> Div {
        let t = cx.palette();
        let items = self.project_items(cx);
        let has_projects = !items.is_empty();
        let busy = self.pending || self.files.busy() || self.files.folder_busy;
        // `OnboardingBrandLockup`: the 28px mark and the prompt in
        // `--po-text-muted`. On dark the product applies
        // `grayscale(1) brightness(0.7)` to the mark; GPUI images have no
        // filters, so the dark variant has it baked in (`assets/README.md`).
        let brand = h_flex()
            .flex_shrink_0()
            .w_full()
            .min_w_0()
            .gap(px(12.))
            .mb(px(if has_projects { 34. } else { 24. }))
            .text_color(t.muted)
            .child(
                img(SharedString::from(if t.dark {
                    "brand/puppy-dark-onboarding.svg"
                } else {
                    "brand/puppy-lite.svg"
                }))
                .size(px(28.))
                .object_fit(ObjectFit::Contain)
                .flex_shrink_0(),
            )
            .child(
                // `letter-spacing: -0.035em`.
                div()
                    .min_w_0()
                    .overflow_hidden()
                    .text_size(px(theme::ty().ui.heading))
                    .line_height(px(22.))
                    .font_weight(FontWeight::MEDIUM)
                    .child(crate::ui::tracked_text(
                        tr(if has_projects {
                            "onboarding.section.chooseProject"
                        } else {
                            "onboarding.brand.agentReadyMessage"
                        }),
                        -0.035,
                    )),
            );
        // `OnboardingPrimarySection`: one framed slot between two rules.
        let primary = v_flex()
            .w_full()
            .min_w_0()
            .min_h_0()
            .flex_shrink(1.)
            .pt(px(24.))
            .pb(px(if has_projects { 10. } else { 18. }))
            .mb(px(if has_projects { 12. } else { 18. }))
            .border_t_1()
            .border_b_1()
            .border_color(t.border)
            .child(if has_projects {
                self.project_list(items, busy, cx).into_any_element()
            } else {
                h_flex()
                    .child(self.create_action(true, busy, cx))
                    .into_any_element()
            });
        let actions = v_flex()
            .flex_shrink_0()
            .w_full()
            .items_start()
            .gap(px(2.))
            .when(!has_projects, |d| d.pb(px(18.)))
            .when(has_projects, |d| {
                d.child(self.create_action(false, busy, cx))
            })
            .child(
                Button::new("home-open-folder")
                    .variant(ButtonVariant::Entry)
                    .icon(crate::ui::components::ProductIcon::Folder)
                    .label(tr("onboarding.action.openFolder"))
                    .disabled(busy)
                    .on_click(cx.listener(|s, _, w, cx| s.command(Command::OpenFolder, w, cx))),
            )
            .child(self.import_action(t));
        let launcher = v_flex()
            .w(px(COLUMN_WIDTH))
            .max_w_full()
            .max_h_full()
            .min_h_0()
            .child(brand)
            .child(primary)
            .child(actions);
        // `.onboarding-homepage-shell`: the column centred in the window,
        // below the Header (the Header paints over the top).
        let (top, bottom) = if has_projects {
            (metric::CHROME_HEIGHT + 51., 16.)
        } else {
            (48., 48.)
        };
        at(Rect::new(
            0.,
            0.,
            self.layout.header.w,
            self.layout.editor.bottom(),
        ))
        .bg(t.canvas)
        .flex()
        .flex_col()
        .items_center()
        .justify_center()
        .pt(px(top))
        .pb(px(bottom))
        .px(px(metric::UTILITY_PADDING_INLINE))
        .child(launcher)
        .children(self.cloud_opening_overlay(cx))
        .when(self.files.folder_busy, |d| {
            // OnboardingProjectLoading: the chosen project's request is
            // pending, not the native folder picker. Shared area figure.
            d.child(
                div()
                    .absolute()
                    .top(px(metric::CHROME_HEIGHT))
                    .bottom_0()
                    .left_0()
                    .right_0()
                    .occlude()
                    .flex()
                    .items_center()
                    .justify_center()
                    .p(px(32.))
                    .bg(theme::alpha(t.canvas, 0.84))
                    .child(
                        v_flex()
                            .items_center()
                            .gap(px(16.))
                            .child(
                                crate::ui::loading::LoadingMark::new("project-opening")
                                    .area()
                                    .size(crate::ui::loading::LoaderSize::Md)
                                    .tone(crate::ui::loading::Tone::Neutral),
                            )
                            .child(
                                div()
                                    .text_size(px(theme::ty().ui.body))
                                    .text_color(t.text)
                                    .font_weight(FontWeight::MEDIUM)
                                    .child(tr("onboarding.status.loadingProject")),
                            ),
                    ),
            )
        })
    }
    /// `OnboardingProjectList`: one menu row per project in the shared
    /// order. Cloud-linked rows show where they open and a quiet Open menu;
    /// checkouts trade their time for Remove on hover.
    fn project_list(&self, items: Vec<Item>, busy: bool, cx: &mut Context<Self>) -> Stateful<Div> {
        let t = cx.palette();
        let now = SystemTime::now();
        let cloud = crate::features::flags::cloud_enabled(&self.preferences, cx);
        let rows = items
            .into_iter()
            .enumerate()
            .map(|(index, item)| {
                let name = item_name(&item);
                let opening = item.opening();
                let menu_open = self.homepage.open_menu.as_deref() == Some(item.id.as_str());
                let mut row = MenuItem::new(name.clone())
                    .icon_element(project_icon(item.location(), t))
                    .detail(match &item.cloud_project {
                        Some(_) => open_caption(&item),
                        None => item
                            .local_path
                            .as_deref()
                            .map(|p| parent_for_display(Path::new(p)))
                            .unwrap_or_default(),
                    })
                    .disabled(busy)
                    .hold_hover(menu_open)
                    .on_click({
                        let host = cx.weak_entity();
                        let item = item.clone();
                        move |w, cx| {
                            let _ = host.update(cx, |s, cx| s.open_item(&item, opening, w, cx));
                        }
                    });
                if let Some(ms) = item.modified.filter(|m| *m > 0) {
                    let changed = UNIX_EPOCH + Duration::from_millis(ms as u64);
                    row = row.trailing_text(modification_time(changed, now));
                }
                let open_menu = (cloud && item.cloud_project.is_some())
                    .then(|| self.project_open_menu(index, &item, &name, busy, menu_open, cx));
                let remove = item.local_path.clone().map(|path| {
                    let remove_label = tf(
                        "onboarding.projects.removeFor",
                        &[("project", name.clone().into())],
                    );
                    // `DesktopMenuIconButton.onboarding-project-remove`.
                    IconButton::new(("home-project-remove", index), "unlink")
                        .label(remove_label)
                        // The tooltip says the files stay (`removeHint`);
                        // the accessible name keeps the project.
                        .tooltip(tr("onboarding.projects.removeHint"))
                        .with_size(px(22.))
                        .rounded(px(5.))
                        .color(t.text_disabled)
                        .danger()
                        .on_click(cx.listener(move |s, _, w, cx| {
                            cx.stop_propagation();
                            s.confirm_remove_project(PathBuf::from(&path), w, cx);
                        }))
                });
                if open_menu.is_some() {
                    // `padding-inline-end: 112px` while the Open menu shows.
                    row = row.hover_reserve(112.);
                }
                if open_menu.is_some() || remove.is_some() {
                    // Open sits 34px from the end, Remove 6px.
                    row = row.hover_trailing(h_flex().gap(px(6.)).children(open_menu).child(
                        match remove {
                            Some(remove) => remove.into_any_element(),
                            None => div().w(px(22.)).into_any_element(),
                        },
                    ));
                }
                MenuRow::new(("home-project", index), row).variant(MenuVariant::Homepage)
            })
            .collect::<Vec<_>>();
        v_flex()
            .id("home-projects")
            .w_full()
            .min_h_0()
            .flex_shrink(1.)
            .pr(px(SCROLLBAR_GUTTER))
            .gap(px(2.))
            .overflow_y_scroll()
            .children(rows)
    }
    /// `ProjectOpenMenu`: "Open ⌄" and the two opening choices, aligned to
    /// its end, 4px below. This computer needs the row's checkout.
    fn project_open_menu(
        &self,
        index: usize,
        item: &Item,
        name: &str,
        busy: bool,
        open: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = cx.palette();
        let id = item.id.clone();
        let trigger = Button::new(("home-project-open", index))
            .variant(ButtonVariant::Quiet)
            .label(tr("shell.projectOpen.action"))
            .trailing(Icon::new("chevron-down").with_size(px(12.)).stroke(2.))
            .accessibility_label(tf(
                "shell.projectOpen.forProject",
                &[("project", name.to_owned().into())],
            ))
            .disabled(busy);
        let host = self.weak.clone();
        let device = tr(if cfg!(target_os = "macos") {
            "shell.projectOpen.onMac"
        } else {
            "shell.projectOpen.onComputer"
        });
        let local = {
            let host = host.clone();
            let item = item.clone();
            MenuItem::new(device)
                .icon_sized(Icon::product(ProductIcon::Local).with_size(px(15.)))
                .disabled(item.local_path.is_none())
                .on_click(move |w, cx| {
                    let _ = host.update(cx, |s, cx| {
                        s.homepage.open_menu = None;
                        s.open_item(&item, Opening::Local, w, cx)
                    });
                })
        };
        let remote = {
            let host = host.clone();
            let item = item.clone();
            MenuItem::new(tr("shell.projectOpen.inCloud"))
                .icon_sized(
                    Icon::product(ProductIcon::Cloud)
                        .with_size(px(15.))
                        .color(t.accent_text),
                )
                .on_click(move |w, cx| {
                    let _ = host.update(cx, |s, cx| {
                        s.homepage.open_menu = None;
                        s.open_item(&item, Opening::Cloud, w, cx)
                    });
                })
        };
        let menu = crate::ui::components::PopoverMenu::new(("home-project-open-menu", index))
            .anchor(Anchor::TopRight)
            .offset(px(4.))
            .open(open && !busy)
            .on_open_change(move |opened, _, cx| {
                let _ = host.update(cx, |s, cx| {
                    if *opened {
                        s.homepage.open_menu = Some(id.clone());
                    } else if s.homepage.open_menu.as_deref() == Some(id.as_str()) {
                        s.homepage.open_menu = None;
                    }
                    cx.notify();
                });
            })
            .trigger(trigger)
            .menu(move |surface, _, _| {
                surface
                    .variant(MenuVariant::Project)
                    .min_w(px(OPEN_MENU_WIDTH))
                    .item(local)
                    .item(remote)
            });
        // The row behind must not open the project as well.
        div()
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .on_mouse_up(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .child(menu)
            .into_any_element()
    }
    /// Opens a row where it was asked to: a checkout here; Cloud in this
    /// window for a linked row, in a dedicated window for a hosted-only one.
    pub(super) fn open_item(
        &mut self,
        item: &Item,
        opening: Opening,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match (opening, &item.local_path, &item.cloud_project) {
            (Opening::Local, Some(path), _) => self.open_project(PathBuf::from(path), window, cx),
            (Opening::Cloud, Some(_), Some(project)) => {
                self.popover = None;
                self.open_cloud(project.clone(), cx)
            }
            (_, None, Some(project)) => {
                self.popover = None;
                let _ = super::windows::open_cloud(project.clone(), cx);
            }
            _ => {}
        }
        cx.notify();
    }
    /// The page loading overlay of an explicit Cloud opening: the two
    /// request-driven messages and Cancel.
    fn cloud_opening_overlay(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        use crate::workspace::cloud::opening::Phase;
        let phase = self.files.cloud_opening()?;
        let t = cx.palette();
        let message = match phase {
            Phase::Checking | Phase::Connecting => "cloud.loading.startingWorkspace",
            Phase::Files => "cloud.loading.files",
        };
        Some(
            div()
                .absolute()
                .top(px(metric::CHROME_HEIGHT))
                .bottom_0()
                .left_0()
                .right_0()
                .occlude()
                .flex()
                .items_center()
                .justify_center()
                .bg(theme::alpha(t.canvas, 0.84))
                .child(
                    v_flex()
                        .items_center()
                        .gap(px(16.))
                        .child(
                            h_flex()
                                .items_center()
                                .gap(px(10.))
                                .child(
                                    crate::ui::loading::LoadingMark::new("cloud-opening")
                                        .size(crate::ui::loading::LoaderSize::Md)
                                        .tone(crate::ui::loading::Tone::Neutral),
                                )
                                .child(
                                    div()
                                        .text_size(px(theme::ty().ui.body))
                                        .text_color(t.text)
                                        .child(tr(message)),
                                ),
                        )
                        .child(
                            Button::new("cloud-opening-cancel")
                                .variant(ButtonVariant::Secondary)
                                .label(tr("common.action.cancel"))
                                .on_click(cx.listener(|s, _, _, cx| {
                                    s.files.cancel_cloud();
                                    cx.notify();
                                })),
                        ),
                )
                .into_any_element(),
        )
    }
    /// `OnboardingCreateProjectAction`: the default path in the empty state.
    fn create_action(&self, prominent: bool, busy: bool, cx: &mut Context<Self>) -> Button {
        Button::new("home-create-project")
            .variant(if prominent {
                ButtonVariant::EntryPrimary
            } else {
                ButtonVariant::Entry
            })
            .icon("file-plus-2")
            .label(tr("onboarding.action.createLocalProject"))
            .disabled(busy)
            .on_click(cx.listener(|s, _, w, cx| s.begin_create_project(w, cx)))
    }
    /// `ImportAction` with its GitHub and GitLab preview. Importing (cloning
    /// a repository) is not native yet, so the action is shown disabled.
    fn import_action(&self, t: Theme) -> Button {
        let label = tr("onboarding.action.importFromApps");
        let badge = |mark: &'static str| {
            // `.onboarding-entry-import-brand-badge`: a 20px disc ringed in
            // the canvas colour, overlapping its neighbour by 6px.
            div()
                .flex()
                .flex_shrink_0()
                .size(px(20.))
                .items_center()
                .justify_center()
                .rounded_full()
                .border_1()
                .border_color(t.canvas)
                .bg(theme::mix(t.muted, t.canvas, 0.12))
                .child(img(mark).size(px(14.)))
        };
        Button::new("home-import")
            .variant(ButtonVariant::Entry)
            .icon("download")
            .label(label)
            .disabled(true)
            .tooltip(tf(
                "settings.sidebar.notAvailable",
                &[("section", label.into())],
            ))
            .trailing(
                h_flex()
                    .ml(px(-2.))
                    // `.onboarding-entry-import:disabled` dims the preview.
                    .opacity(0.3)
                    .child(badge(if t.dark {
                        "integrations/github-inverse.svg"
                    } else {
                        "integrations/github.svg"
                    }))
                    .child(badge("integrations/gitlab.svg").ml(px(-6.))),
            )
    }
    /// `removeProject`: confirm, then forget the project (its files stay).
    fn confirm_remove_project(
        &mut self,
        path: PathBuf,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let name = self
            .recent_projects
            .iter()
            .find(|p| p.path == path)
            .map(project_name)
            .unwrap_or_default();
        let answer = window.prompt(
            PromptLevel::Warning,
            &tf(
                "settings.localProject.unlink.confirm",
                &[("workspace", name.into())],
            ),
            None,
            &[
                tr("settings.localProject.unlink.action"),
                tr("common.action.cancel"),
            ],
            cx,
        );
        cx.spawn(async move |this, cx| {
            if answer.await == Ok(0) {
                let _ = this.update(cx, |s, cx| {
                    s.preferences
                        .update(cx, |p, cx| p.change(|p| p.forget_project(&path), cx))
                });
            }
        })
        .detach();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn project_names_and_folders_display_like_the_product() {
        let project = |name: &str, path: &str| RecentProject {
            path: PathBuf::from(path),
            name: name.into(),
            opened_at: 0,
        };
        assert_eq!(project_name(&project("Notes", "/a/notes")), "Notes");
        assert_eq!(project_name(&project("", "/a/notes")), "notes");
        assert_eq!(project_name(&project("/a/notes", "/a/notes")), "notes");
        assert_eq!(
            parent_for_display(Path::new("/Users/ada/project/x")),
            "~/project"
        );
        assert_eq!(parent_for_display(Path::new("/Users/ada/x")), "~");
        assert_eq!(
            parent_for_display(Path::new("/private/tmp/x")),
            "/private/tmp"
        );
    }

    #[test]
    fn modification_times_round_down_to_minutes_hours_and_days() {
        let now = SystemTime::now();
        let ago = |secs: u64| modification_time(now - Duration::from_secs(secs), now);
        assert_eq!(ago(5), "Just now");
        assert_eq!(ago(150), "2 minutes ago");
        assert_eq!(ago(3 * 3600 + 5), "3 hours ago");
        assert_eq!(ago(26 * 3600), "1 day ago");
    }
}
