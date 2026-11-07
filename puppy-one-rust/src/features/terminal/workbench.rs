//! `desktop-terminal/workbench`: the terminal's Workbench contribution. A
//! terminal tab is a [`TerminalView`] titled by its project folder; the CLI
//! it launched shows as its mark (`TerminalWorkbenchContribution`,
//! `TerminalSessionHeaderStatus`).
use super::{SessionStatus, TerminalView, path_label};
use crate::agent::connections::legacy_local_agent_inventory::Installation;
use crate::agent::connections::legacy_runtime_registry::Runtime;
use crate::features::desktop_agent::{LauncherIdentity, launcher_icon};
use crate::features::workbench::{
    CloseCopy, CloseDecision, ItemKind, ItemSnapshot, ItemStatus, RetainedItem, Workbench,
    WorkbenchItem,
};
use crate::localization::{t as tr, tf};
use crate::ui::appearance::ActiveAppearance;
use gpui::{prelude::*, *};
use std::path::PathBuf;

/// One terminal tab: its PTY, its title and the CLI it launched (`None` for
/// the shell).
#[derive(Clone)]
pub struct TerminalItem {
    view: Entity<TerminalView>,
    title: String,
    runtime: Option<Runtime>,
}

impl TerminalItem {
    /// The project's shell, or the CLI of `installation`.
    pub fn launch(
        root: PathBuf,
        installation: Option<Installation>,
        window: &mut Window,
        cx: &mut App,
    ) -> Self {
        let title = path_label(&root);
        let runtime = installation.as_ref().map(|i| i.runtime);
        let launcher = installation.as_ref().map_or("shell", |i| i.id);
        let executable = installation.map(|i| i.executable);
        let view = cx.new(|cx| TerminalView::new(root, executable, launcher, window, cx));
        Self::of(view, title, runtime)
    }

    /// The tab over `view`.
    pub fn of(view: Entity<TerminalView>, title: String, runtime: Option<Runtime>) -> Self {
        Self {
            view,
            title,
            runtime,
        }
    }
}

impl WorkbenchItem for TerminalItem {
    fn kind(&self) -> ItemKind {
        ItemKind::Terminal
    }

    fn snapshot(&self, cx: &App) -> ItemSnapshot {
        let terminal = self.view.read(cx);
        let status = terminal.status();
        ItemSnapshot {
            title: self.title.clone(),
            accessible_label: self.title.clone(),
            detail: Some(format!("{} — {}", self.title, tr(status.label_key()))),
            icon_key: None,
            status: match status {
                SessionStatus::Running => ItemStatus::Running,
                SessionStatus::Error => ItemStatus::Error,
                _ => ItemStatus::Exited,
            },
            running: terminal.running,
            resource_id: None,
        }
    }

    fn view(&self) -> AnyView {
        self.view.clone().into()
    }

    /// The CLI's mark (dimmed once the session exited); a busy Agent CLI
    /// swaps it for the activity grid in the tab's own colour.
    fn status_mark(&self, tab: u64, color: Rgba, cx: &App) -> Option<AnyElement> {
        let t = cx.palette();
        let terminal = self.view.read(cx);
        let active = self.runtime.is_some() && terminal.agent_active();
        let identity = self
            .runtime
            .map_or(LauncherIdentity::Shell, LauncherIdentity::Runtime);
        // `[data-status="exited"] .desktop-terminal-tab-status { opacity: 0.42 }`
        Some(
            div()
                .size(px(14.))
                .flex()
                .items_center()
                .justify_center()
                .when(!terminal.running, |d| d.opacity(0.42))
                .map(|d| {
                    if active {
                        d.child(activity_grid(tab, color))
                    } else {
                        d.child(launcher_icon(identity, true, t.dark, t.muted))
                    }
                })
                .into_any_element(),
        )
    }

    fn retained(&self, _: &App) -> RetainedItem {
        RetainedItem::Terminal {
            title: self.title.clone(),
            runtime: self.runtime,
        }
    }

    fn close_decision(&self, cx: &App) -> CloseDecision {
        if self.view.read(cx).running {
            CloseDecision::Confirm
        } else {
            CloseDecision::Close
        }
    }

    fn close_copy(&self, _: bool, title: String) -> CloseCopy {
        CloseCopy {
            title: tf("terminal.closeDialog.title", &[("title", title.into())]),
            detail: tr("terminal.closeDialog.detail"),
            action: tr("terminal.closeDialog.confirm"),
            blocked: false,
        }
    }

    fn watch(&self, cx: &mut Context<Workbench>) -> Subscription {
        cx.observe(&self.view, |_, _, cx| cx.notify())
    }
}

/// `TerminalActivityGrid`: four 3px cells, 2px apart, at 22% ink; one cell at
/// a time lights clockwise from the top left (`steps(1, end)`, 0.8s cycle,
/// each lit for the first 24% of its 0.2s-staggered period).
fn activity_grid(tab: u64, color: Rgba) -> AnyElement {
    const CELL: f32 = 3.;
    const GAP: f32 = 2.;
    div()
        .relative()
        .size(px(CELL * 2. + GAP))
        .with_animation(
            ElementId::NamedInteger("terminal-activity".into(), tab),
            Animation::new(std::time::Duration::from_millis(800)).repeat(),
            move |grid, delta| {
                let t = delta * 0.8;
                let slot = ((t / 0.2) as usize).min(3);
                let lit = (t - slot as f32 * 0.2) < 0.192;
                // Clockwise: top left, top right, bottom right, bottom left.
                let order = [(0., 0.), (1., 0.), (1., 1.), (0., 1.)];
                grid.children(order.iter().enumerate().map(|(i, (x, y))| {
                    div()
                        .absolute()
                        .left(px(x * (CELL + GAP)))
                        .top(px(y * (CELL + GAP)))
                        .size(px(CELL))
                        .bg(color)
                        .opacity(if lit && i == slot { 1. } else { 0.22 })
                }))
            },
        )
        .into_any_element()
}
