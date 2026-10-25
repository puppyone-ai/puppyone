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
use crate::{
    features::settings::preference_types::RecentProject,
    localization::{TimeUnit, relative_past, t as tr, tf},
    platform::project_activity,
    theme::metric,
    ui::{
        appearance::ActiveAppearance,
        components::{Button, ButtonVariant, Icon, IconButton, MenuItem, MenuRow, MenuVariant},
    },
};
use gpui_kit::{
    base::{Disableable as _, h_flex, v_flex},
    component::Sizable as _,
};
use std::{
    collections::HashMap,
    path::Path,
    time::{Duration, SystemTime},
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
    /// The projects the activity was read for; a new list reads again.
    read_for: Option<Vec<PathBuf>>,
    /// The homepage was showing at the last frame.
    shown: bool,
    /// Activity is being read.
    pub reading: bool,
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
    /// Reads when each project last changed whenever the homepage appears or
    /// its list changes, off the main thread.
    pub(super) fn refresh_home_activity(&mut self, cx: &mut Context<Self>) {
        let shown = self.home_visible();
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
                    (path, changed)
                })
                .collect::<HashMap<_, _>>()
        });
        cx.spawn(async move |this, cx| {
            let activity = read.await;
            let _ = this.update(cx, |s, cx| {
                s.homepage.activity = activity;
                s.homepage.reading = false;
                cx.notify();
            });
        })
        .detach();
    }
    /// The projects in homepage order: last change first, then by name.
    fn home_projects(&self) -> Vec<(&RecentProject, Option<SystemTime>)> {
        let mut projects: Vec<_> = self
            .recent_projects
            .iter()
            .map(|p| (p, self.homepage.activity.get(&p.path).copied().flatten()))
            .collect();
        projects.sort_by(|(a, a_time), (b, b_time)| {
            b_time
                .cmp(a_time)
                .then_with(|| {
                    project_name(a)
                        .to_lowercase()
                        .cmp(&project_name(b).to_lowercase())
                })
                .then_with(|| a.path.cmp(&b.path))
        });
        projects
    }
    pub(super) fn home_view(&self, cx: &mut Context<Self>) -> Div {
        let t = cx.palette();
        let has_projects = !self.recent_projects.is_empty();
        let busy = self.pending || self.files.busy();
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
                self.project_list(busy, cx).into_any_element()
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
                    .icon("folder-open")
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
    }
    /// `OnboardingProjectList`: one menu row per project, its folder and
    /// last change; hovering a row trades the time for Remove.
    fn project_list(&self, busy: bool, cx: &mut Context<Self>) -> Stateful<Div> {
        let t = cx.palette();
        let now = SystemTime::now();
        let rows =
            self.home_projects()
                .into_iter()
                .enumerate()
                .map(|(index, (project, changed))| {
                    let name = project_name(project);
                    let path = project.path.clone();
                    let remove = project.path.clone();
                    let remove_label = tf(
                        "onboarding.projects.removeFor",
                        &[("project", name.clone().into())],
                    );
                    let mut item = MenuItem::new(name.clone())
                        .icon_sized(Icon::new("folder").small().stroke(1.85))
                        .detail(parent_for_display(&project.path))
                        .disabled(busy)
                        .hover_trailing(
                            // `DesktopMenuIconButton.onboarding-project-remove`.
                            IconButton::new(("home-project-remove", index), "unlink")
                                .label(remove_label.clone())
                                .with_size(px(22.))
                                .rounded(px(5.))
                                .color(t.text_disabled)
                                .danger()
                                .on_click(cx.listener(move |s, _, w, cx| {
                                    cx.stop_propagation();
                                    s.confirm_remove_project(remove.clone(), w, cx);
                                })),
                        )
                        .on_click({
                            let host = cx.weak_entity();
                            move |w, cx| {
                                let _ =
                                    host.update(cx, |s, cx| s.open_project(path.clone(), w, cx));
                            }
                        });
                    if let Some(changed) = changed {
                        item = item.trailing_text(modification_time(changed, now));
                    }
                    MenuRow::new(("home-project", index), item).variant(MenuVariant::Homepage)
                });
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
