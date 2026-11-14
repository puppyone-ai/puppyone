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
    label: String,
    retry: CreationRetry,
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
    /// The project at `root` is shown (a local folder, or a hosted
    /// Project's Agent location).
    pub fn show(&mut self, root: PathBuf, cx: &mut Context<Self>) {
        self.attach(root, cx);
    }
    /// The shown project.
    pub fn root(&self) -> Option<&PathBuf> {
        self.root.as_ref()
    }
    /// Whether the shown project is still restoring its saved tabs.
    #[cfg(feature = "dev-capture")]
    pub fn loading(&self) -> bool {
        self.project().is_none_or(|p| p.loading)
    }
    /// The shown project's active group.
    #[cfg(feature = "dev-capture")]
    pub fn active_group(&self) -> Id {
        self.project().map_or(0, |p| p.layout.active_group)
    }
    /// Whether `tab` of `root` still shows a launcher (a creation that
    /// finishes later only replaces the launcher it started from).
    pub fn is_launcher(&self, root: &std::path::Path, tab: Id) -> bool {
        self.root.as_deref() == Some(root)
            && matches!(
                self.project().and_then(|p| p.content.get(&tab)),
                Some(Content::Launcher)
            )
    }
    /// The group showing `tab`.
    pub fn group_of(&self, tab: Id) -> Option<Id> {
        self.project()?
            .layout
            .groups
            .iter()
            .find(|(_, g)| g.tabs.contains(&tab))
            .map(|(group, _)| *group)
    }
    /// A new launcher tab in `group` (`createLauncher`).
    pub fn new_launcher_tab(&mut self, group: Id, cx: &mut Context<Self>) -> Option<Id> {
        let p = self.project_mut()?;
        let id = p.layout.add(group);
        p.content.insert(id, Content::Launcher);
        cx.notify();
        Some(id)
    }
    /// `item` fills the launcher `tab` (or a new tab of `group`), which
    /// becomes active.
    pub fn place(
        &mut self,
        group: Id,
        tab: Option<Id>,
        item: Rc<dyn WorkbenchItem>,
        cx: &mut Context<Self>,
    ) -> Option<Id> {
        let content = self.content(item, cx);
        let p = self.project_mut()?;
        let id = tab.unwrap_or_else(|| p.layout.add(group));
        p.content.insert(id, content);
        p.layout.activate(group, id);
        cx.notify();
        Some(id)
    }
    /// `recordCreationFailure`: `tab` could not become `label`; `retry`
    /// tries again.
    pub fn fail_creation(
        &mut self,
        tab: Id,
        label: String,
        retry: CreationRetry,
        cx: &mut Context<Self>,
    ) {
        self.creation_failure = Some(CreationFailure { tab, label, retry });
        cx.notify();
    }
    /// A saved tab of `item` in the shown project (tests).
    #[cfg(test)]
    pub fn lab_retained(&mut self, item: RetainedItem, cx: &mut Context<Self>) {
        if let Some(p) = self.project_mut() {
            p.loading = false;
            let id = p.layout.add(0);
            p.content.insert(id, Content::Retained(item));
        }
        cx.notify();
    }
    /// The shown project's tab count (tests).
    #[cfg(test)]
    pub fn tab_count(&self) -> usize {
        self.project().map_or(0, |p| p.content.len())
    }
    /// The tab whose creation failure is reported.
    #[cfg(test)]
    pub fn creation_failure_tab(&self) -> Option<Id> {
        self.creation_failure.as_ref().map(|f| f.tab)
    }
    /// A new creation replaces the reported failure.
    pub fn clear_creation_failure(&mut self, cx: &mut Context<Self>) {
        if self.creation_failure.take().is_some() {
            cx.notify();
        }
    }
    /// The resources the shown project's `kind` items have open
    /// (`excludedHistoryResourceIds`).
    pub fn open_resources(&self, kind: ItemKind, cx: &App) -> Vec<String> {
        self.project()
            .map(|p| {
                p.content
                    .values()
                    .filter_map(Content::item)
                    .filter(|item| item.kind() == kind)
                    .filter_map(|item| item.snapshot(cx).resource_id)
                    .collect()
            })
            .unwrap_or_default()
    }
    fn attach(&mut self, root: PathBuf, cx: &mut Context<Self>) {
        if !self.projects.contains_key(&root) {
            self.projects.insert(
                root.clone(),
                Project {
                    loading: true,
                    ..Default::default()
                },
            );
            ui_state_store::load(root.clone(), self.store_tx.clone(), self.wake.clone());
        }
        self.root = Some(root);
        self.confirm = None;
        self.bounds.clear();
        self.overflow = None;
        cx.notify();
    }
    fn restore_results(&mut self, cx: &mut Context<Self>) {
        while let Ok(event) = self.store_rx.try_recv() {
            match event {
                ResultEvent::Loaded(root, result) => {
                    if let Some(project) = self.projects.get_mut(&root) {
                        project.loading = false;
                        match result {
                            Ok(Some(saved)) => match StoredProject::read(saved) {
                                Some(stored) => {
                                    project.layout = stored.layout;
                                    project.content = stored
                                        .items
                                        .into_iter()
                                        .map(|(id, item)| {
                                            (
                                                id,
                                                if matches!(item, RetainedItem::Launcher) {
                                                    Content::Launcher
                                                } else {
                                                    Content::Retained(item)
                                                },
                                            )
                                        })
                                        .collect();
                                }
                                _ => {
                                    project.storage_error = Some(
                                        crate::localization::t("native.workbench.invalidState")
                                            .into(),
                                    )
                                }
                            },
                            Ok(None) => {}
                            Err(e) => project.storage_error = Some(e),
                        }
                    }
                }
                ResultEvent::Saved(root, result) => {
                    if let Some(project) = self.projects.get_mut(&root)
                        && let Err(e) = result
                    {
                        project.storage_error = Some(e);
                    }
                }
            }
            cx.notify();
        }
    }
    fn persist(&mut self, cx: &App) {
        for (root, project) in &mut self.projects {
            if project.loading {
                continue;
            }
            let items = project
                .content
                .iter()
                .map(|(id, content)| {
                    (
                        *id,
                        match content {
                            Content::Launcher => RetainedItem::Launcher,
                            Content::Retained(item) => item.clone(),
                            Content::Item { item, .. } => item.retained(cx),
                        },
                    )
                })
                .collect();
            let stored = StoredProject {
                version: 1,
                layout: project.layout.clone(),
                items,
            };
            if let Some(value) = stored.to_saved() {
                let hash = blake3::hash(value.to_string().as_bytes());
                if project.saved != Some(hash)
                    && ui_state_store::save(
                        root.clone(),
                        value,
                        self.store_tx.clone(),
                        self.wake.clone(),
                    )
                {
                    project.saved = Some(hash);
                }
            }
        }
    }
    /// "Reconnect" on a saved tab: the host's contribution reopens it.
    fn reopen(
        &mut self,
        group: Id,
        tab: Id,
        item: RetainedItem,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let (Some(root), Some(host)) = (self.root.clone(), self.host.clone()) else {
            return;
        };
        let content = match item {
            RetainedItem::Launcher => Content::Launcher,
            item => match host.reopen(&root, tab, &item, window, cx) {
                Ok(item) => self.content(item, cx),
                Err(error) => {
                    if let Some(p) = self.project_mut() {
                        p.storage_error = Some(error);
                    }
                    cx.notify();
                    return;
                }
            },
        };
        if let Some(p) = self.project_mut() {
            p.content.insert(tab, content);
            p.layout.activate(group, tab);
        }
        cx.notify();
    }
    pub fn has_running(&self, cx: &App) -> bool {
        self.projects
            .values()
            .any(|p| p.content.values().any(|c| c.busy(cx)))
    }
    pub fn shutdown(&mut self, cx: &mut Context<Self>) {
        self.persist(cx);
        self.projects.clear();
        if let Some(host) = self.host.clone() {
            host.shutdown(cx);
        }
        self.root = None;
        cx.notify();
    }
    fn project(&self) -> Option<&Project> {
        self.root.as_ref().and_then(|r| self.projects.get(r))
    }
    fn project_mut(&mut self) -> Option<&mut Project> {
        self.root.as_ref().and_then(|r| self.projects.get_mut(r))
    }
    /// `ProjectWorkbenchStore.canCreate`: a contribution's `maximumItems`.
    pub fn can_create(&self, kind: ItemKind) -> bool {
        self.project().is_none_or(|p| {
            p.content
                .values()
                .filter(|c| c.kind() == Some(kind))
                .count()
                < kind.maximum_items()
        })
    }
    fn add(&mut self, group: Id, cx: &mut Context<Self>) {
        if let Some(p) = self.project_mut() {
            let id = p.layout.add(group);
            p.content.insert(id, Content::Launcher);
            p.layout.active_group = group;
        }
        cx.notify();
    }
    /// `close.decide`, then `close.commit`: a busy item asks first, a
    /// blocked one only keeps its tab.
    fn close(&mut self, id: Id, force: bool, cx: &mut Context<Self>) {
        if force && self.close_blocked {
            return;
        }
        let Some(root) = self.root.clone() else {
            return;
        };
        let item = self
            .project()
            .and_then(|p| p.content.get(&id))
            .and_then(|c| match c {
                Content::Item { item, .. } => Some(item.clone()),
                _ => None,
            });
        let Some(item) = item else {
            self.remove_tab(&root, id, cx);
            return;
        };
        match item.close_decision(cx) {
            CloseDecision::Blocked => {
                self.close_blocked = true;
                self.request_close_confirmation(id, cx);
                return;
            }
            CloseDecision::Confirm if !force => {
                self.request_close_confirmation(id, cx);
                return;
            }
            _ => {}
        }
        let Some(release) = item.commit_close() else {
            self.remove_tab(&root, id, cx);
            return;
        };
        self.confirm = None;
        if !self.closing.insert(id) {
            return;
        }
        // The tab closes once its item is released; a refusal presents the
        // latest decision again.
        cx.spawn(async move |this, cx| {
            let released = release.await;
            this.update(cx, |s, cx| {
                s.closing.remove(&id);
                if released {
                    s.remove_tab(&root, id, cx);
                } else if s.root.as_ref() == Some(&root)
                    && s.project()
                        .and_then(|p| p.content.get(&id))
                        .is_some_and(|c| c.busy(cx))
                {
                    s.request_close_confirmation(id, cx);
                }
            })
            .ok();
        })
        .detach();
    }
    /// `removeItem`: the tab leaves `root`'s layout.
    fn remove_tab(&mut self, root: &std::path::Path, id: Id, cx: &mut Context<Self>) {
        if let Some(p) = self.projects.get_mut(root) {
            p.layout.remove(id);
            p.content.remove(&id);
        }
        if let Some(host) = self.host.clone() {
            cx.defer(move |cx| host.tab_removed(id, cx));
        }
        // A failure reported for a closed tab has nothing left to retry.
        if self.creation_failure.as_ref().is_some_and(|f| f.tab == id) {
            self.creation_failure = None;
        }
        if self.confirm == Some(id) {
            self.confirm = None;
        }
        self.close_blocked = false;
        cx.notify();
    }
    fn split(
        &mut self,
        group: Id,
        axis: Axis,
        tab: Option<Id>,
        after: bool,
        cx: &mut Context<Self>,
    ) {
        if let Some(p) = self.project_mut() {
            p.layout.split(group, axis, after, tab);
        }
        cx.notify();
    }
    fn group(&mut self, id: Id, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.palette();
        let g = self.project().unwrap().layout.groups[&id].clone();
        let width = self
            .bounds
            .get(&id)
            .map(|b| f32::from(b.size.width))
            .unwrap_or(360.);
        // `AuxiliaryWorkbenchPanel`: with no items at all the launcher fills
        // the panel and there is no tab header.
        let empty = self
            .project()
            .unwrap()
            .layout
            .groups
            .values()
            .all(|g| g.tabs.is_empty());
        let header = (!empty).then(|| self.render_header(id, width, cx));
        let split_preview = match self.drop_intent {
            Some(DropIntent::Split {
                group,
                edge,
                allowed,
            }) if group == id => Some((edge, allowed)),
            _ => None,
        };
        let content = match g
            .active
            .and_then(|tab| self.project().unwrap().content.get(&tab))
        {
            Some(Content::Retained(item)) => {
                let item = item.clone();
                let tab = g.active.unwrap();
                let title = item.title();
                v_flex()
                    .p(px(20.))
                    .gap(px(12.))
                    .child(title)
                    .child(
                        div()
                            .text_color(t.muted)
                            .child(crate::localization::t("native.agent.retainedDetail")),
                    )
                    .child(
                        h_flex().child(
                            Button::new(("resume-retained", tab))
                                .variant(ButtonVariant::OutlinePrimary)
                                .icon("rotate-ccw")
                                .label(crate::localization::t(
                                    if matches!(item, RetainedItem::Terminal { .. }) {
                                        "terminal.launcher.shell.action"
                                    } else {
                                        "agent.readiness.reconnect"
                                    },
                                ))
                                .on_click(cx.listener(move |s, _, w, cx| {
                                    s.reopen(id, tab, item.clone(), w, cx)
                                })),
                        ),
                    )
                    .into_any_element()
            }
            Some(Content::Item { item, .. }) => {
                div().size_full().child(item.view()).into_any_element()
            }
            _ => match self.host.clone() {
                Some(host) => {
                    let context = LauncherContext {
                        group: id,
                        tab: g.active,
                        width,
                        can_chat: self.can_create(ItemKind::Chat),
                        can_terminal: self.can_create(ItemKind::Terminal),
                    };
                    host.launcher(context, cx)
                }
                None => div().into_any_element(),
            },
        };
        let group = v_flex()
            .id(("group", id))
            .size_full()
            .min_w_0()
            .min_h_0()
            .relative()
            .overflow_hidden()
            .bg(t.auxiliary())
            .children(header);
        let entity = cx.entity();
        group
            .child(
                div()
                    .id(("group-content", id))
                    .relative()
                    .flex_1()
                    .min_h_0()
                    .min_w_0()
                    .overflow_hidden()
                    .child(content)
                    .child(
                        canvas(
                            move |bounds, _, cx| {
                                entity.update(cx, |s, cx| {
                                    // Header density follows the measured group width.
                                    if s.bounds.insert(id, bounds) != Some(bounds) {
                                        cx.notify();
                                    }
                                });
                            },
                            |_, _, _, _| {},
                        )
                        .absolute()
                        .size_full(),
                    )
                    .when_some(split_preview, |d, (edge, allowed)| {
                        // `.desktop-terminal-drop-preview`: the half the tab would take.
                        // Refused drops stripe 10% / 18% danger at 135deg, 5px each.
                        let preview = div()
                            .absolute()
                            .bg(if allowed { theme::alpha(t.accent, 0.14) } else { theme::alpha(t.danger, 0.10) })
                            .when(!allowed, |d| {
                                d.child(
                                    div()
                                        .size_full()
                                        .bg(pattern_slash(theme::alpha(t.danger, 0.089), 5., 5.)),
                                )
                            });
                        d.child(match edge {
                            Edge::Left => preview.top_0().bottom_0().left_0().w(relative(0.5)),
                            Edge::Right => preview.top_0().bottom_0().right_0().w(relative(0.5)),
                            Edge::Top => preview.left_0().right_0().top_0().h(relative(0.5)),
                            Edge::Bottom => preview.left_0().right_0().bottom_0().h(relative(0.5)),
                        })
                    })
                    .on_drag_move::<DragTab>(cx.listener(move |s, e: &DragMoveEvent<DragTab>, _, cx| {
                        let drag = e.drag(cx).clone();
                        if s.root.as_ref() != Some(&drag.root) {
                            return;
                        }
                        let b = e.bounds;
                        let p = e.event.position;
                        let here = matches!(s.drop_intent, Some(DropIntent::Split { group, .. }) if group == id);
                        if !b.contains(&p) {
                            if here {
                                s.drop_intent = None;
                                cx.notify();
                            }
                            return;
                        }
                        let edge = drag::closest_edge(
                            f32::from(b.origin.x),
                            f32::from(b.origin.y),
                            f32::from(b.size.width),
                            f32::from(b.size.height),
                            f32::from(p.x),
                            f32::from(p.y),
                        );
                        let allowed = s.can_split(drag.tab, id, edge.split().0, b);
                        let next = Some(DropIntent::Split { group: id, edge, allowed });
                        s.dragging = Some(drag.tab);
                        if s.drop_intent != next {
                            s.drop_intent = next;
                            cx.notify();
                        }
                    }))
                    .on_drop(cx.listener(move |s, drag: &DragTab, _, cx| {
                        if s.root.as_ref() != Some(&drag.root) {
                            return;
                        }
                        if let Some(DropIntent::Split { group, edge, allowed: true }) = s.drop_intent
                            && group == id
                        {
                            let (axis, after) = edge.split();
                            s.split(id, axis, Some(drag.tab), after, cx);
                        }
                        s.drop_intent = None;
                        s.dragging = None;
                        cx.notify();
                    })),
            )
            .into_any_element()
    }
    fn node(&mut self, node: &Node, cx: &mut Context<Self>) -> AnyElement {
        match node {
            Node::Group(id) => self.group(*id, cx),
            Node::Split {
                id,
                axis,
                ratio,
                first,
                second,
            } => {
                let id = *id;
                let axis = *axis;
                let t = cx.palette();
                let a = self.node(first, cx);
                let b = self.node(second, cx);
                let entity = cx.entity();
                let horizontal = axis == Axis::Horizontal;
                // `grid-template-*: (100% - 1px) × ratio | 1px | rest`.
                let total = self.bounds.get(&id).map(|b| {
                    f32::from(if horizontal {
                        b.size.width
                    } else {
                        b.size.height
                    })
                });
                let first_size = total.map(|total| (total - layout::DIVIDER).max(0.) * ratio);
                let resizing = self.drag_split.map(|d| d.0) == Some(id);
                // `.desktop-terminal-splitter`: the 1px painter in the flow and
                // an 8px hit lane centred on it, above both panes, whose stroke
                // paints the hover and drag states over the painter.
                let painter = div()
                    .flex_shrink_0()
                    .when(horizontal, |d| d.w(px(layout::DIVIDER)).h_full())
                    .when(!horizontal, |d| d.h(px(layout::DIVIDER)).w_full())
                    .bg(t.divider);
                let hit = theme::metric::PANE_SASH;
                let offset = (hit - layout::DIVIDER) / 2.;
                let start = first_size.map(px).unwrap_or(px(0.)) - px(offset);
                let lane = ResizeHandle::new(
                    ("split-sash", id),
                    if horizontal {
                        gpui::Axis::Horizontal
                    } else {
                        gpui::Axis::Vertical
                    },
                )
                .stroke_at(offset)
                .resizing(resizing)
                .on_drag_start(cx.listener(move |s, _, _, cx| {
                    if let Some(bounds) = s.bounds.get(&id) {
                        s.drag_split = Some((id, axis, *bounds));
                    }
                    cx.notify();
                }))
                .absolute()
                .occlude()
                .when(horizontal, |d| d.top_0().bottom_0().left(start).w(px(hit)))
                .when(!horizontal, |d| d.left_0().right_0().top(start).h(px(hit)));
                div()
                    .relative()
                    .flex()
                    .when(!horizontal, |d| d.flex_col())
                    .size_full()
                    .min_h_0()
                    .min_w_0()
                    .child(
                        div()
                            .min_w_0()
                            .min_h_0()
                            .flex_shrink_0()
                            .overflow_hidden()
                            .map(|d| match (horizontal, first_size) {
                                (true, Some(size)) => d.w(px(size)).h_full(),
                                (true, None) => d.w(relative(*ratio)).h_full(),
                                (false, Some(size)) => d.h(px(size)).w_full(),
                                (false, None) => d.h(relative(*ratio)).w_full(),
                            })
                            .child(a),
                    )
                    .child(painter)
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .min_h_0()
                            .overflow_hidden()
                            .child(b),
                    )
                    .when(first_size.is_some(), |d| d.child(lane))
                    .child(
                        canvas(
                            move |bounds, _, cx| {
                                entity.update(cx, |s, cx| {
                                    if s.bounds.insert(id, bounds) != Some(bounds) {
                                        cx.notify();
                                    }
                                });
                            },
                            |_, _, _, _| {},
                        )
                        .absolute()
                        .size_full(),
                    )
                    .into_any_element()
            }
        }
    }
    /// `onMoveByKeyboard`: split `group`'s active tab to `edge` if `canDrop`.
    fn move_active_to_edge(&mut self, group: Id, edge: Edge, cx: &mut Context<Self>) {
        let Some(tab) = self
            .project()
            .and_then(|p| p.layout.groups.get(&group))
            .and_then(|g| g.active)
        else {
            return;
        };
        let Some(bounds) = self.bounds.get(&group).copied() else {
            return;
        };
        let (axis, after) = edge.split();
        if self.can_split(tab, group, axis, bounds) {
            self.split(group, axis, Some(tab), after, cx);
        }
    }
    /// `retryCreation`: the contribution tries the same creation again.
    fn retry_creation(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(failure) = self.creation_failure.take() else {
            return;
        };
        cx.notify();
        // The contribution reads the workbench: it retries after this update.
        let retry = failure.retry.clone();
        window.defer(cx, move |window, cx| retry(window, cx));
    }
    /// `AuxiliaryWorkbenchCreationFailure` in the panel's top notice stack.
    fn creation_notice(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        use crate::ui::components::{
            FloatingNotice, NoticeAction, NoticePlacement, NoticeStack, NoticeTone,
        };
        let failure = self.creation_failure.as_ref()?;
        let ty = theme::ty();
        let message = crate::localization::tf(
            "terminal.workbench.itemLoadFailed",
            &[("item", failure.label.clone().into())],
        );
        let entity = cx.entity();
        let retry = entity.clone();
        Some(
            // `.desktop-auxiliary-workbench-notice-stack`: under the tab strip,
            // 8px from both edges.
            NoticeStack::new(NoticePlacement::Top, 46., 8., 0.)
                .child(
                    FloatingNotice::new("workbench-creation-failure", message)
                        .tone(NoticeTone::Danger)
                        .text(ty.right.meta, ty.right.meta_line_height)
                        .action(NoticeAction::new(
                            "workbench-creation-retry",
                            crate::localization::t("common.action.retry"),
                            move |window, cx| {
                                retry.update(cx, |s, cx| s.retry_creation(window, cx))
                            },
                        ))
                        .dismiss_label(crate::localization::t("terminal.workbench.dismissError"))
                        .on_dismiss(move |_, cx| {
                            entity.update(cx, |s, cx| {
                                s.creation_failure = None;
                                cx.notify();
                            })
                        }),
                )
                .into_any_element(),
        )
    }
    fn end_drag(&mut self, cx: &mut Context<Self>) {
        if self.drag_split.is_some() || self.drop_intent.is_some() || self.dragging.is_some() {
            self.drag_split = None;
            self.drop_intent = None;
            self.dragging = None;
            cx.notify();
        }
    }
    /// Minimum size of a group: the largest of its items'
    /// (`AuxiliaryWorkbenchContribution.minimumSize`; chat 280×260, terminal
    /// `terminalLeafMinimumSize` 188×196).
    fn group_minimum(&self, group: Id) -> (f32, f32) {
        let Some(project) = self.project() else {
            return (280., 260.);
        };
        let tabs = project
            .layout
            .groups
            .get(&group)
            .map(|g| g.tabs.clone())
            .unwrap_or_default();
        tabs.iter()
            .map(|tab| {
                project
                    .content
                    .get(tab)
                    .map_or(ItemKind::Chat.minimum_size(), Content::minimum_size)
            })
            .fold(None, |acc: Option<(f32, f32)>, (w, h)| {
                Some(acc.map_or((w, h), |(aw, ah)| (aw.max(w), ah.max(h))))
            })
            .unwrap_or((280., 260.))
    }
    /// `canPlaceWorkbenchSplit` for dropping `source` on `target`'s `edge`.
    fn can_split(&self, source: Id, target: Id, axis: Axis, bounds: Bounds<Pixels>) -> bool {
        let Some(project) = self.project() else {
            return false;
        };
        let Some(source_group) = project
            .layout
            .groups
            .iter()
            .find(|(_, g)| g.tabs.contains(&source))
            .map(|(id, _)| *id)
        else {
            return false;
        };
        let remaining: Vec<Id> = project.layout.groups[&target]
            .tabs
            .iter()
            .copied()
            .filter(|t| *t != source)
            .collect();
        if remaining.is_empty() {
            return false;
        }
        if source_group != target && project.layout.groups[&source_group].tabs.len() == 1 {
            return true;
        }
        let minimum = |tab: &Id| {
            project
                .content
                .get(tab)
                .map_or(ItemKind::Chat.minimum_size(), Content::minimum_size)
        };
        let source_min = minimum(&source);
        let target_min = remaining
            .iter()
            .map(minimum)
            .fold((1f32, 1f32), |(w, h), (a, b)| (w.max(a), h.max(b)));
        let (width, height) = (f32::from(bounds.size.width), f32::from(bounds.size.height));
        match axis {
            Axis::Horizontal => {
                width >= source_min.0 + layout::DIVIDER + target_min.0
                    && height >= source_min.1.max(target_min.1)
            }
            Axis::Vertical => {
                height >= source_min.1 + layout::DIVIDER + target_min.1
                    && width >= source_min.0.max(target_min.0)
            }
        }
    }
}
impl Render for Workbench {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        crate::platform::watchdog::activity("workbench.render");
        let t = cx.palette();
        let close_dialog = self.render_close_dialog(window, cx);
        let loading = self.project().is_some_and(|p| p.loading);
        let error = self.project().and_then(|p| p.storage_error.clone());
        let tree = self.project().map(|p| p.layout.tree.clone());
        let content = if loading {
            div()
                .p(px(20.))
                .child(crate::localization::t("workspace.restoring.message"))
                .into_any_element()
        } else if let Some(tree) = tree {
            self.node(&tree, cx)
        } else {
            div()
                .p(px(24.))
                .text_color(t.muted)
                .child(crate::localization::t("agent.launcher.title"))
                .into_any_element()
        };
        let context_menu = self.render_context_menu(cx);
        div()
            .size_full()
            .bg(t.auxiliary())
            .text_color(t.text)
            .on_mouse_move(cx.listener(|s, e: &MouseMoveEvent, _, cx| {
                if let Some((id, axis, b)) = s.drag_split {
                    let horizontal = axis == Axis::Horizontal;
                    let total = f32::from(if horizontal {
                        b.size.width
                    } else {
                        b.size.height
                    });
                    let offset = f32::from(if horizontal {
                        e.position.x - b.origin.x
                    } else {
                        e.position.y - b.origin.y
                    });
                    let ratio = offset / (total - layout::DIVIDER).max(1.);
                    // `clampWorkbenchRatioToBounds` with both sides' minimum sizes.
                    let bounds = s.project().and_then(|p| {
                        let Node::Split { first, second, .. } = p.layout.find(id)? else {
                            return None;
                        };
                        let leaf = |group: Id| s.group_minimum(group);
                        Some(Layout::ratio_bounds(
                            axis,
                            total,
                            Layout::min_size(first, &leaf),
                            Layout::min_size(second, &leaf),
                        ))
                    });
                    let ratio = bounds.map_or(ratio, |(min, max)| ratio.clamp(min, max));
                    if let Some(p) = s.project_mut() {
                        p.layout.resize(id, ratio);
                    }
                    cx.notify();
                }
            }))
            .on_mouse_up(MouseButton::Left, cx.listener(|s, _, _, cx| s.end_drag(cx)))
            // A tab released over the sidebar or editor still ends the move.
            .on_mouse_up_out(MouseButton::Left, cx.listener(|s, _, _, cx| s.end_drag(cx)))
            .children(close_dialog)
            .children(context_menu)
            .child(
                v_flex()
                    .size_full()
                    .when_some(error, |d, e| {
                        d.child(div().p(px(8.)).text_color(t.focus).child(e))
                    })
                    .child(div().flex_1().min_h_0().child(content)),
            )
            .children(self.creation_notice(cx))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    /// `{ kind: "blocked" }` and "closing never stops": an unconfirmed
    /// submission keeps its tab; a confirmed running one closes unasked.
    #[gpui::test]
    fn a_hosted_chat_with_an_unconfirmed_submission_cannot_close(cx: &mut TestAppContext) {
        use crate::cloud::auth::Cancellation;
        use crate::cloud::auth::model::ApiRequest;
        use crate::features::cloud::{CloudAgentConversation, HostedChats, Hub};
        use crate::workspace::cloud::agent::Client;
        use crate::workspace::cloud::agent::Error;
        use crate::workspace::cloud::agent::Event;
        use crate::workspace::cloud::agent::Transport;
        use serde_json::{Value, json};
        use std::sync::{
            Arc, Mutex,
            atomic::{AtomicBool, Ordering},
        };
        #[derive(Default)]
        struct Script {
            accept: AtomicBool,
            paths: Mutex<Vec<String>>,
        }
        impl Transport for Script {
            fn request(&self, request: ApiRequest) -> Result<Value, Error> {
                self.paths.lock().unwrap().push(request.path.clone());
                let failure = |status, unknown| Error {
                    status,
                    unknown,
                    message: "scripted".into(),
                };
                if !self.accept.load(Ordering::SeqCst) {
                    return Err(failure(None, true));
                }
                if request.path.starts_with("/agents/requests/") {
                    return Err(failure(Some(404), false));
                }
                let id = request
                    .body
                    .map_or("req".into(), |b| b["request_id"].clone());
                Ok(
                    json!({"id": "run-1", "project_id": "project-a", "workbench_id": "wb-1",
                    "agent_id": "agent-1", "session_id": "session-1", "request_id": id,
                    "prompt": "hello", "state": "running", "sequence": 1}),
                )
            }
            fn events(&self, _: &str, _: u64, _: &Cancellation) -> Result<Vec<Event>, Error> {
                std::thread::sleep(std::time::Duration::from_millis(20));
                Ok(vec![])
            }
        }
        cx.executor().allow_parking();
        cx.update(gpui_kit::init);
        let script = Arc::new(Script::default());
        let dir = tempfile::tempdir().unwrap();
        let hub = Hub::new(
            Client::new(script.clone(), "project-a".into(), "wb-1".into()),
            "puppyone-cloud://test/blocked".into(),
            dir.path().to_path_buf(),
            Box::new(|| {}),
        );
        let (view, cx) = cx.add_window_view(Workbench::new);
        // The hosted contribution's chat, placed as its launcher would.
        let mut hosted = HostedChats::default();
        hosted.open_hub(hub);
        view.update_in(cx, |s, w, cx| {
            let root = PathBuf::from(format!("cloud-test-{}", uuid::Uuid::new_v4()));
            s.attach(root.clone(), cx);
            s.project_mut().unwrap().loading = false;
            let item = hosted.chat(&root, "tab:0", None, w, cx).unwrap();
            s.place(0, None, Rc::new(item), cx);
        });
        let (tab, chat) = view.read_with(cx, |s, _| {
            s.project()
                .unwrap()
                .content
                .iter()
                .find_map(|(id, c)| match c {
                    Content::Item { item, .. } => item
                        .view()
                        .downcast::<CloudAgentConversation>()
                        .ok()
                        .map(|chat| (*id, chat)),
                    _ => None,
                })
                .expect("a hosted chat")
        });
        let settle = |cx: &mut VisualTestContext, what: &str, ready: &dyn Fn(&App) -> bool| {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            while !cx.update(|_, cx| ready(cx)) {
                cx.run_until_parked();
                assert!(
                    std::time::Instant::now() < deadline,
                    "{what} did not settle"
                );
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
        };
        let hosted =
            |cx: &App, f: &dyn Fn(&crate::features::cloud::CloudAgentController) -> bool| {
                f(chat.read(cx).chat())
            };
        chat.update(cx, |c, _| c.chat().submit("hello".into()));
        settle(cx, "the lost receipt", &|cx| {
            hosted(cx, &|c| {
                let state = c.snapshot();
                state.error.is_some() && !state.submitting && !c.can_release()
            })
        });
        // The conversation draws its status, transcript and composer.
        cx.update(|w, cx| {
            let _ = w.draw(cx);
        });
        view.update(cx, |s, cx| {
            s.close(tab, false, cx);
            assert_eq!(s.confirm, Some(tab));
            assert!(s.close_copy(tab, cx).unwrap().is_blocked());
            // A forced close cannot get past the refusal.
            s.close(tab, true, cx);
            assert!(s.project().unwrap().content.contains_key(&tab));
            s.dismiss_close(cx);
        });
        // The retry confirms; the running tab now closes without asking.
        script.accept.store(true, Ordering::SeqCst);
        chat.update(cx, |c, _| c.chat().retry());
        settle(cx, "the confirmation", &|cx| {
            hosted(cx, &|c| c.can_release())
        });
        cx.update(|w, cx| {
            let _ = w.draw(cx);
        });
        view.update(cx, |s, cx| {
            s.close(tab, false, cx);
            assert_eq!(s.confirm, None);
            assert!(!s.project().unwrap().content.contains_key(&tab));
        });
        assert!(
            !script
                .paths
                .lock()
                .unwrap()
                .iter()
                .any(|p| p.ends_with("/stop"))
        );
    }
    #[gpui::test]
    fn project_switch_retains_tabs_without_starting_a_process(cx: &mut TestAppContext) {
        // This integration fixture includes real discovery/storage workers.
        cx.executor().allow_parking();
        cx.update(gpui_kit::init);
        let (view, cx) = cx.add_window_view(Workbench::new);
        view.update(cx, |s, cx| {
            s.show(PathBuf::from("/project-a"), cx);
            s.add(0, cx);
            s.add(0, cx);
            let p = s.project().unwrap();
            assert_eq!(p.content.len(), 2);
            assert!(p.content.values().all(|c| matches!(c, Content::Launcher)));
            assert!(!s.has_running(cx));
            s.show(PathBuf::from("/project-b"), cx);
            assert!(s.project().unwrap().content.is_empty());
            s.show(PathBuf::from("/project-a"), cx);
            assert_eq!(s.project().unwrap().content.len(), 2);
        });
        cx.update(|w, cx| {
            let _ = w.draw(cx);
        });
        view.update(cx, |s, cx| {
            let ids = s.project().unwrap().layout.groups[&0].tabs.clone();
            for id in ids {
                s.close(id, false, cx);
            }
            assert!(s.project().unwrap().content.is_empty());
            assert_eq!(s.project().unwrap().layout.groups[&0].active, None);
        });
        cx.update(|w, cx| {
            let _ = w.draw(cx);
        });
    }
    #[gpui::test]
    fn contributions_stop_at_their_maximum_items(cx: &mut TestAppContext) {
        cx.executor().allow_parking();
        cx.update(gpui_kit::init);
        let (view, cx) = cx.add_window_view(Workbench::new);
        view.update(cx, |s, cx| {
            s.show(PathBuf::from("/project"), cx);
            let p = s.project_mut().unwrap();
            for n in 0..32 {
                let id = p.layout.add(0);
                p.content.insert(
                    id,
                    Content::Retained(RetainedItem::Terminal {
                        title: format!("t{n}"),
                        runtime: None,
                    }),
                );
            }
            assert!(
                !s.can_create(ItemKind::Terminal),
                "32 terminals per project"
            );
            assert!(s.can_create(ItemKind::Chat));
            let p = s.project_mut().unwrap();
            for n in 0..8 {
                let id = p.layout.add(0);
                p.content.insert(
                    id,
                    Content::Retained(RetainedItem::Chat {
                        runtime: crate::agent::connections::legacy_runtime_registry::Runtime::Codex,
                        thread: None,
                        title: format!("c{n}"),
                        runtime_id: Some("codex".into()),
                    }),
                );
            }
            assert!(!s.can_create(ItemKind::Chat), "8 Agent Chats per project");
        });
    }
    #[gpui::test]
    fn keyboard_move_splits_only_when_both_sides_fit(cx: &mut TestAppContext) {
        cx.executor().allow_parking();
        cx.update(gpui_kit::init);
        let (view, cx) = cx.add_window_view(Workbench::new);
        view.update(cx, |s, cx| {
            s.show(PathBuf::from("/project"), cx);
            s.add(0, cx);
            s.add(0, cx);
            s.project_mut().unwrap().loading = false;
            // 420 wide: two 280px launchers cannot sit side by side.
            s.bounds.insert(
                0,
                Bounds::new(point(px(0.), px(38.)), size(px(420.), px(722.))),
            );
            s.move_active_to_edge(0, Edge::Right, cx);
            assert_eq!(s.project().unwrap().layout.groups.len(), 1);
            // 722 tall: 260 + 1 + 260 fits, so the active tab splits below.
            let active = s.project().unwrap().layout.groups[&0].active;
            s.move_active_to_edge(0, Edge::Bottom, cx);
            let layout = &s.project().unwrap().layout;
            assert_eq!(layout.groups.len(), 2);
            assert!(
                layout
                    .groups
                    .values()
                    .any(|g| g.tabs == active.into_iter().collect::<Vec<_>>())
            );
        });
    }
    #[gpui::test]
    fn split_move_and_overflow_keep_the_same_content_instance(cx: &mut TestAppContext) {
        // This integration fixture includes real discovery/storage workers.
        cx.executor().allow_parking();
        cx.update(gpui_kit::init);
        let (view, cx) = cx.add_window_view(Workbench::new);
        view.update(cx, |s, cx| {
            s.show(PathBuf::from("/project"), cx);
            for _ in 0..12 {
                s.add(0, cx);
            }
            let p = s.project_mut().unwrap();
            let tab = p.layout.groups[&0].tabs[4];
            let group = p.layout.split(0, Axis::Vertical, true, Some(tab));
            assert_eq!(p.content.len(), 12);
            assert_eq!(p.layout.groups[&group].active, Some(tab));
            p.layout.move_tab(tab, 0, 0);
            assert!(p.layout.remove_empty_group(group));
            p.layout.navigate(0, "end");
            assert_eq!(
                p.layout.groups[&0].active,
                p.layout.groups[&0].tabs.last().copied()
            );
        });
        cx.update(|w, cx| {
            let _ = w.draw(cx);
        });
    }
}
