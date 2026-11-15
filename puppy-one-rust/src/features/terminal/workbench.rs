//! `desktop-terminal/workbench`: the terminal's Workbench contribution. A
//! terminal tab is a [`TerminalView`] titled by its project folder; the CLI
//! it launched shows as its mark (`TerminalWorkbenchContribution`,
//! `TerminalSessionHeaderStatus`).
use super::{SessionStatus, TerminalView, path_label};
use crate::agent::connections::legacy_local_agent_inventory::Installation;
use crate::agent::connections::legacy_runtime_registry::Runtime;
use crate::features::workbench::{
    CloseCopy, CloseDecision, ItemKind, ItemSnapshot, ItemStatus, RetainedItem, Workbench,
    WorkbenchItem,
};
use crate::localization::{t as tr, tf};
use crate::ui::agent_brand_mark::{LauncherIdentity, launcher_icon};
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
        let command = installation.as_ref().map(launch_command);
        let view = cx.new(|cx| TerminalView::new(root, command, launcher, window, cx));
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
        let identity = self.runtime.map_or(LauncherIdentity::Shell, |r| {
            LauncherIdentity::brand(r.icon_key())
        });
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

/// The resolver already applied vendor environment overrides. Keep its PATH
/// and put the verified entry's directory first for sibling executables.
fn launch_command(installation: &Installation) -> crate::platform::terminal::LaunchCommand {
    let mut command = crate::platform::terminal::LaunchCommand {
        executable: installation.executable.clone(),
        ..Default::default()
    };
    if let Some(candidate) = &installation.launch {
        command.arguments = candidate.args_prefix.clone();
        let mut environment = candidate.environment.clone().unwrap_or_default();
        for (key, value) in candidate.environment_overrides.iter().flatten() {
            environment.insert(key.clone(), value.clone());
        }
        if !candidate.launch_path_entry.is_empty() {
            let existing = environment.get("PATH").cloned().unwrap_or_default();
            let paths = std::iter::once(PathBuf::from(&candidate.launch_path_entry)).chain(
                std::env::split_paths(&existing)
                    .filter(|p| p != &PathBuf::from(&candidate.launch_path_entry)),
            );
            if let Ok(path) = std::env::join_paths(paths) {
                environment.insert("PATH".into(), path.to_string_lossy().into_owned());
            }
        }
        command.environment = environment.into_iter().collect();
    }
    command
}

#[cfg(test)]
mod launch_tests {
    use super::*;
    use crate::agent::installation::executable_resolver::ResolvedCandidate;
    use core::prelude::v1::test;
    #[test]
    fn terminal_launch_keeps_verified_prefix_environment_and_sibling_path() {
        let installation = Installation {
            runtime: Runtime::Cursor,
            id: "cursor",
            label: "Cursor".into(),
            executable: "/fixture/cursor".into(),
            chat: true,
            launch: Some(std::sync::Arc::new(ResolvedCandidate {
                args_prefix: vec!["agent".into(), "literal $(touch ignored)".into()],
                environment: Some(
                    [
                        ("PATH".into(), "/bin:/fixture:/usr/bin".into()),
                        ("VENDOR_MODE".into(), "old".into()),
                    ]
                    .into(),
                ),
                environment_overrides: Some(vec![("VENDOR_MODE".into(), "managed".into())]),
                launch_path_entry: "/fixture".into(),
                ..Default::default()
            })),
        };
        let command = launch_command(&installation);
        assert_eq!(command.executable, PathBuf::from("/fixture/cursor"));
        assert_eq!(command.arguments, ["agent", "literal $(touch ignored)"]);
        let environment: std::collections::BTreeMap<_, _> =
            command.environment.into_iter().collect();
        assert_eq!(environment["VENDOR_MODE"], "managed");
        assert_eq!(environment["PATH"], "/fixture:/bin:/usr/bin");
    }
}
