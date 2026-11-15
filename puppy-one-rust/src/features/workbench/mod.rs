//! `AuxiliaryWorkbench`: the right sidebar's tabbed, splittable
//! workbench (`AuxiliaryWorkbenchPanel` over `ProjectWorkbenchStore`). It
//! owns the topology (groups, tabs, splits), the header chrome and the saved
//! state; each tab's content is a contribution's [`WorkbenchItem`]. The
//! launcher and the items it creates come from the shell's
//! [`WorkbenchHost`]; nothing here names a contribution.
mod close_dialog;
mod drag;
mod header;
mod header_layout;
mod host;
mod item;
#[cfg(feature = "dev-capture")]
mod lab;
mod layout;
mod menus;
mod persistence;
mod store;
#[cfg(test)]
mod tests;
mod view;
pub use host::{CreationRetry, LauncherContext, WorkbenchHost, WorkbenchView};
pub use item::{CloseCopy, CloseDecision, ItemKind, ItemSnapshot, ItemStatus, WorkbenchItem};
#[cfg(feature = "dev-capture")]
pub use lab::LabTabs;
pub use layout::Id;
pub use persistence::RetainedItem;

use crate::platform::ui_state_store::{self, ResultEvent};
use crate::theme;
use crate::ui::{
    appearance::ActiveAppearance,
    components::{Button, ButtonVariant, ResizeHandle},
};
use crate::{theme::Theme, wake::Wake};
use drag::{DropIntent, Edge};
use gpui::{prelude::*, *};
use gpui_kit::base::{h_flex, v_flex};
use layout::{Axis, Layout, Node};
use persistence::StoredProject;
use std::{collections::HashMap, path::PathBuf, rc::Rc, sync::mpsc};

enum Content {
    Launcher,
    Retained(RetainedItem),
    /// A contribution's item, and what keeps the Workbench watching it.
    Item {
        item: Rc<dyn WorkbenchItem>,
        _watch: Subscription,
    },
}
impl Content {
    fn item(&self) -> Option<&dyn WorkbenchItem> {
        match self {
            Self::Item { item, .. } => Some(item.as_ref()),
            _ => None,
        }
    }
    fn busy(&self, cx: &App) -> bool {
        self.item().is_some_and(|item| item.snapshot(cx).running)
    }
    /// The contribution this tab counts against.
    fn kind(&self) -> Option<ItemKind> {
        match self {
            Self::Item { item, .. } => Some(item.kind()),
            Self::Retained(item) => item.kind(),
            Self::Launcher => None,
        }
    }
    /// `minimumSize` of the tab (a launcher's is a chat's).
    fn minimum_size(&self) -> (f32, f32) {
        self.kind().unwrap_or(ItemKind::Chat).minimum_size()
    }
    /// `AuxiliaryWorkbenchItemSnapshot.detail` for the overflow menu.
    fn detail(&self, cx: &App) -> Option<String> {
        self.item().and_then(|item| item.snapshot(cx).detail)
    }
    fn title(&self, cx: &App) -> String {
        match self {
            Self::Launcher => crate::localization::t("workspace.workbench.newTab").into(),
            Self::Retained(item) => item.title(),
            Self::Item { item, .. } => item.snapshot(cx).title,
        }
    }
}
#[derive(Default)]
struct Project {
    layout: Layout,
    content: HashMap<Id, Content>,
    loading: bool,
    saved: Option<blake3::Hash>,
    storage_error: Option<String>,
}
#[derive(Clone)]
struct DragTab {
    root: PathBuf,
    tab: Id,
    title: String,
    /// Where the pointer held the tab; the preview sits 18px before and
    /// 12px below the pointer (`moveWorkbenchTabMovePreview`).
    grab: Point<Pixels>,
}
impl Render for DragTab {
    /// `.desktop-terminal-tab-move-preview`: a quiet pill under the pointer.
    /// Its fill is `color-mix(var(--po-surface) 94%)`, and `--po-surface` is
    /// not a theme token, so the product paints only border and text; the
    /// popover shadow is dropped because GPUI would draw it under the
    /// transparent body instead of only outside it.
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.palette();
        let m = theme::ty();
        div()
            .ml(self.grab.x - px(18.))
            .mt(self.grab.y + px(12.))
            .max_w(px(220.))
            .px(px(10.))
            .py(px(6.))
            .rounded(px(theme::metric::TOOLBAR_ACTION_RADIUS))
            .border_1()
            .border_color(theme::alpha(t.border, 0.8))
            .opacity(0.94)
            .text_size(px(m.header.content))
            .line_height(px(m.header.line_height))
            .text_color(t.text)
            .truncate()
            .child(self.title.clone())
    }
}
/// Requests the workbench's items make of the window (routed by the shell):
/// each opens something the workbench does not own.
#[derive(Clone, Debug)]
#[allow(clippy::enum_variant_names)]
pub enum WorkbenchEvent {
    OpenModelConnections,
    /// A chat asked for the account (`onOpenAccount`).
    OpenAccount,
    /// A chat opened `path` of the project at `root` (`onOpenFile`).
    OpenAgentFile {
        root: PathBuf,
        path: String,
    },
}
impl EventEmitter<WorkbenchEvent> for Workbench {}
pub struct Workbench {
    projects: HashMap<PathBuf, Project>,
    root: Option<PathBuf>,
    /// The shell's launcher and the contributions behind it.
    host: Option<Rc<dyn WorkbenchHost>>,
    confirm: Option<Id>,
    /// Close dialog keyboard state: focused action (0 Cancel, 1 confirm),
    /// whether it was reached by keyboard, and a pending initial focus.
    close_focus: FocusHandle,
    close_choice: usize,
    close_keyboard: bool,
    close_focus_pending: bool,
    bounds: HashMap<Id, Bounds<Pixels>>,
    drag_split: Option<(Id, Axis, Bounds<Pixels>)>,
    overflow: Option<Id>,
    /// The open tab or launcher context menu.
    context_menu: Option<menus::ContextMenu>,
    wake: Wake,
    store_tx: mpsc::SyncSender<ResultEvent>,
    store_rx: mpsc::Receiver<ResultEvent>,
    header_focus: HashMap<(PathBuf, Id), FocusHandle>,
    /// Rendered tab window per group (`preferredVisibleSessionIds`).
    header_windows: HashMap<(PathBuf, Id), Vec<Id>>,
    /// Each group header's layout motion, and whether a frame is scheduled.
    header_motion: HashMap<(PathBuf, Id), header_layout::Motion>,
    motion_frame: bool,
    /// Hidden items of each group's header (its overflow menu).
    overflow_hidden: HashMap<Id, Vec<Id>>,
    /// The tab being dragged and where releasing it would put it.
    dragging: Option<Id>,
    drop_intent: Option<DropIntent>,
    /// `creationFailure`: an item a launcher tab could not become.
    creation_failure: Option<CreationFailure>,
    /// The close dialog refuses (an unconfirmed Cloud submission).
    close_blocked: bool,
    /// Tabs whose item is being released.
    closing: std::collections::HashSet<Id>,
    /// What the host last heard (it hears only changes).
    shown: WorkbenchView,
}
/// `AuxiliaryWorkbenchCreationFailure`: the tab, the item it was to be
/// (`label`) and the contribution's retry (`retryCreation`).
struct CreationFailure {
    tab: Id,
    message: String,
    retry: Option<CreationRetry>,
}
impl Workbench {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let (wake, rx) = Wake::channel();
        let (store_tx, store_rx) = mpsc::sync_channel(64);
        cx.spawn_in(window, async move |this, cx| {
            while rx.recv().await.is_ok() {
                if this
                    .update_in(cx, |s, _, cx| s.restore_results(cx))
                    .is_err()
                {
                    break;
                }
            }
        })
        .detach();
        // Saving and the items' presentation follow every change, after
        // the update that made it.
        cx.defer_in(window, |_, window, cx| {
            let this = cx.entity();
            cx.observe_in(&this, window, |s, _, window, cx| s.changed(window, cx))
                .detach();
        });
        Self {
            wake,
            store_tx,
            store_rx,
            projects: HashMap::new(),
            root: None,
            host: None,
            confirm: None,
            close_focus: cx.focus_handle(),
            close_choice: 0,
            close_keyboard: false,
            close_focus_pending: false,
            bounds: HashMap::new(),
            drag_split: None,
            overflow: None,
            context_menu: None,
            header_focus: HashMap::new(),
            header_windows: HashMap::new(),
            header_motion: HashMap::new(),
            motion_frame: false,
            overflow_hidden: HashMap::new(),
            dragging: None,
            drop_intent: None,
            creation_failure: None,
            close_blocked: false,
            closing: Default::default(),
            shown: WorkbenchView::default(),
        }
    }
    /// The shell's launcher and contributions.
    pub fn set_host(&mut self, host: Rc<dyn WorkbenchHost>) {
        self.host = Some(host);
    }
    /// A tab's title: a launcher showing something else (History) takes
    /// the host's.
    fn tab_title(&self, tab: Id, content: &Content, cx: &App) -> String {
        if matches!(content, Content::Launcher)
            && let Some(title) = self.host.as_ref().and_then(|h| h.launcher_title(tab, cx))
        {
            return title;
        }
        content.title(cx)
    }
    /// After every change: the saved state, then which items are shown.
    fn changed(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.persist(cx);
        self.sync_presentation(window, cx);
        let mut roots: Vec<PathBuf> = self.projects.keys().cloned().collect();
        roots.sort();
        let view = WorkbenchView {
            root: self.root.clone(),
            roots,
            open_chats: self.open_resources(ItemKind::Chat, cx),
        };
        if view != self.shown {
            self.shown = view.clone();
            if let Some(host) = self.host.clone() {
                host.changed(view, cx);
            }
        }
        // The close dialog follows its item: a vanished item takes it down.
        if let Some(tab) = self.confirm
            && self.close_copy(tab, cx).is_none()
        {
            self.confirm = None;
        }
        if std::mem::take(&mut self.close_focus_pending) && self.confirm.is_some() {
            self.close_focus.focus(window, cx);
        }
    }
    /// `presented` (the shown tab of its group) and `commandTarget` (that
    /// tab in the active group) for every item; other projects' items are
    /// hidden.
    fn sync_presentation(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let current = self.root.clone();
        let mut updates = Vec::new();
        for (root, project) in &self.projects {
            for (tab, content) in &project.content {
                let Content::Item { item, .. } = content else {
                    continue;
                };
                let group = project
                    .layout
                    .groups
                    .iter()
                    .find(|(_, g)| g.tabs.contains(tab));
                let presented = current.as_ref() == Some(root)
                    && group.is_some_and(|(_, g)| g.active == Some(*tab));
                let command_target =
                    presented && group.is_some_and(|(id, _)| *id == project.layout.active_group);
                updates.push((item.clone(), presented, command_target));
            }
        }
        for (item, presented, command_target) in updates {
            item.set_presentation(presented, command_target, window, cx);
        }
    }
    /// The tab's content over `item`, watched.
    fn content(&mut self, item: Rc<dyn WorkbenchItem>, cx: &mut Context<Self>) -> Content {
        let subscription = item.watch(cx);
        Content::Item {
            item,
            _watch: subscription,
        }
    }
    fn project(&self) -> Option<&Project> {
        self.root.as_ref().and_then(|r| self.projects.get(r))
    }
    fn project_mut(&mut self) -> Option<&mut Project> {
        self.root.as_ref().and_then(|r| self.projects.get_mut(r))
    }
}
