mod auxiliary_workbench_launcher;
mod layout;
mod persistence;
use super::{desktop_agent::AgentChat, terminal::TerminalView};
use crate::platform::ui_state_store::{self, ResultEvent};
use crate::theme;
use crate::{
    agent::connections::local_agent_inventory::{self as agents, Installation},
    theme::Theme,
    ui::{column, icon, row},
    wake::Wake,
};
use gpui::{prelude::*, *};
use gpui_kit::component::menu::ContextMenuExt;
use layout::{Axis, Id, Layout, Node};
use persistence::{RetainedItem, StoredProject};
use std::{collections::HashMap, path::PathBuf, sync::mpsc};

enum Content {
    Launcher,
    Retained(RetainedItem),
    Chat(Entity<AgentChat>),
    Terminal(Entity<TerminalView>, String),
}
impl Content {
    fn busy(&self, cx: &App) -> bool {
        match self {
            Self::Chat(e) => e.read(cx).busy(),
            Self::Terminal(e, _) => e.read(cx).running,
            _ => false,
        }
    }
    fn title(&self, cx: &App) -> String {
        match self {
            Self::Launcher => crate::localization::t("workspace.workbench.newTab").into(),
            Self::Retained(item) => item.title(),
            Self::Chat(e) => e.read(cx).session.snapshot().title.clone(),
            Self::Terminal(_, name) => name.clone(),
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
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let t = Theme::new(self.dark);
        div()
            .p(px(8.))
            .rounded(px(5.))
            .bg(t.overlay)
            .text_color(t.text)
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
            scan_rx,
            scan_tx,
            dark: true,
            chat_mode: true,
            confirm: None,
            bounds: HashMap::new(),
            drag_split: None,
            overflow: None,
            header_focus: HashMap::new(),
        }
    }
    #[cfg(feature = "webview-smoke")]
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
                            Content::Terminal(_, title) => RetainedItem::Terminal {
                                title: title.clone(),
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
                Content::Terminal(view, crate::localization::t("terminal.title").into())
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
                let exe = installation.map(|i| i.executable);
                let view = cx.new(|cx| TerminalView::new(root, exe, window, cx));
                cx.observe(&view, |_, _, cx| cx.notify()).detach();
                Content::Terminal(view, label)
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
        if let Some(bounds) = self.bounds.get(&group) {
            let size = if axis == Axis::Horizontal {
                bounds.size.width
            } else {
                bounds.size.height
            };
            let min = if axis == Axis::Horizontal { 440. } else { 320. };
            if f32::from(size) < min {
                return;
            }
        }
        if let Some(p) = self.project_mut() {
            p.layout.split(group, axis, after, tab);
        }
        cx.notify();
    }
    fn group(&mut self, id: Id, cx: &mut Context<Self>) -> AnyElement {
        let t = Theme::new(self.dark);
        let focus = self
            .header_focus
            .entry((self.root.clone().unwrap(), id))
            .or_insert_with(|| cx.focus_handle())
            .clone();
        let project = self.project().unwrap();
        let g = project.layout.groups[&id].clone();
        let root = self.root.clone().unwrap();
        let width = self
            .bounds
            .get(&id)
            .map(|b| f32::from(b.size.width))
            .unwrap_or(360.);
        // `layoutWorkbenchSessionHeader`: full 144px tabs, else compact
        // inactive tabs (28px), else an overflow control.
        const GAP: f32 = 3.;
        const FULL: f32 = 144.;
        const MIN_FULL: f32 = 104.;
        const COMPACT: f32 = 28.;
        let available = (width - 12. - COMPACT - GAP).max(COMPACT);
        let count = g.tabs.len().max(1) as f32;
        let (mode_full, mode_compact) = (
            count * (MIN_FULL + GAP) <= available,
            FULL + (count - 1.) * (COMPACT + GAP) <= available,
        );
        let full_width = ((available / count) - GAP).clamp(MIN_FULL, FULL);
        let active_index = g
            .active
            .and_then(|a| g.tabs.iter().position(|i| *i == a))
            .unwrap_or(0);
        let capacity = if mode_full || mode_compact {
            g.tabs.len().max(1)
        } else {
            (((available - COMPACT - GAP - FULL) / (COMPACT + GAP))
                .floor()
                .max(0.) as usize
                + 1)
            .max(1)
        };
        let start = active_index.saturating_sub(capacity - 1);
        let visible = g
            .tabs
            .iter()
            .skip(start)
            .take(capacity)
            .copied()
            .collect::<Vec<_>>();
        let mut header = row()
            .track_focus(&focus)
            .on_key_down(cx.listener(move |s, e: &KeyDownEvent, _, cx| {
                if ["left", "right", "home", "end"].contains(&e.keystroke.key.as_str()) {
                    if let Some(p) = s.project_mut() {
                        p.layout.navigate(id, &e.keystroke.key);
                    }
                    cx.notify();
                    cx.stop_propagation();
                }
            }))
            .h(px(38.))
            .flex_shrink_0()
            .pt(px(4.))
            .pb(px(6.))
            .px(px(6.))
            .bg(t.auxiliary())
            .gap(px(GAP));
        for tab in &visible {
            let focus = focus.clone();
            let tab = *tab;
            let content = &project.content[&tab];
            let label = content.title(cx);
            let busy = content.busy(cx);
            let active = g.active == Some(tab);
            let compact = !active && !mode_full;
            let drag = DragTab {
                root: root.clone(),
                tab,
                title: label.clone(),
                dark: self.dark,
            };
            let fg = if active { t.text } else { t.muted };
            // `AuxiliaryWorkbenchStatus`: the item's own icon stays visible; a
            // running chat adds the pulsing 5px accent dot at its corner.
            let glyph: AnyElement = match content {
                Content::Chat(view) => div()
                    .relative()
                    .size(px(14.))
                    .flex_shrink_0()
                    .child(crate::features::desktop_agent::ui::agent_brand_mark::brand(
                        view.read(cx).runtime(),
                        self.dark,
                        14.,
                        fg,
                    ))
                    .when(busy, |d| {
                        d.child(
                            div()
                                .absolute()
                                .right(px(-1.))
                                .bottom(px(-1.))
                                .size(px(5.))
                                .rounded_full()
                                .border_1()
                                .border_color(t.auxiliary())
                                .bg(t.accent)
                                .with_animation(
                                    ElementId::NamedInteger("tab-running".into(), tab),
                                    Animation::new(std::time::Duration::from_millis(1400))
                                        .repeat()
                                        .with_easing(ease_in_out),
                                    |dot, delta| {
                                        // 0.48 → 1 → 0.48 opacity over one cycle.
                                        let wave = 1. - (delta * 2. - 1.).abs();
                                        dot.opacity(0.48 + 0.52 * wave)
                                    },
                                ),
                        )
                    })
                    .into_any_element(),
                Content::Terminal(..) => {
                    icon("square-terminal", fg).size(px(14.)).into_any_element()
                }
                Content::Retained(_) => icon("history", fg).size(px(14.)).into_any_element(),
                Content::Launcher => icon("plus", fg).size(px(14.)).into_any_element(),
            };
            let group_name = SharedString::from(format!("workbench-tab-{tab}"));
            let close_label = crate::localization::tf(
                "terminal.closeSession",
                &[("title", label.to_string().into())],
            );
            header = header.child(
                gpui_kit::base::Tab::new(("tab", tab))
                    .selected(active)
                    .accessibility_label(label.clone())
                    .group(group_name.clone())
                    .flex()
                    .items_center()
                    .flex_shrink_0()
                    .w(px(if compact { COMPACT } else { full_width }))
                    .h(px(28.))
                    .when(!compact, |d| d.pl(px(8.)).pr(px(4.)).gap(px(6.)))
                    .when(compact, |d| d.justify_center())
                    .rounded(px(theme::metric::TOOLBAR_ACTION_RADIUS))
                    .text_size(px(theme::ty().right.meta))
                    .text_color(fg)
                    .cursor(crate::theme::clickable_cursor())
                    .when(active, |d| d.bg(t.control))
                    .hover(move |d| d.bg(t.control_hover).text_color(t.text))
                    .tooltip(crate::ui::tooltip(label.clone()))
                    .child(
                        div()
                            .size(px(14.))
                            .flex_shrink_0()
                            .flex()
                            .items_center()
                            .justify_center()
                            .child(glyph),
                    )
                    .when(!compact, |d| {
                        d.child(div().flex_1().min_w_0().truncate().child(label.clone()))
                            .child(
                                crate::ui::icon_button(("close-tab", tab), "x", t)
                                    .size(px(18.))
                                    .rounded(px(4.))
                                    .accessibility_label(close_label)
                                    .when(!active, |b| {
                                        b.invisible()
                                            .group_hover(group_name.clone(), |s| s.visible())
                                    })
                                    .on_click(cx.listener(move |s, _, _, cx| {
                                        cx.stop_propagation();
                                        s.close(tab, false, cx);
                                    })),
                            )
                    })
                    .on_click(cx.listener(move |s, _, w, cx| {
                        if let Some(p) = s.project_mut() {
                            p.layout.activate(id, tab);
                        }
                        focus.focus(w, cx);
                        cx.notify();
                    }))
                    .on_drag(drag, |drag, _, _, cx| cx.new(|_| drag.clone()))
                    .on_drop(cx.listener(move |s, drag: &DragTab, _, cx| {
                        if s.root.as_ref() != Some(&drag.root) {
                            return;
                        }
                        if let Some(p) = s.project_mut() {
                            let index = p.layout.groups[&id]
                                .tabs
                                .iter()
                                .position(|x| *x == tab)
                                .unwrap_or(0);
                            p.layout.move_tab(drag.tab, id, index);
                        }
                        cx.notify();
                    }))
                    .context_menu({
                        let chat = match content {
                            Content::Chat(view) => Some(view.clone()),
                            _ => None,
                        };
                        let host = cx.weak_entity();
                        let close = crate::localization::tf(
                            "terminal.closeSession",
                            &[("title", label.to_string().into())],
                        );
                        move |mut menu, _, cx| {
                            if let Some(view) = &chat {
                                menu = AgentChat::session_menu(view.clone(), menu, cx).separator();
                            }
                            let host = host.clone();
                            menu.item(
                                gpui_kit::component::menu::PopupMenuItem::new(close.clone())
                                    .on_click(move |_, _, cx| {
                                        let _ = host.update(cx, |s, cx| s.close(tab, false, cx));
                                    }),
                            )
                        }
                    }),
            );
        }
        let square = |id: ElementId, name: &str, label: SharedString| {
            crate::ui::icon_button(id, name, t)
                .size(px(COMPACT))
                .rounded(px(theme::metric::TOOLBAR_ACTION_RADIUS))
                .accessibility_label(label.clone())
                .tooltip(crate::ui::tooltip(label))
        };
        if visible.len() < g.tabs.len() {
            let hidden = g.tabs.len() - visible.len();
            header = header.child(
                square(
                    ElementId::NamedInteger("overflow".into(), id),
                    "ellipsis",
                    crate::localization::tf("terminal.tabs.more", &[("count", hidden.into())])
                        .into(),
                )
                .on_click(cx.listener(move |s, _, _, cx| {
                    s.overflow = if s.overflow == Some(id) {
                        None
                    } else {
                        Some(id)
                    };
                    cx.notify();
                })),
            );
        }
        header = header.child(
            square(
                ElementId::NamedInteger("new-tab".into(), id),
                "plus",
                crate::localization::t("workspace.workbench.newTab").into(),
            )
            .on_click(cx.listener(move |s, _, _, cx| s.add(id, cx))),
        );
        if g.tabs.is_empty() && self.project().unwrap().layout.groups.len() > 1 {
            header = header.child(
                square(
                    ElementId::NamedInteger("close-group".into(), id),
                    "x",
                    crate::localization::t("common.action.close").into(),
                )
                .on_click(cx.listener(move |s, _, _, cx| {
                    if let Some(p) = s.project_mut() {
                        p.layout.remove_empty_group(id);
                    }
                    cx.notify();
                })),
            );
        }
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
            Some(Content::Terminal(view, _)) => {
                let view = view.clone();
                view.update(cx, |s, _| s.dark = self.dark);
                div().size_full().child(view).into_any_element()
            }
            _ => self.launcher(id, g.active, cx).into_any_element(),
        };
        let mut group = column()
            .id(("group", id))
            .size_full()
            .min_w_0()
            .min_h_0()
            .relative()
            .overflow_hidden()
            .bg(t.canvas)
            .child(header);
        if self.overflow == Some(id) {
            use crate::ui::menu::{MenuEntry, MenuItem, menu_surface};
            let this = cx.entity().downgrade();
            let entries = g
                .tabs
                .iter()
                .map(|&tab| {
                    let title = self.project().unwrap().content[&tab].title(cx);
                    let this = this.clone();
                    let close_label = crate::localization::tf(
                        "terminal.closeSession",
                        &[("title", title.to_string().into())],
                    );
                    MenuEntry::Item(
                        MenuItem::new(title, move |_, cx| {
                            let _ = this.update(cx, |s, cx| {
                                if let Some(p) = s.project_mut() {
                                    p.layout.activate(id, tab);
                                }
                                s.overflow = None;
                                cx.notify();
                            });
                        })
                        .checked(g.active == Some(tab))
                        .trailing(
                            crate::ui::icon_button(("overflow-close", tab), "x", t)
                                .size(px(20.))
                                .accessibility_label(close_label)
                                .on_click(cx.listener(move |s, _, _, cx| {
                                    cx.stop_propagation();
                                    s.close(tab, false, cx)
                                }))
                                .into_any_element(),
                        ),
                    )
                })
                .collect();
            group = group.child(
                menu_surface(format!("overflow-menu-{id}"), entries, t)
                    .absolute()
                    .top(px(38.))
                    .right(px(6.))
                    .w(px(260.))
                    .max_h(px(280.)),
            );
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
                                entity.update(cx, |s, _| {
                                    s.bounds.insert(id, bounds);
                                });
                            },
                            |_, _, _, _| {},
                        )
                        .absolute()
                        .size_full(),
                    )
                    .on_drop(cx.listener(move |s, drag: &DragTab, w, cx| {
                        if s.root.as_ref() != Some(&drag.root) {
                            return;
                        }
                        if let Some(b) = s.bounds.get(&id) {
                            let p = w.mouse_position();
                            let x = (p.x - b.origin.x) / b.size.width;
                            let y = (p.y - b.origin.y) / b.size.height;
                            if !(0.2..=0.8).contains(&x) {
                                s.split(id, Axis::Horizontal, Some(drag.tab), x > 0.5, cx);
                                return;
                            }
                            if !(0.2..=0.8).contains(&y) {
                                s.split(id, Axis::Vertical, Some(drag.tab), y > 0.5, cx);
                                return;
                            }
                        }
                        if let Some(p) = s.project_mut() {
                            let n = p.layout.groups[&id].tabs.len();
                            p.layout.move_tab(drag.tab, id, n);
                        }
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
                div()
                    .relative()
                    .flex()
                    .when(axis == Axis::Vertical, |d| d.flex_col())
                    .size_full()
                    .min_h_0()
                    .min_w_0()
                    .child(
                        div()
                            .min_w_0()
                            .min_h_0()
                            .overflow_hidden()
                            .when(axis == Axis::Vertical, |d| d.h(relative(*ratio)).w_full())
                            .when(axis == Axis::Horizontal, |d| d.w(relative(*ratio)).h_full())
                            .child(a),
                    )
                    .child(
                        div()
                            .id(("split-sash", id))
                            .flex_shrink_0()
                            .bg(t.divider)
                            .when(axis == Axis::Vertical, |d| {
                                d.h(px(5.)).w_full().cursor(CursorStyle::ResizeUpDown)
                            })
                            .when(axis == Axis::Horizontal, |d| {
                                d.w(px(5.)).h_full().cursor(CursorStyle::ResizeLeftRight)
                            })
                            .on_mouse_down(
                                MouseButton::Left,
                                cx.listener(move |s, _, _, cx| {
                                    if let Some(bounds) = s.bounds.get(&id) {
                                        s.drag_split = Some((id, axis, *bounds));
                                    }
                                    cx.notify();
                                }),
                            ),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .min_h_0()
                            .overflow_hidden()
                            .child(b),
                    )
                    .child(
                        canvas(
                            move |bounds, _, cx| {
                                entity.update(cx, |s, _| {
                                    s.bounds.insert(id, bounds);
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
            .bg(t.canvas)
            .text_color(t.text)
            .on_mouse_move(cx.listener(|s, e: &MouseMoveEvent, _, cx| {
                if let Some((id, axis, b)) = s.drag_split {
                    let ratio = if axis == Axis::Horizontal {
                        (e.position.x - b.origin.x) / b.size.width
                    } else {
                        (e.position.y - b.origin.y) / b.size.height
                    };
                    if let Some(p) = s.project_mut() {
                        p.layout.resize(id, ratio);
                    }
                    cx.notify();
                }
            }))
            .on_mouse_up(
                MouseButton::Left,
                cx.listener(|s, _, _, cx| {
                    s.drag_split = None;
                    cx.notify();
                }),
            )
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
