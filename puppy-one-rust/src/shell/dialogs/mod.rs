//! The window's dialog layer: every dialog that takes the whole window, in
//! the order it opened. The top one answers Escape; while any is open the
//! editor and the Explorer's create commands are gated, and while a task
//! dialog (Settings, Help) is open the shell's other commands are held back.
//!
//! [`DialogLayer`] is an entity the shell paints above everything else. It
//! renders the window's own dialogs (the task dialogs, the create form, a
//! notice, the quit and close questions, the running sessions, a project
//! that could not open) and asks the shell to act on their buttons
//! ([`DialogEvent`]). A feature's dialog ([`Owned`]) is the feature's: it
//! hands the layer how to render it and how to dismiss it, and keeps its
//! state itself.
//!
//! The Documents error is not on the stack: it is live save status that
//! clears itself when a retry succeeds. The shell hands it over
//! ([`DialogLayer::set_status`]) and the layer shows it above every dialog
//! for as long as it is set.
mod builtin;
mod create_entry;
mod rename;
#[cfg(test)]
mod tests;

use super::Command;
use crate::{
    features::{
        create_new::create_entry_dialog::CreateEntryDialog,
        feedback::Feedback,
        settings::{SettingsWorkspaceSurface, preferences_store::PreferencesStore},
    },
    localization::t as tr,
    model::Node,
    ui::components::ButtonVariant,
    workspace::Workspace,
};
pub(crate) use builtin::{settings_dialog, task_backdrop};
use gpui::{prelude::*, *};
use std::{path::PathBuf, rc::Rc, sync::Arc};

/// The task dialogs share one slot: opening one replaces the other.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Task {
    /// `SettingsDialog`.
    Settings,
    /// Help & feedback; its drafts live in [`Feedback`].
    Feedback,
}

/// Which feature dialog an [`Owned`] dialog is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum DialogKey {
    /// `DesktopNodeRenameDialog`: rename or change the type of an entry.
    Rename,
    /// The homepage's "Create a project".
    CreateProject,
    /// `TemplateImportCard`: a template store link and "Get a copy".
    TemplateImport,
    /// `OnboardingImportDialog`: clone a repository into a new project.
    ImportRepository,
    /// `ProjectEntryLauncherDialog`: create, open a folder, or import.
    ProjectEntry,
    /// `ProjectRowActions` rename: a folder's shown name or a Cloud
    /// project's name.
    RenameProject,
    /// `ProjectRowConfirmDialog`: unlink a folder or delete a Cloud project.
    ConfirmProject,
    /// `CloudDialog`: the linked Project's Cloud services.
    CloudServices,
    /// Putting the open folder in the Cloud (the first publication).
    CloudPublish,
    /// `CloudPublishConfirmationDialog` before the first publication.
    ConfirmPublish,
    /// `MissingCloudProjectReplacement`.
    ReplaceCloud,
    /// `CloudWorkspaceRecovery` for a Cloud opening that failed.
    CloudRecovery,
    /// `CloudWorkspaceAgentsDialog`: Manage agents.
    ManageAgents,
}

type RenderDialog = Rc<dyn Fn(Size<Pixels>, &mut Window, &mut App) -> AnyElement>;
type DismissDialog = Rc<dyn Fn(&mut Window, &mut App)>;

/// A feature's dialog on the layer: how to paint it in a window of a size,
/// and what Escape does. Its state is the feature's.
pub(super) struct Owned {
    pub key: DialogKey,
    render: RenderDialog,
    dismiss: DismissDialog,
}

pub(super) enum Modal {
    Task(Task),
    /// `DesktopCreateEntryDialog`: a new file or folder in the workspace.
    CreateEntry(Entity<CreateEntryDialog>),
    /// `ProjectNavigationFailure`: a local Project that could not open, and
    /// why; Retry opens it again.
    ProjectFailure {
        path: PathBuf,
        message: String,
    },
    /// Quit while Agent or terminal processes still run.
    ConfirmQuit,
    /// Some document changes could not be saved for a close.
    CloseAnyway,
    /// `createItemLifecycleManager`: running Agent/terminal hosts of this
    /// window, listed from the host budget (not from their tabs).
    Executions,
    /// A notice; a later one replaces it.
    Error(String),
    /// A feature's dialog.
    Owned(Owned),
}

/// What the layer asks of the shell.
pub(super) enum DialogEvent {
    /// A dialog's button: the shell runs the command.
    Command(Command),
    /// A dialog closed itself: the window takes the focus back.
    Closed,
    /// The create form made an entry in `workspace` (`nodes` is `parent`
    /// listed again).
    Created {
        workspace: Arc<Workspace>,
        parent: PathBuf,
        path: PathBuf,
        folder: bool,
        nodes: Result<Vec<Node>, String>,
    },
    /// The rename dialog's answer: `path` takes `name`.
    Rename { path: PathBuf, name: String },
    /// A dialog's answer the shell shows as a notice.
    Error(String),
}

pub(super) struct DialogLayer {
    /// Open dialogs, bottom to top.
    stack: Vec<Modal>,
    /// The layer's focus: dialogs keep the keyboard while they are open.
    focus: FocusHandle,
    /// `SettingsDialog`'s content, kept while it is closed.
    pub settings: Entity<SettingsWorkspaceSurface>,
    /// Help → Feedback (`DesktopHelpLauncher`), with its draft.
    pub feedback: Entity<Feedback>,
    /// This window's task owner (`ownerId`): whose running sessions show.
    owner: String,
    /// The Documents error, above every dialog.
    status: Option<String>,
    /// The failed file operation behind a notice can run again.
    can_retry: bool,
}
impl EventEmitter<DialogEvent> for DialogLayer {}

impl DialogLayer {
    pub fn new(
        preferences: Entity<PreferencesStore>,
        owner: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let feedback = cx.new(|cx| Feedback::new(window, cx));
        // Its close button is the only way out; the draft is already gone.
        cx.subscribe(
            &feedback,
            |s, _, _: &crate::features::feedback::Close, cx| s.close_tasks(cx),
        )
        .detach();
        Self {
            stack: Vec::new(),
            focus: cx.focus_handle(),
            settings: cx.new(|cx| SettingsWorkspaceSurface::new(preferences, window, cx)),
            feedback,
            owner,
            status: None,
            can_retry: false,
        }
    }
    /// The layer's focus handle, for dialogs that trap the keyboard.
    pub fn focus_handle(&self) -> &FocusHandle {
        &self.focus
    }

    // ---------------------------------------------------------------- stack
    /// Opens `modal` on top. A task replaces the open task, an error the
    /// open error, a feature dialog the same feature dialog.
    pub fn open(&mut self, modal: Modal, cx: &mut Context<Self>) {
        match &modal {
            Modal::Task(_) => {
                self.remove(|m| matches!(m, Modal::Task(_)), cx);
            }
            Modal::Error(_) => {
                self.remove(|m| matches!(m, Modal::Error(_)), cx);
            }
            Modal::Owned(owned) => {
                let key = owned.key;
                self.close(key, cx);
            }
            _ => {}
        }
        self.stack.push(modal);
        cx.notify();
    }
    /// Opens a feature's dialog: `render` paints it, `dismiss` answers
    /// Escape.
    pub fn open_owned(
        &mut self,
        key: DialogKey,
        render: impl Fn(Size<Pixels>, &mut Window, &mut App) -> AnyElement + 'static,
        dismiss: impl Fn(&mut Window, &mut App) + 'static,
        cx: &mut Context<Self>,
    ) {
        self.open(
            Modal::Owned(Owned {
                key,
                render: Rc::new(render),
                dismiss: Rc::new(dismiss),
            }),
            cx,
        );
    }
    /// Closes the topmost dialog that matches.
    pub fn remove(
        &mut self,
        matches: impl Fn(&Modal) -> bool,
        cx: &mut Context<Self>,
    ) -> Option<Modal> {
        let index = self.stack.iter().rposition(matches)?;
        cx.notify();
        Some(self.stack.remove(index))
    }
    /// Closes the feature dialog `key`; `false` when it was not open.
    pub fn close(&mut self, key: DialogKey, cx: &mut Context<Self>) -> bool {
        self.remove(|m| matches!(m, Modal::Owned(o) if o.key == key), cx)
            .is_some()
    }
    pub fn contains(&self, key: DialogKey) -> bool {
        self.stack
            .iter()
            .any(|m| matches!(m, Modal::Owned(o) if o.key == key))
    }
    pub fn is_empty(&self) -> bool {
        self.stack.is_empty()
    }
    /// Bottom to top, the order they paint in.
    pub fn iter(&self) -> impl Iterator<Item = &Modal> {
        self.stack.iter()
    }
    pub fn task(&self) -> Option<Task> {
        self.stack.iter().find_map(|m| match m {
            Modal::Task(task) => Some(*task),
            _ => None,
        })
    }
    pub fn create_form(&self) -> Option<&Entity<CreateEntryDialog>> {
        self.stack.iter().find_map(|m| match m {
            Modal::CreateEntry(form) => Some(form),
            _ => None,
        })
    }
    /// The project that could not open, while its failure shows.
    pub fn failed_project(&self) -> Option<PathBuf> {
        self.stack.iter().find_map(|m| match m {
            Modal::ProjectFailure { path, .. } => Some(path.clone()),
            _ => None,
        })
    }
    /// The project that could not open and why, while its failure shows.
    #[cfg(test)]
    pub fn project_failure(&self) -> Option<(PathBuf, String)> {
        self.stack.iter().find_map(|m| match m {
            Modal::ProjectFailure { path, message } => Some((path.clone(), message.clone())),
            _ => None,
        })
    }
    /// A notice over everything else; a later one replaces it.
    pub fn show_error(&mut self, error: impl Into<String>, cx: &mut Context<Self>) {
        self.open(Modal::Error(error.into()), cx);
    }
    /// Closes Settings or Help; Help's draft goes with it.
    pub fn close_tasks(&mut self, cx: &mut Context<Self>) {
        if self.task() == Some(Task::Feedback) {
            self.feedback.update(cx, |f, cx| f.reset(cx));
        }
        self.remove(|m| matches!(m, Modal::Task(_)), cx);
        cx.emit(DialogEvent::Closed);
    }
    /// Escape on the topmost dialog, each with its own cancel. Help →
    /// Feedback leaves only by its close button; creating an entry is not
    /// abandoned midway.
    pub fn dismiss_top(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let closed = match self.stack.last() {
            None | Some(Modal::Task(Task::Feedback)) => false,
            Some(Modal::Task(_)) => {
                self.close_tasks(cx);
                false
            }
            Some(Modal::CreateEntry(form)) => !form.read(cx).busy(),
            Some(Modal::CloseAnyway) => {
                super::windows::cancel_quit(cx);
                true
            }
            Some(
                Modal::ConfirmQuit
                | Modal::Executions
                | Modal::ProjectFailure { .. }
                | Modal::Error(_),
            ) => true,
            Some(Modal::Owned(owned)) => {
                let dismiss = owned.dismiss.clone();
                // The owner may close it (or keep it while busy), once the
                // layer is free again.
                window.defer(cx, move |window, cx| dismiss(window, cx));
                false
            }
        };
        if closed {
            let refocus = matches!(self.stack.last(), Some(Modal::CreateEntry(_)));
            self.stack.pop();
            if refocus {
                cx.emit(DialogEvent::Closed);
            }
            cx.notify();
        }
    }

    /// The project root the Settings page reads (`Project` settings).
    pub fn set_root(&mut self, root: Option<PathBuf>, cx: &mut Context<Self>) {
        self.settings.update(cx, |s, cx| s.set_root(root, cx));
    }
    /// The Documents error over everything (`None` when it cleared), and
    /// whether the failed file operation behind a notice can run again.
    pub fn set_status(&mut self, status: Option<String>, can_retry: bool, cx: &mut Context<Self>) {
        if self.status != status || self.can_retry != can_retry {
            self.status = status;
            self.can_retry = can_retry;
            cx.notify();
        }
    }
    /// The topmost feature dialog, while it is on top.
    pub fn top_key(&self) -> Option<DialogKey> {
        match self.stack.last() {
            Some(Modal::Owned(owned)) => Some(owned.key),
            _ => None,
        }
    }
}

impl Render for DialogLayer {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if self.stack.is_empty() && self.status.is_none() {
            return div();
        }
        let size = window.viewport_size();
        let (w, h) = (f32::from(size.width), f32::from(size.height));
        let mut layers = Vec::with_capacity(self.stack.len() + 1);
        for modal in &self.stack {
            layers.push(match modal {
                Modal::Task(Task::Settings) => self.settings_view(w, h, cx).into_any_element(),
                Modal::Task(Task::Feedback) => self.feedback.clone().into_any_element(),
                Modal::CreateEntry(form) => self
                    .create_entry_view(form.clone(), w, h, cx)
                    .into_any_element(),
                Modal::ProjectFailure { message, .. } => {
                    self.project_failure_dialog(message, cx).into_any_element()
                }
                Modal::ConfirmQuit => self
                    .simple_modal(
                        tr("native.quit.title"),
                        tr("native.quit.detail"),
                        vec![
                            (
                                tr("native.quit.cancel"),
                                Command::CancelProcessQuit,
                                ButtonVariant::Secondary,
                            ),
                            (
                                tr("native.quit.confirm"),
                                Command::QuitWithProcesses,
                                ButtonVariant::SolidDanger,
                            ),
                        ],
                        cx,
                    )
                    .into_any_element(),
                Modal::CloseAnyway => self
                    .simple_modal(
                        tr("native.documentClose.message"),
                        tr("native.documentClose.detail"),
                        vec![
                            (
                                tr("native.documentClose.closeAnyway"),
                                Command::CloseAnyway,
                                ButtonVariant::Secondary,
                            ),
                            (
                                tr("native.documentClose.keepOpen"),
                                Command::KeepWindowOpen,
                                ButtonVariant::Solid,
                            ),
                        ],
                        cx,
                    )
                    .into_any_element(),
                Modal::Executions => self.executions_dialog(cx).into_any_element(),
                Modal::Error(message) => self.error_dialog(message, cx).into_any_element(),
                Modal::Owned(owned) => (owned.render)(size, window, cx),
            });
        }
        if let Some(message) = &self.status {
            layers.push(self.error_dialog(message, cx).into_any_element());
        }
        div()
            .absolute()
            .top_0()
            .left_0()
            .size_full()
            .children(layers)
    }
}
