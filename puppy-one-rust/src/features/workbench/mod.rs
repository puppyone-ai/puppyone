mod auxiliary_workbench_launcher;
mod drag;
mod header;
mod header_layout;
#[cfg(feature = "dev-capture")]
mod lab;
mod layout;
mod persistence;
use super::{desktop_agent::AgentChat, terminal::TerminalView};
use crate::platform::ui_state_store::{self, ResultEvent};
use crate::theme;
use crate::{
    agent::{
        connections::local_agent_inventory::{self as agents, Installation},
        runtime::agent_runtime_registry::Runtime,
    },
    theme::Theme,
    ui::{column, row},
    wake::Wake,
};
use drag::{DropIntent, Edge};
use gpui::{prelude::*, *};
use gpui_kit::component::menu::ContextMenuExt;
use layout::{Axis, Id, Layout, Node};
use persistence::{RetainedItem, StoredProject};
use std::{collections::HashMap, path::PathBuf, sync::mpsc};

enum Content {
    Launcher,
    Retained(RetainedItem),
    Chat(Entity<AgentChat>),
    /// A PTY, its tab title and the CLI it launched (`None` for the shell).
    Terminal(Entity<TerminalView>, String, Option<Runtime>),
}
impl Content {
    fn busy(&self, cx: &App) -> bool {
        match self {
            Self::Chat(e) => e.read(cx).busy(),
            Self::Terminal(e, ..) => e.read(cx).running,
            _ => false,
        }
    }
    fn title(&self, cx: &App) -> String {
        match self {
            Self::Launcher => crate::localization::t("workspace.workbench.newTab").into(),
            Self::Retained(item) => item.title(),
            Self::Chat(e) => e.read(cx).session.snapshot().title.clone(),
            Self::Terminal(_, name, _) => name.clone(),
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
    dark: bool,
}
impl Render for DragTab {
    /// `.desktop-terminal-tab-move-preview`: a quiet pill under the pointer.
    /// Its fill is `color-mix(var(--po-surface) 94%)`, and `--po-surface` is
    /// not a theme token, so the product paints only border and text; the
    /// popover shadow is dropped because GPUI would draw it under the
    /// transparent body instead of only outside it.
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let t = Theme::new(self.dark);
        let m = theme::ty();
        div()
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
/// Requests the workbench cannot fulfil itself (routed by the shell).
#[derive(Clone, Debug)]
pub enum WorkbenchEvent {
    OpenModelConnections,
}
impl EventEmitter<WorkbenchEvent> for Workbench {}
pub struct Workbench {
    projects: HashMap<PathBuf, Project>,
    root: Option<PathBuf>,
    installations: Vec<Installation>,
    /// Local agent ids hidden in Settings → Local Agents.
    hidden_agents: Vec<String>,
    /// Appearance → Loading animation preset.
    loading_animation: String,
    scanning: bool,
    /// When the running discovery began (`useDelayedDiscoveryFeedback`).
    scan_started: Option<std::time::Instant>,
    scan_rx: mpsc::Receiver<Vec<Installation>>,
    scan_tx: mpsc::Sender<Vec<Installation>>,
    pub dark: bool,
    chat_mode: bool,
    confirm: Option<Id>,
    bounds: HashMap<Id, Bounds<Pixels>>,
    drag_split: Option<(Id, Axis, Bounds<Pixels>)>,
    overflow: Option<Id>,
    wake: Wake,
    store_tx: mpsc::SyncSender<ResultEvent>,
    store_rx: mpsc::Receiver<ResultEvent>,
    header_focus: HashMap<(PathBuf, Id), FocusHandle>,
    /// Rendered tab window per group (`preferredVisibleSessionIds`).
    header_windows: HashMap<(PathBuf, Id), Vec<Id>>,
    /// Overflow trigger offset and hidden items from the last header layout.
    overflow_anchor: HashMap<Id, f32>,
    overflow_hidden: HashMap<Id, Vec<Id>>,
    /// The tab being dragged and where releasing it would put it.
    dragging: Option<Id>,
    drop_intent: Option<DropIntent>,
}
impl Workbench {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let (wake, rx) = Wake::channel();
        let (scan_tx, scan_rx) = mpsc::channel();
        let (store_tx, store_rx) = mpsc::sync_channel(64);
        let tx = scan_tx.clone();
        let scan_wake = wake.clone();
        std::thread::spawn(move || {
            let _ = tx.send(agents::discover());
            scan_wake.notify();
        });
        cx.spawn_in(window, async move |this, cx| {
            while rx.recv().await.is_ok() {
                if this
                    .update_in(cx, |s, _, cx| {
                        s.restore_results(cx);
                        if let Ok(found) = s.scan_rx.try_recv() {
                            s.installations = found;
                            s.scanning = false;
                            cx.notify();
                        }
                    })
                    .is_err()
                {
                    break;
                }
            }
        })
        .detach();
        Self {
            wake,
            store_tx,
            store_rx,
            projects: HashMap::new(),
            root: None,
            installations: vec![],
            hidden_agents: vec![],
            loading_animation: "ikun".into(),
            scanning: true,
            scan_started: Some(std::time::Instant::now()),
            scan_rx,
            scan_tx,
            dark: true,
            chat_mode: true,
            confirm: None,
            bounds: HashMap::new(),
            drag_split: None,
            overflow: None,
            header_focus: HashMap::new(),
            header_windows: HashMap::new(),
            overflow_anchor: HashMap::new(),
            overflow_hidden: HashMap::new(),
            dragging: None,
            drop_intent: None,
        }
    }
    #[cfg(feature = "dev-capture")]
    pub(crate) fn visual_fixture(
        &mut self,
        populated: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let root = PathBuf::from("/visual-reference-only");
        let mut project = Project::default();
        let id = project.layout.add(0);
        let view = cx.new(|cx| AgentChat::visual_fixture(populated, window, cx));
        project.content.insert(id, Content::Chat(view));
        self.projects.insert(root.clone(), project);
        self.root = Some(root);
        cx.notify();
    }
    pub fn set_preferences(
        &mut self,
        hidden: Vec<String>,
        loading_animation: String,
        cx: &mut Context<Self>,
    ) {
        if self.hidden_agents != hidden || self.loading_animation != loading_animation {
            self.hidden_agents = hidden;
            self.loading_animation = loading_animation;
            cx.notify();
        }
    }
    /// Installations offered by launchers: detected agents the user has not
    /// hidden, then the bundled Built-in Agent (never hidden).
    fn visible_installations(&self) -> Vec<Installation> {
        self.installations
            .iter()
            .filter(|i| i.bundled() || !self.hidden_agents.iter().any(|h| h == i.id))
            .cloned()
            .collect()
    }
    /// `discovery.refresh`: rescan local agent installations.
    fn rescan(&mut self, cx: &mut Context<Self>) {
        if self.scanning {
            return;
        }
        self.scanning = true;
        self.scan_started = Some(std::time::Instant::now());
        let tx = self.scan_tx.clone();
        let wake = self.wake.clone();
        std::thread::spawn(move || {
            let _ = tx.send(agents::discover());
            wake.notify();
        });
        cx.notify();
    }
    pub fn set_workspace(&mut self, root: PathBuf, cx: &mut Context<Self>) {
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
                            Ok(Some(value)) => match serde_json::from_value::<StoredProject>(value)
                            {
                                Ok(stored) if stored.validate() => {
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
                            Content::Chat(view) => {
                                let view = view.read(cx);
                                RetainedItem::Chat {
                                    runtime: view.runtime(),
                                    thread: (!view.session.snapshot().messages.is_empty())
                                        .then(|| view.session.snapshot().thread.clone())
                                        .flatten(),
                                    title: view.session.snapshot().title.clone(),
                                }
                            }
                            Content::Terminal(_, title, runtime) => RetainedItem::Terminal {
                                title: title.clone(),
                                runtime: *runtime,
                            },
                        },
                    )
                })
                .collect();
            let stored = StoredProject {
                version: 1,
                layout: project.layout.clone(),
                items,
            };
            if let Ok(value) = serde_json::to_value(stored) {
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
    fn reopen(
        &mut self,
        group: Id,
        tab: Id,
        item: RetainedItem,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let root = self.root.clone().unwrap();
        let content = match item {
            RetainedItem::Chat {
                runtime, thread, ..
            } => {
                let Some(installation) = self
                    .installations
                    .iter()
                    .find(|i| i.runtime == runtime)
                    .cloned()
                else {
                    if let Some(p) = self.project_mut() {
                        p.storage_error =
                            Some(crate::localization::t("native.agent.uninstalled").into());
                    }
                    cx.notify();
                    return;
                };
                let view = cx.new(|cx| {
                    let mut view = AgentChat::new(installation, root, thread.is_some(), window, cx);
                    if let Some(id) = thread {
                        view.resume_when_ready(id);
                    }
                    view
                });
                cx.observe(&view, |_, _, cx| cx.notify()).detach();
                cx.subscribe(
                    &view,
                    |_, _, event: &super::desktop_agent::AgentChatEvent, cx| match event {
                        super::desktop_agent::AgentChatEvent::OpenModelConnections => {
                            cx.emit(WorkbenchEvent::OpenModelConnections)
                        }
                    },
                )
                .detach();
                Content::Chat(view)
            }
            RetainedItem::Terminal { .. } => {
                let view = cx.new(|cx| TerminalView::new(root, None, window, cx));
                cx.observe(&view, |_, _, cx| cx.notify()).detach();
                Content::Terminal(view, crate::localization::t("terminal.title").into(), None)
            }
            RetainedItem::Launcher => Content::Launcher,
        };
        if let Some(p) = self.project_mut() {
            p.content.insert(tab, content);
            p.layout.activate(group, tab);
        }
        cx.notify();
    }
    pub fn reload_agent_configuration(&mut self, cx: &mut Context<Self>) {
        for project in self.projects.values() {
            for content in project.content.values() {
                if let Content::Chat(view) = content {
                    view.update(cx, |s, cx| {
                        s.session.reload_configuration();
                        cx.notify();
                    });
                }
            }
        }
    }
    pub fn has_running(&self, cx: &App) -> bool {
        self.projects
            .values()
            .any(|p| p.content.values().any(|c| c.busy(cx)))
    }
    pub fn shutdown(&mut self, cx: &mut Context<Self>) {
        self.persist(cx);
        self.projects.clear();
        self.root = None;
        cx.notify();
    }
    fn project(&self) -> Option<&Project> {
        self.root.as_ref().and_then(|r| self.projects.get(r))
    }
    fn project_mut(&mut self) -> Option<&mut Project> {
        self.root.as_ref().and_then(|r| self.projects.get_mut(r))
    }
    fn add(&mut self, group: Id, cx: &mut Context<Self>) {
        if let Some(p) = self.project_mut() {
            let id = p.layout.add(group);
            p.content.insert(id, Content::Launcher);
            p.layout.active_group = group;
        }
        cx.notify();
    }
    fn close(&mut self, id: Id, force: bool, cx: &mut Context<Self>) {
        if !force
            && self
                .project()
                .and_then(|p| p.content.get(&id))
                .is_some_and(|c| c.busy(cx))
        {
            self.confirm = Some(id);
            cx.notify();
            return;
        }
        if let Some(p) = self.project_mut() {
            p.layout.remove(id);
            p.content.remove(&id);
        }
        self.confirm = None;
        cx.notify();
    }
    fn launch(
        &mut self,
        group: Id,
        tab: Option<Id>,
        installation: Option<Installation>,
        history: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(root) = self.root.clone() else {
            return;
        };
        // Preparation belongs to the exact launcher; a stale click cannot replace an existing session.
        if let Some(tab) = tab
            && !matches!(
                self.project().and_then(|p| p.content.get(&tab)),
                Some(Content::Launcher)
            )
        {
            return;
        }
        let content =
            if let Some(installation) = installation.clone().filter(|i| i.chat && self.chat_mode) {
                let view = cx.new(|cx| AgentChat::new(installation, root, history, window, cx));
                cx.observe(&view, |_, _, cx| cx.notify()).detach();
                cx.subscribe(
                    &view,
                    |_, _, event: &super::desktop_agent::AgentChatEvent, cx| match event {
                        super::desktop_agent::AgentChatEvent::OpenModelConnections => {
                            cx.emit(WorkbenchEvent::OpenModelConnections)
                        }
                    },
                )
                .detach();
                Content::Chat(view)
            } else {
                let label = installation
                    .as_ref()
                    .map(|i| i.label.clone())
                    .unwrap_or_else(|| crate::localization::t("terminal.title").into());
                let runtime = installation.as_ref().map(|i| i.runtime);
                let exe = installation.map(|i| i.executable);
                let view = cx.new(|cx| TerminalView::new(root, exe, window, cx));
                cx.observe(&view, |_, _, cx| cx.notify()).detach();
                Content::Terminal(view, label, runtime)
            };
        if let Some(p) = self.project_mut() {
            let id = tab.unwrap_or_else(|| p.layout.add(group));
            p.content.insert(id, content);
            p.layout.activate(group, id);
        }
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
        let t = Theme::new(self.dark);
        let g = self.project().unwrap().layout.groups[&id].clone();
        let width = self
            .bounds
            .get(&id)
            .map(|b| f32::from(b.size.width))
            .unwrap_or(360.);
        let header = self.render_header(id, width, cx);
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
                column()
                    .p(px(20.))
                    .gap(px(12.))
                    .child(title)
                    .child(
                        div()
                            .text_color(t.muted)
                            .child(crate::localization::t("native.agent.retainedDetail")),
                    )
                    .child(
                        row().child(
                            crate::ui::action_button(
                                ("resume-retained", tab),
                                crate::localization::t(
                                    if matches!(item, RetainedItem::Terminal { .. }) {
                                        "terminal.launcher.shell.action"
                                    } else {
                                        "agent.readiness.reconnect"
                                    },
                                ),
                                Some("rotate-ccw"),
                                crate::ui::Tone::Primary,
                                false,
                                t,
                            )
                            .on_click(cx.listener(
                                move |s, _, w, cx| s.reopen(id, tab, item.clone(), w, cx),
                            )),
                        ),
                    )
                    .into_any_element()
            }
            Some(Content::Chat(view)) => {
                let view = view.clone();
                view.update(cx, |s, _| s.dark = self.dark);
                div().size_full().child(view).into_any_element()
            }
            Some(Content::Terminal(view, ..)) => {
                let view = view.clone();
                view.update(cx, |s, _| s.dark = self.dark);
                div().size_full().child(view).into_any_element()
            }
            _ => self.launcher(id, g.active, width, cx).into_any_element(),
        };
        let mut group = column()
            .id(("group", id))
            .size_full()
            .min_w_0()
            .min_h_0()
            .relative()
            .overflow_hidden()
            .bg(t.auxiliary())
            .child(header);
        if let Some(menu) = self.render_overflow_menu(id, width, cx) {
            group = group.child(menu);
        }
        if let Some(tab) = self.confirm.filter(|tab| g.tabs.contains(tab)) {
            group = group.child(
                column()
                    .p(px(12.))
                    .gap(px(8.))
                    .bg(t.overlay)
                    .child(crate::localization::t("native.workbench.stopTitle"))
                    .child(
                        row()
                            .gap(px(6.))
                            .child(
                                crate::ui::action_button(
                                    ("confirm-close", id),
                                    crate::localization::t("native.workbench.stopConfirm"),
                                    None,
                                    crate::ui::Tone::Danger,
                                    false,
                                    t,
                                )
                                .on_click(cx.listener(move |s, _, _, cx| s.close(tab, true, cx))),
                            )
                            .child(
                                crate::ui::action_button(
                                    ("cancel-close", id),
                                    crate::localization::t("agent.closeDialog.keepOpen"),
                                    None,
                                    crate::ui::Tone::Default,
                                    false,
                                    t,
                                )
                                .on_click(cx.listener(
                                    |s, _, _, cx| {
                                        s.confirm = None;
                                        cx.notify();
                                    },
                                )),
                            ),
                    ),
            );
        }
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
                let t = Theme::new(self.dark);
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
                let hover = theme::mix(t.focus, t.divider, 0.55);
                let group = SharedString::from(format!("workbench-split-{id}"));
                // `.desktop-terminal-splitter`: a 1px painter with an 8px hit
                // lane centred on it, above both panes.
                let painter = div()
                    .flex_shrink_0()
                    .when(horizontal, |d| d.w(px(layout::DIVIDER)).h_full())
                    .when(!horizontal, |d| d.h(px(layout::DIVIDER)).w_full())
                    .bg(if resizing { t.focus } else { t.divider })
                    .when(resizing, |d| {
                        d.shadow(vec![BoxShadow {
                            inset: false,
                            color: theme::alpha(t.focus, 0.24).into(),
                            offset: point(px(0.), px(0.)),
                            blur_radius: px(0.),
                            spread_radius: px(1.),
                        }])
                    })
                    .when(!resizing, |d| {
                        d.group_hover(group.clone(), move |s| s.bg(hover))
                    });
                let lane = div()
                    .id(("split-sash", id))
                    .group(group)
                    .absolute()
                    .occlude()
                    .when(horizontal, |d| {
                        let left = first_size.map(px).unwrap_or(px(0.));
                        d.top_0()
                            .bottom_0()
                            .left(left - px(3.5))
                            .w(px(8.))
                            .cursor(CursorStyle::ResizeLeftRight)
                    })
                    .when(!horizontal, |d| {
                        let top = first_size.map(px).unwrap_or(px(0.));
                        d.left_0()
                            .right_0()
                            .top(top - px(3.5))
                            .h(px(8.))
                            .cursor(CursorStyle::ResizeUpDown)
                    })
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(move |s, _, _, cx| {
                            if let Some(bounds) = s.bounds.get(&id) {
                                s.drag_split = Some((id, axis, *bounds));
                            }
                            cx.notify();
                        }),
                    );
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
            .map(|tab| match project.content.get(tab) {
                Some(Content::Terminal(..))
                | Some(Content::Retained(RetainedItem::Terminal { .. })) => (188., 196.),
                _ => (280., 260.),
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
        let source_min: (f32, f32) = match project.content.get(&source) {
            Some(Content::Terminal(..)) => (188., 196.),
            _ => (280., 260.),
        };
        let target_min = remaining
            .iter()
            .map(|tab| match project.content.get(tab) {
                Some(Content::Terminal(..)) => (188., 196.),
                _ => (280., 260.),
            })
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
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = Theme::new(self.dark);
        self.persist(cx);
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
            .child(
                column()
                    .size_full()
                    .when_some(error, |d, e| {
                        d.child(div().p(px(8.)).text_color(t.focus).child(e))
                    })
                    .child(div().flex_1().min_h_0().child(content)),
            )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    #[gpui::test]
    fn project_switch_retains_tabs_without_starting_a_process(cx: &mut TestAppContext) {
        // This integration fixture includes real discovery/storage workers.
        cx.executor().allow_parking();
        cx.update(gpui_kit::init);
        let (view, cx) = cx.add_window_view(Workbench::new);
        view.update(cx, |s, cx| {
            s.set_workspace(PathBuf::from("/project-a"), cx);
            s.add(0, cx);
            s.add(0, cx);
            let p = s.project().unwrap();
            assert_eq!(p.content.len(), 2);
            assert!(p.content.values().all(|c| matches!(c, Content::Launcher)));
            assert!(!s.has_running(cx));
            s.set_workspace(PathBuf::from("/project-b"), cx);
            assert!(s.project().unwrap().content.is_empty());
            s.set_workspace(PathBuf::from("/project-a"), cx);
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
    fn split_move_and_overflow_keep_the_same_content_instance(cx: &mut TestAppContext) {
        // This integration fixture includes real discovery/storage workers.
        cx.executor().allow_parking();
        cx.update(gpui_kit::init);
        let (view, cx) = cx.add_window_view(Workbench::new);
        view.update(cx, |s, cx| {
            s.set_workspace(PathBuf::from("/project"), cx);
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
