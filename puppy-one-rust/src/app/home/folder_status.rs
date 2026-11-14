//! FA (`folder-availability/*`, `folder-relocation.mjs`): a project whose
//! folder moved, was renamed, sits on a disk that is away, or may not be
//! opened. Said as a fact and without blame, with what can be done.
//!
//! - On the Homepage the project's folder fades and says why in a few
//!   words; opening it asks what to do instead (`UnavailableProjectDialog`).
//! - In a window showing it, a notice says so; the rest keeps working
//!   (`ProjectFolderNotices`).
//! - "Find it…" lets the person point at the folder in the system picker
//!   (which opens where it last was: GPUI's open panel takes no starting
//!   folder, where the product starts from the nearest place that is left).
//!   A folder that does not look like the same one is used only after the
//!   person says so; one found renamed where it was is offered as it is.
//! - A relocation rewrites the project's record and, where a window shows
//!   it, opens it from its new place. A disk that is away offers nothing to
//!   remove: it comes back by itself.
//!
//! Statuses are read with the list's own activity, when the page or the
//! project menu appears, the list changes, or the window comes to the front.
use super::*;
use crate::{
    localization::bidi_isolate,
    platform::folder_availability::{self, State},
    ui::components::{Dialog, FloatingNotice, NoticeAction, NoticeTone},
};

/// What a notice action does to the Homepage.
type NoticeRun = Box<dyn Fn(&mut Homepage, &mut Context<Homepage>)>;

/// `FolderStatus` for a folder that cannot be opened now.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::app) struct FolderStatus {
    pub state: State,
    /// The same folder, found renamed where it was (`suggestion`).
    pub found: Option<PathBuf>,
}

/// `FolderCandidate.match`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::app) enum Match {
    SameFolder,
    SameCloudProject,
    Different,
}

/// The folder question on screen.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::app) enum FolderQuestion {
    /// `UnavailableProjectDialog`: opening a project whose folder is not there.
    Unavailable(PathBuf),
    /// A chosen folder that does not look like the same one.
    Confirm { from: PathBuf, to: PathBuf },
}

/// `folderNameOf`.
fn name_of(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}
/// `folderPlaceOf`: where it was, home-relative, so the place is known.
fn place_of(path: &Path) -> String {
    let parent = path.parent().unwrap_or(path);
    let home = crate::platform::paths::home_dir();
    match parent.strip_prefix(&home) {
        Ok(rest) if rest.as_os_str().is_empty() => "~".into(),
        Ok(rest) => format!("~/{}", rest.display()),
        Err(_) => parent.display().to_string(),
    }
}
/// `folderStatusMessage`.
pub(in crate::app) fn status_message(path: &Path, status: &FolderStatus) -> String {
    let name = bidi_isolate(&name_of(path));
    let place = bidi_isolate(&place_of(path));
    if let Some(found) = &status.found {
        return tf(
            "shell.folderStatus.renamed",
            &[
                ("name", name.into()),
                ("newName", bidi_isolate(&name_of(found)).into()),
            ],
        );
    }
    let key = match status.state {
        State::Disconnected => "shell.folderStatus.disconnected",
        State::Denied => "shell.folderStatus.denied",
        State::NotAFolder => "shell.folderStatus.notAFolder",
        _ => "shell.folderStatus.missing",
    };
    tf(key, &[("name", name.into()), ("place", place.into())])
}
/// `folderStatusCaption`: the few words under a project on the Homepage.
pub(in crate::app) fn status_caption(status: &FolderStatus) -> &'static str {
    match status.state {
        State::Disconnected => "shell.folderStatus.caption.disconnected",
        State::Denied => "shell.folderStatus.caption.denied",
        _ => "shell.folderStatus.caption.missing",
    }
}
/// `canLocate`: a disk that is away comes back by itself.
fn can_locate(status: &FolderStatus) -> bool {
    matches!(status.state, State::Missing | State::NotAFolder)
}

/// The status read for `path` with what was recorded of it, off the main
/// thread; `None` when the folder can be opened.
pub(in crate::app) fn read_status(path: &Path, identity_was: Option<&str>) -> Option<FolderStatus> {
    let state = folder_availability::probe(path);
    (state != State::Available).then(|| FolderStatus {
        state,
        found: (state == State::Missing)
            .then(|| identity_was.and_then(|id| folder_availability::renamed_in_place(path, id)))
            .flatten(),
    })
}

impl Homepage {
    /// What is known of `path`'s folder not opening, if anything.
    pub(in crate::app) fn folder_status(&self, path: &Path) -> Option<&FolderStatus> {
        self.unavailable.get(path)
    }
    /// The open project's folder, and whether it can be opened now.
    pub(in crate::app) fn check_window_folder(&mut self, cx: &mut Context<Self>) {
        let Some(root) = self.session.root.clone().filter(|_| !self.session.home) else {
            self.window_folder = None;
            return;
        };
        let identity = self
            .recent(cx)
            .iter()
            .find(|p| p.path == root)
            .and_then(|p| p.fs_identity.clone());
        let path = root.clone();
        let task = cx
            .background_executor()
            .spawn(async move { read_status(&path, identity.as_deref()) });
        cx.spawn(async move |this, cx| {
            let status = task.await;
            let _ = this.update(cx, |s, cx| {
                if s.session.root.as_ref() == Some(&root) {
                    let next = status.map(|status| (root, status));
                    if s.window_folder != next {
                        s.window_folder = next;
                        cx.notify();
                    }
                }
            });
        })
        .detach();
    }
    /// `onOpenUnavailableProject`: what to do instead, read again first.
    pub(in crate::app) fn open_unavailable(&mut self, path: PathBuf, cx: &mut Context<Self>) {
        self.folder_question = Some(FolderQuestion::Unavailable(path));
        self.folder_error = None;
        self.open_dialog(DialogKey::ProjectFolder, cx);
        self.read_for = None;
        self.refresh_activity(cx);
        cx.notify();
    }
    pub(in crate::app) fn close_folder_question(&mut self, cx: &mut Context<Self>) {
        if self.folder_busy {
            return;
        }
        self.folder_question = None;
        self.folder_error = None;
        self.close_dialog(DialogKey::ProjectFolder, cx);
        cx.notify();
    }
    /// `removeWorkspaceFromRecents`.
    fn remove_unavailable(&mut self, path: PathBuf, cx: &mut Context<Self>) {
        self.close_folder_question(cx);
        self.unavailable.remove(&path);
        self.preferences
            .update(cx, |p, cx| p.change(|p| p.forget_project(&path), cx));
    }
    /// `locate`: the person points at where the folder is now.
    pub(in crate::app) fn locate_folder(&mut self, from: PathBuf, cx: &mut Context<Self>) {
        if self.folder_busy {
            return;
        }
        let prompt = cx.prompt_for_paths(PathPromptOptions {
            files: false,
            directories: true,
            multiple: false,
            prompt: Some(tr("shell.folderStatus.locate").into()),
        });
        self.folder_busy = true;
        self.folder_error = None;
        cx.notify();
        let identity = self
            .recent(cx)
            .iter()
            .find(|p| p.path == from)
            .and_then(|p| p.fs_identity.clone());
        let locator = self.locators.get(&from).cloned().flatten();
        cx.spawn(async move |this, cx| {
            let chosen = prompt.await.ok().and_then(Result::ok).flatten();
            let _ = this.update(cx, |s, cx| {
                s.folder_busy = false;
                let chosen = chosen.and_then(|paths| paths.into_iter().next());
                let Some(chosen) = chosen.and_then(|p| p.canonicalize().ok()) else {
                    return cx.notify();
                };
                if chosen == from {
                    return cx.notify();
                }
                let task = cx.background_executor().spawn({
                    let chosen = chosen.clone();
                    async move { match_of(identity.as_deref(), locator.as_ref(), &chosen) }
                });
                cx.spawn(async move |this, cx| {
                    let found = task.await;
                    let _ = this.update(cx, |s, cx| {
                        if found == Match::Different {
                            s.folder_question = Some(FolderQuestion::Confirm { from, to: chosen });
                            s.open_dialog(DialogKey::ProjectFolder, cx);
                            cx.notify();
                        } else {
                            s.relocate_folder(from, chosen, cx);
                        }
                    });
                })
                .detach();
            });
        })
        .detach();
    }
    /// `relocate`: use the confirmed place from now on, everywhere the
    /// project is remembered, once it can still be opened.
    pub(in crate::app) fn relocate_folder(
        &mut self,
        from: PathBuf,
        to: PathBuf,
        cx: &mut Context<Self>,
    ) {
        if self.folder_busy {
            return;
        }
        self.folder_busy = true;
        self.folder_error = None;
        let target = to.clone();
        let task = cx
            .background_executor()
            .spawn(async move { folder_availability::probe(&target) == State::Available });
        cx.spawn(async move |this, cx| {
            let available = task.await;
            let _ = this.update(cx, |s, cx| {
                s.folder_busy = false;
                if !available {
                    s.folder_error = Some(tr("shell.folderRelocate.failed").into());
                    if s.folder_question.is_none() {
                        s.folder_question = Some(FolderQuestion::Unavailable(from.clone()));
                        s.open_dialog(DialogKey::ProjectFolder, cx);
                    }
                    return cx.notify();
                }
                // Sharing named the old place; it does not follow the folder
                // (other computers are not offered in this release).
                s.preferences.update(cx, |p, cx| {
                    p.change(
                        |p| {
                            p.relocate_project(&from, &to);
                        },
                        cx,
                    )
                });
                s.unavailable.remove(&from);
                if s.window_folder
                    .as_ref()
                    .is_some_and(|(root, _)| *root == from)
                {
                    s.window_folder = None;
                    cx.emit(HomeEvent::OpenProject(to.clone()));
                }
                s.folder_question = None;
                s.close_dialog(DialogKey::ProjectFolder, cx);
                s.read_for = None;
                s.refresh_activity(cx);
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }

    /// `UnavailableProjectDialog` or the confirmation of a different folder.
    pub(in crate::app) fn project_folder_dialog(&self, cx: &mut Context<Self>) -> Option<Dialog> {
        let question = self.folder_question.clone()?;
        let host = self.weak.clone();
        let t = cx.palette();
        let busy = self.folder_busy;
        let (title, body, secondary, primary): (String, String, Button, Button) = match question {
            FolderQuestion::Unavailable(path) => {
                let status = self
                    .unavailable
                    .get(&path)
                    .cloned()
                    .unwrap_or(FolderStatus {
                        state: State::Missing,
                        found: None,
                    });
                let name = bidi_isolate(&name_of(&path));
                let title = tf(
                    if matches!(status.state, State::Disconnected | State::Denied) {
                        "shell.folderStatus.cantOpenTitle"
                    } else {
                        "shell.folderStatus.cantFindTitle"
                    },
                    &[("name", name.into())],
                );
                let body = status_message(&path, &status);
                let button =
                    |id: &'static str, label: String| Button::new(id).label(label).disabled(busy);
                let (secondary, primary) = match (&status.found, can_locate(&status)) {
                    (Some(found), _) => {
                        let (from, to) = (path.clone(), found.clone());
                        let locate = path.clone();
                        (
                            button("folder-locate", tr("shell.folderStatus.locate").into())
                                .on_click(cx.listener(move |s, _, _, cx| {
                                    s.locate_folder(locate.clone(), cx)
                                })),
                            button(
                                "folder-use-found",
                                tf(
                                    "shell.folderStatus.useFound",
                                    &[("name", bidi_isolate(&name_of(found)).into())],
                                ),
                            )
                            .on_click(cx.listener(
                                move |s, _, _, cx| s.relocate_folder(from.clone(), to.clone(), cx),
                            )),
                        )
                    }
                    (None, locatable) => {
                        let remove = path.clone();
                        let secondary =
                            button(
                                "folder-remove",
                                tr("shell.folderStatus.removeFromList").into(),
                            )
                            .on_click(cx.listener(
                                move |s, _, _, cx| s.remove_unavailable(remove.clone(), cx),
                            ));
                        let primary = if locatable {
                            let locate = path.clone();
                            button("folder-locate", tr("shell.folderStatus.locate").into())
                                .on_click(cx.listener(move |s, _, _, cx| {
                                    s.locate_folder(locate.clone(), cx)
                                }))
                        } else {
                            button("folder-close", tr("common.action.close").into())
                                .on_click(cx.listener(|s, _, _, cx| s.close_folder_question(cx)))
                        };
                        (secondary, primary)
                    }
                };
                (title, body, secondary, primary)
            }
            FolderQuestion::Confirm { from, to } => {
                let name = bidi_isolate(&name_of(&from));
                let title = tf(
                    "shell.folderRelocate.confirmTitle",
                    &[("name", name.clone().into())],
                );
                let body = tf(
                    "shell.folderRelocate.different",
                    &[
                        ("chosen", bidi_isolate(&name_of(&to)).into()),
                        ("name", name.into()),
                    ],
                );
                let again = from.clone();
                let secondary = Button::new("folder-choose-again")
                    .label(tr("shell.folderRelocate.chooseAgain"))
                    .disabled(busy)
                    .on_click(cx.listener(move |s, _, _, cx| {
                        s.folder_question = None;
                        s.close_dialog(DialogKey::ProjectFolder, cx);
                        s.locate_folder(again.clone(), cx)
                    }));
                let primary = Button::new("folder-use-it")
                    .label(tr("shell.folderRelocate.useIt"))
                    .disabled(busy)
                    .on_click(cx.listener(move |s, _, _, cx| {
                        s.relocate_folder(from.clone(), to.clone(), cx)
                    }));
                (title, body, secondary, primary)
            }
        };
        let error = self.folder_error.clone();
        Some(
            Dialog::new("project-folder")
                .width(420.)
                .title(title)
                .on_close(move |_, cx| {
                    let _ = host.update(cx, |s, cx| s.close_folder_question(cx));
                })
                .child(
                    v_flex()
                        .gap(px(8.))
                        .child(
                            div()
                                .text_size(px(theme::ty().ui.body))
                                .line_height(relative(1.5))
                                .text_color(t.muted)
                                .child(body),
                        )
                        .children(error.map(|error| {
                            div()
                                .text_size(px(theme::ty().ui.meta))
                                .text_color(t.danger)
                                .child(error)
                        })),
                )
                .footer(secondary.variant(ButtonVariant::Secondary))
                .footer(primary.variant(ButtonVariant::Solid)),
        )
    }

    /// `ProjectFolderNotices` for this window's folder.
    pub(in crate::app) fn folder_notice(&self) -> Option<FloatingNotice> {
        let (path, status) = self.window_folder.clone()?;
        let host = self.weak.clone();
        let busy = self.folder_busy;
        let action = |id: &'static str, label: String, run: NoticeRun| {
            let host = host.clone();
            NoticeAction::new(id, label, move |_, cx| {
                if !busy {
                    let _ = host.update(cx, |s, cx| run(s, cx));
                }
            })
        };
        let mut notice =
            FloatingNotice::new("project-folder-notice", status_message(&path, &status))
                .tone(NoticeTone::Warning);
        if let Some(found) = status.found.clone() {
            let (from, to, locate) = (path.clone(), found.clone(), path.clone());
            notice = notice
                .action(action(
                    "project-folder-use-found",
                    tf(
                        "shell.folderStatus.useFound",
                        &[("name", bidi_isolate(&name_of(&found)).into())],
                    ),
                    Box::new(move |s, cx| s.relocate_folder(from.clone(), to.clone(), cx)),
                ))
                .action(action(
                    "project-folder-locate",
                    tr("shell.folderStatus.locate").into(),
                    Box::new(move |s, cx| s.locate_folder(locate.clone(), cx)),
                ));
        } else if can_locate(&status) {
            let (locate, remove) = (path.clone(), path.clone());
            notice = notice
                .action(action(
                    "project-folder-locate",
                    tr("shell.folderStatus.locate").into(),
                    Box::new(move |s, cx| s.locate_folder(locate.clone(), cx)),
                ))
                // The only folder of the window: removing it leaves for the
                // Homepage.
                .action(action(
                    "project-folder-remove",
                    tr("shell.folderStatus.removeFromList").into(),
                    Box::new(move |s, cx| {
                        s.preferences
                            .update(cx, |p, cx| p.change(|p| p.forget_project(&remove), cx));
                        s.window_folder = None;
                        cx.emit(HomeEvent::Command(Command::Home));
                    }),
                ));
        } else {
            notice = notice.action(action(
                "project-folder-retry",
                tr("common.action.retry").into(),
                Box::new(|s, cx| s.check_window_folder(cx)),
            ));
        }
        Some(notice)
    }
}

/// `matchOf`: whether a chosen folder is the one the project was.
fn match_of(
    identity_was: Option<&str>,
    locator_was: Option<&locator::Locator>,
    chosen: &Path,
) -> Match {
    if identity_was.is_some() && folder_availability::identity(chosen).as_deref() == identity_was {
        return Match::SameFolder;
    }
    let locator = project_activity::remote_urls(chosen)
        .and_then(|urls| locator::canonical_locator(urls.iter().map(String::as_str)));
    match (locator_was, locator) {
        (Some(was), Some(now)) if *was == now => Match::SameCloudProject,
        _ => Match::Different,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn a_status_says_what_happened_and_what_helps() {
        let path = Path::new("/Volumes/Archive/Notes");
        let missing = FolderStatus {
            state: State::Missing,
            found: None,
        };
        assert!(status_message(path, &missing).contains("Notes"));
        assert!(can_locate(&missing));
        let away = FolderStatus {
            state: State::Disconnected,
            found: None,
        };
        assert!(
            !can_locate(&away),
            "a disk that is away comes back by itself"
        );
        assert_eq!(
            status_caption(&away),
            "shell.folderStatus.caption.disconnected"
        );
        let renamed = FolderStatus {
            state: State::Missing,
            found: Some("/Volumes/Archive/Notes 2026".into()),
        };
        assert!(status_message(path, &renamed).contains("Notes 2026"));
        let home = crate::platform::paths::home_dir();
        assert_eq!(place_of(&home.join("Documents/Notes")), "~/Documents");
    }
}
