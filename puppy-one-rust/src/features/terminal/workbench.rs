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
    /// The folder the session runs in, as the accessible label names it.
    root: String,
    /// `session.ordinal`: the session's number among its project's terminals.
    ordinal: u32,
}

/// The next terminal number of the project at `root` (`Terminal 1`, ...).
fn next_ordinal(root: &std::path::Path) -> u32 {
    static NEXT: std::sync::Mutex<Option<std::collections::HashMap<PathBuf, u32>>> =
        std::sync::Mutex::new(None);
    let mut next = NEXT.lock().unwrap_or_else(|e| e.into_inner());
    let n = next
        .get_or_insert_with(Default::default)
        .entry(root.to_path_buf())
        .or_insert(0);
    *n += 1;
    *n
}

/// `DESKTOP_TERMINAL_LAUNCHERS[].nameMessage` for the CLI a tab runs.
fn launcher_name(runtime: Option<Runtime>) -> Option<&'static str> {
    Some(match runtime {
        None => "terminal.launcher.shell.name",
        Some(Runtime::Codex) => "terminal.launcher.codex.name",
        Some(Runtime::Claude) => "terminal.launcher.claude.name",
        Some(Runtime::Cursor) => "terminal.launcher.cursor.name",
        Some(Runtime::OpenCode) => "terminal.launcher.opencode.name",
        Some(Runtime::Pi) => "terminal.launcher.pi.name",
        Some(Runtime::Hermes) => "terminal.launcher.hermes.name",
        Some(Runtime::PuppyOne | Runtime::WorkBuddy) => return None,
    })
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
        let ordinal = next_ordinal(&root);
        let location = root.to_string_lossy().into_owned();
        let view = cx.new(|cx| TerminalView::new(root, launcher, window, cx));
        Self {
            view,
            title,
            runtime,
            root: location,
            ordinal,
        }
    }

    /// The tab over `view` (fixtures): `title` stands for its folder.
    #[cfg(any(test, feature = "dev-capture"))]
    pub fn of(view: Entity<TerminalView>, title: String, runtime: Option<Runtime>) -> Self {
        Self {
            view,
            root: title.clone(),
            title,
            runtime,
            ordinal: 1,
        }
    }

    /// `presentTerminalSessionHeader`'s accessible label: the session, the
    /// CLI it runs, its folder and its status.
    fn accessible_label(&self, status: SessionStatus) -> String {
        let session = tf(
            "terminal.sessionTitle",
            &[("number", (self.ordinal as i64).into())],
        );
        [
            Some(session.to_string()),
            launcher_name(self.runtime).map(|key| tr(key).to_string()),
            Some(self.root.trim().to_owned()).filter(|root| !root.is_empty()),
            Some(tr(status.label_key()).to_string()),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" — ")
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
            accessible_label: self.accessible_label(status),
            detail: Some(format!("{} — {}", self.title, tr(status.label_key()))),
            icon_key: None,
            status: match status {
                SessionStatus::Starting => ItemStatus::Starting,
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

#[cfg(test)]
mod launch_tests {
    use super::*;
    use core::prelude::v1::test;
    struct FixtureWindow;
    impl Render for FixtureWindow {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            div()
        }
    }
    /// `projects one consistent identity for the rail and overflow menu`: a
    /// terminal tab is titled by its folder; its accessible label names the
    /// session's number in its project, the CLI it runs, its folder and its
    /// status; the overflow detail is the folder and status.
    #[gpui::test]
    fn a_terminal_tab_names_its_session_cli_folder_and_status(cx: &mut TestAppContext) {
        crate::localization::set_current("en");
        let root = std::path::Path::new("/workspace/my private");
        let other = std::path::Path::new("/workspace/other");
        assert_eq!(
            [next_ordinal(root), next_ordinal(root), next_ordinal(other)],
            [1, 2, 1]
        );
        let window = cx.add_window(|_, _| FixtureWindow);
        let view = window
            .update(cx, |_, window, cx| {
                cx.new(|cx| {
                    TerminalView::start(
                        |wake| crate::platform::terminal::Terminal::bridged(wake).0,
                        false,
                        window,
                        cx,
                    )
                })
            })
            .unwrap();
        let tab = |runtime| TerminalItem {
            view: view.clone(),
            title: path_label(root),
            runtime,
            root: root.to_string_lossy().into_owned(),
            ordinal: 2,
        };
        let codex = cx.update(|cx| tab(Some(Runtime::Codex)).snapshot(cx));
        assert_eq!(codex.title, "my private");
        assert_eq!(
            codex.accessible_label,
            "Terminal 2 — Codex — /workspace/my private — Running"
        );
        assert_eq!(codex.detail.as_deref(), Some("my private — Running"));
        let shell = cx.update(|cx| tab(None).snapshot(cx));
        assert_eq!(
            shell.accessible_label,
            "Terminal 2 — Shell — /workspace/my private — Running"
        );
    }
    #[gpui::test]
    fn a_native_terminal_rejects_an_unregistered_inventory_entry_before_executing_its_cached_path(
        cx: &mut TestAppContext,
    ) {
        cx.executor().allow_parking();
        cx.update(gpui_kit::init);
        let directory = tempfile::tempdir().unwrap();
        let binary = directory.path().join("fake-cli");
        std::fs::write(&binary, "#!/bin/sh\n: > \"${0}.ran\"\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let window = cx.add_window(|_, _| FixtureWindow);
        let terminal = window
            .update(cx, |_, window, cx| {
                TerminalItem::launch(
                    directory.path().into(),
                    Some(Installation {
                        runtime: Runtime::Codex,
                        id: "unregistered-inventory-entry",
                        label: "Stale fixture".into(),
                        executable: binary.clone(),
                        chat: true,
                    }),
                    window,
                    cx,
                )
            })
            .unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        loop {
            cx.run_until_parked();
            let status = terminal.view.read_with(cx, |v, _| v.status());
            if matches!(status, SessionStatus::Error | SessionStatus::Exited) {
                assert_eq!(status, SessionStatus::Error);
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "terminal did not settle"
            );
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        assert!(
            !directory.path().join("fake-cli.ran").exists(),
            "a cached UI path must never become a process authority"
        );
    }
    #[test]
    fn terminal_launch_preserves_verified_prefix_and_discovery_environment_without_reordering_path()
    {
        let launch = crate::agent::host::TerminalAgentLaunch {
            executable_path: "/fixture/cursor".into(),
            display_name: "Cursor Agent".into(),
            args: vec!["agent".into(), "literal $(touch ignored)".into()],
            environment: [
                ("PATH".into(), "/bin:/fixture:/usr/bin".into()),
                ("VENDOR_MODE".into(), "managed".into()),
            ]
            .into(),
        };
        let command = launch.into_command();
        assert_eq!(command.executable, PathBuf::from("/fixture/cursor"));
        assert_eq!(command.arguments, ["agent", "literal $(touch ignored)"]);
        let environment: std::collections::BTreeMap<_, _> =
            command.environment.into_iter().collect();
        assert_eq!(environment["VENDOR_MODE"], "managed");
        assert_eq!(environment["PATH"], "/bin:/fixture:/usr/bin");
    }
}
