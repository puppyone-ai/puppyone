//! The window's modal layer: every dialog that takes the whole window, in the
//! order it opened. The top one answers Escape; while any is open the editor
//! and the Explorer's create commands are gated, and while a task dialog
//! (Settings, Help) is open the shell's other commands are held back.
//!
//! The Documents error (`Documents::error`) is not a modal here: it is live
//! save status that clears itself when a retry succeeds, so the shell shows
//! it above this layer for as long as it is set.
use super::{home::CreateProject, rename::Rename};
use crate::features::create_new::create_entry_dialog::CreateEntryDialog;
use gpui::Entity;

/// The task dialogs share one slot: opening one replaces the other.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Task {
    /// `SettingsDialog`.
    Settings,
    /// Help & feedback; its drafts live in `TaskUi`.
    Feedback,
}

pub(super) enum Modal {
    Task(Task),
    /// `DesktopCreateEntryDialog`: a new file or folder in the workspace.
    CreateEntry(Entity<CreateEntryDialog>),
    /// The homepage's "Create a project".
    CreateProject(CreateProject),
    /// Rename or change the file type of an Explorer entry.
    Rename(Rename),
    /// Quit while Agent or terminal processes still run.
    ConfirmQuit,
    /// `createItemLifecycleManager`: running Agent/terminal hosts of this
    /// window, listed from the host budget (not from their tabs).
    Executions,
    /// App menu → About PuppyOne (`role: "about"`).
    About,
    /// `CloudWorkspaceShareDialog`: the captured resource URL and its copy state.
    Share {
        url: Option<String>,
        copied: Option<bool>,
    },
    /// A notice; a later one replaces it.
    Error(String),
    /// `CloudWorkspaceSwitchDialog`: sign-in, matching or recovery of a
    /// Header switch to the Cloud Computer.
    CloudSwitch,
    /// `ProjectRowActions` rename: the shown name of a remembered Project.
    RenameProject(super::project_actions::ProjectRename),
    /// `ProjectRowActions` unlink: forget a Project, keep its files.
    UnlinkProject(std::path::PathBuf),
    /// `CloudWorkspaceRecovery` for a Homepage or dedicated-window opening.
    CloudRecovery {
        project: String,
        failure: crate::workspace::cloud::opening::Failure,
    },
}

/// Open modals, bottom to top.
#[derive(Default)]
pub(super) struct Modals(Vec<Modal>);
impl Modals {
    /// Opens `modal` on top. A task replaces the open task, an error the
    /// open error.
    pub fn open(&mut self, modal: Modal) {
        match &modal {
            Modal::Task(_) => {
                self.remove(|m| matches!(m, Modal::Task(_)));
            }
            Modal::Error(_) => {
                self.remove(|m| matches!(m, Modal::Error(_)));
            }
            _ => {}
        }
        self.0.push(modal);
    }
    /// Closes the topmost modal that matches.
    pub fn remove(&mut self, matches: impl Fn(&Modal) -> bool) -> Option<Modal> {
        let index = self.0.iter().rposition(matches)?;
        Some(self.0.remove(index))
    }
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
    pub fn top_mut(&mut self) -> Option<&mut Modal> {
        self.0.last_mut()
    }
    pub fn top(&self) -> Option<&Modal> {
        self.0.last()
    }
    /// Bottom to top, the order they paint in.
    pub fn iter(&self) -> impl Iterator<Item = &Modal> {
        self.0.iter()
    }
    pub fn task(&self) -> Option<Task> {
        self.0.iter().find_map(|m| match m {
            Modal::Task(task) => Some(*task),
            _ => None,
        })
    }
    pub fn create_entry(&self) -> Option<&Entity<CreateEntryDialog>> {
        self.0.iter().find_map(|m| match m {
            Modal::CreateEntry(form) => Some(form),
            _ => None,
        })
    }
    pub fn create_project(&mut self) -> Option<&mut CreateProject> {
        self.0.iter_mut().find_map(|m| match m {
            Modal::CreateProject(create) => Some(create),
            _ => None,
        })
    }
    #[cfg(test)]
    pub fn rename(&self) -> Option<&Rename> {
        self.0.iter().find_map(|m| match m {
            Modal::Rename(rename) => Some(rename),
            _ => None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn kinds(modals: &Modals) -> Vec<String> {
        modals
            .iter()
            .map(|m| match m {
                Modal::Task(task) => format!("{task:?}"),
                Modal::ConfirmQuit => "ConfirmQuit".into(),
                Modal::Error(error) => format!("Error({error})"),
                _ => "Other".into(),
            })
            .collect()
    }

    #[test]
    fn tasks_share_a_slot_and_errors_replace_each_other() {
        let mut modals = Modals::default();
        modals.open(Modal::Task(Task::Settings));
        modals.open(Modal::ConfirmQuit);
        modals.open(Modal::Error("a".into()));
        modals.open(Modal::Task(Task::Feedback));
        modals.open(Modal::Error("b".into()));
        assert_eq!(kinds(&modals), ["ConfirmQuit", "Feedback", "Error(b)"]);
        assert_eq!(modals.task(), Some(Task::Feedback));
        // The topmost match closes; the order of the rest is kept.
        assert!(modals.remove(|m| matches!(m, Modal::Task(_))).is_some());
        assert_eq!(kinds(&modals), ["ConfirmQuit", "Error(b)"]);
        assert!(matches!(modals.top(), Some(Modal::Error(_))));
    }
}
