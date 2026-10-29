//! Window ownership (`electron/main.mjs` `createWindow`, `windowStateById`,
//! `createOrRevealWindow`). Every window hosts one `Shell`; process-wide
//! owners (preferences, accounts) are shared, per-window state is not.
//!
//! - File/Dock → New Window opens a window on the Homepage.
//! - Opening a project already open in another window reveals that window
//!   instead of mounting a second copy of its documents and layout.
//! - Menu-bar actions (and Undo/Redo) reach the active window's shell.
//! - Quit asks every window to close through its own close barrier.
//! - With no windows (Dock reopen) or at launch without arguments, the last
//!   active project opens (`readLastActiveWorkspaceComposition`).
use super::Shell;
use crate::features::settings::preferences_store::PreferencesStore;
use gpui::*;
use std::path::{Path, PathBuf};

#[derive(Default)]
struct Registry {
    windows: Vec<(AnyWindowHandle, WeakEntity<Shell>)>,
    /// Quit is closing every window: individual closes do not end the app
    /// early or change what the next launch restores.
    quitting: bool,
}
impl Global for Registry {}

/// The process-wide preference owner every window shares.
struct SharedPreferences(Entity<PreferencesStore>);
impl Global for SharedPreferences {}

/// What the next shell opens with (the window being constructed).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Launch {
    pub workspace: Option<PathBuf>,
    /// The process arguments apply to the first window only.
    pub from_args: bool,
}
struct PendingLaunch(Option<Launch>);
impl Global for PendingLaunch {}

pub(super) fn take_launch(cx: &mut App) -> Launch {
    let first = !cx.has_global::<Registry>()
        || cx.global::<Registry>().windows.is_empty() && !cx.global::<Registry>().quitting;
    match cx.try_global::<PendingLaunch>().and_then(|p| p.0.clone()) {
        Some(launch) => {
            cx.set_global(PendingLaunch(None));
            launch
        }
        None => Launch {
            workspace: None,
            from_args: first,
        },
    }
}
pub(super) fn shared_preferences(fixture: bool, cx: &mut App) -> Entity<PreferencesStore> {
    if fixture {
        return cx.new(|_| PreferencesStore::memory());
    }
    if let Some(shared) = cx.try_global::<SharedPreferences>() {
        return shared.0.clone();
    }
    let store = cx.new(PreferencesStore::new);
    cx.set_global(SharedPreferences(store.clone()));
    store
}
pub(super) fn register(handle: AnyWindowHandle, shell: WeakEntity<Shell>, cx: &mut App) {
    if !cx.has_global::<Registry>() {
        cx.set_global(Registry::default());
    }
    let registry = cx.global_mut::<Registry>();
    registry
        .windows
        .retain(|(h, s)| *h != handle && s.upgrade().is_some());
    registry.windows.push((handle, shell));
}
pub(super) fn unregister(handle: AnyWindowHandle, cx: &mut App) {
    if cx.has_global::<Registry>() {
        cx.global_mut::<Registry>()
            .windows
            .retain(|(h, _)| *h != handle);
    }
}
fn live(cx: &App) -> Vec<(AnyWindowHandle, Entity<Shell>)> {
    cx.try_global::<Registry>()
        .map(|r| {
            r.windows
                .iter()
                .filter_map(|(h, s)| s.upgrade().map(|s| (*h, s)))
                .collect()
        })
        .unwrap_or_default()
}
/// The shell of the key window, else the most recently registered one.
pub fn active(cx: &App) -> Option<(AnyWindowHandle, Entity<Shell>)> {
    let windows = live(cx);
    let key = cx.active_window();
    windows
        .iter()
        .find(|(h, _)| Some(*h) == key)
        .or_else(|| windows.last())
        .cloned()
}
pub fn count(cx: &App) -> usize {
    live(cx).len()
}
/// Another window already showing `root` (`createOrRevealWindow`).
pub(super) fn window_showing(
    root: &Path,
    except: AnyWindowHandle,
    cx: &App,
) -> Option<AnyWindowHandle> {
    live(cx).into_iter().find_map(|(h, shell)| {
        (h != except && shell.read(cx).workspace_root().as_deref() == Some(root)).then_some(h)
    })
}
#[cfg(test)]
pub fn quitting(cx: &App) -> bool {
    cx.try_global::<Registry>().is_some_and(|r| r.quitting)
}
/// Quit: every window closes through its own barrier; the last close quits.
pub fn quit_all(cx: &mut App) {
    if !cx.has_global::<Registry>() {
        cx.quit();
        return;
    }
    cx.global_mut::<Registry>().quitting = true;
    let windows = live(cx);
    if windows.is_empty() {
        cx.quit();
        return;
    }
    cx.defer(move |cx| {
        for (handle, shell) in windows {
            let _ = handle.update(cx, |_, window, cx| {
                shell.update(cx, |s, cx| s.command(super::Command::Quit, window, cx))
            });
        }
    });
}
/// A close or quit was refused (a document could not be saved): the app
/// keeps running with the remaining windows.
pub fn cancel_quit(cx: &mut App) {
    if cx.has_global::<Registry>() {
        cx.global_mut::<Registry>().quitting = false;
    }
}

/// The window options shared by launch and New Window.
pub fn window_options(bounds: Bounds<Pixels>, focus: bool) -> WindowOptions {
    WindowOptions {
        focus,
        window_bounds: Some(WindowBounds::Windowed(bounds)),
        titlebar: Some(TitlebarOptions {
            title: Some("PuppyOne".into()),
            appears_transparent: true,
            traffic_light_position: Some(point(px(12.), px(12.))),
        }),
        window_background: WindowBackgroundAppearance::Opaque,
        window_min_size: Some(size(
            px(crate::theme::pane::WINDOW_MIN_WIDTH),
            px(crate::theme::pane::WINDOW_MIN_HEIGHT),
        )),
        ..Default::default()
    }
}
/// Opens a shell window; `workspace` opens that project, `None` the Homepage.
pub fn open(workspace: Option<PathBuf>, cx: &mut App) -> anyhow::Result<AnyWindowHandle> {
    cx.set_global(PendingLaunch(Some(Launch {
        workspace,
        from_args: false,
    })));
    // New windows cascade from the active one.
    let origin = cx
        .active_window()
        .and_then(|h| h.update(cx, |_, w, _| w.bounds().origin).ok());
    let mut bounds = Bounds::centered(None, size(px(1280.), px(800.)), cx);
    if let Some(origin) = origin {
        bounds.origin = point(origin.x + px(24.), origin.y + px(24.));
    }
    let handle = cx.open_window(window_options(bounds, true), |window, cx| {
        let view = cx.new(|cx| Shell::new(window, cx));
        cx.new(|cx| gpui_kit::base::Root::new(view, window, cx))
    })?;
    cx.activate(true);
    Ok(handle.into())
}
/// The last active project, when it still exists.
pub fn last_active_project(cx: &App) -> Option<PathBuf> {
    let shared = cx.try_global::<SharedPreferences>()?;
    shared
        .0
        .read(cx)
        .state
        .recent_projects
        .first()
        .map(|p| p.path.clone())
        .filter(|p| p.is_dir())
}

/// Folders the platform asked us to open: reveal the window already showing
/// one, reuse a window still on the Homepage, otherwise open a new window.
pub fn open_launch_urls(urls: Vec<String>, cx: &mut App) {
    for url in urls {
        let Some(path) = url::Url::parse(&url)
            .ok()
            .filter(|u| u.scheme() == "file")
            .and_then(|u| u.to_file_path().ok())
            .filter(|p| p.is_dir())
        else {
            continue;
        };
        let root = path.canonicalize().unwrap_or(path);
        let showing = live(cx)
            .into_iter()
            .find(|(_, shell)| shell.read(cx).workspace_root().as_deref() == Some(root.as_path()));
        if let Some((handle, _)) = showing {
            let _ = handle.update(cx, |_, w, _| w.activate_window());
            continue;
        }
        let home = live(cx)
            .into_iter()
            .find(|(_, shell)| shell.read(cx).workspace_root().is_none());
        if let Some((handle, shell)) = home {
            let path = root.clone();
            let _ = handle.update(cx, |_, w, cx| {
                w.activate_window();
                shell.update(cx, |s, cx| s.open_project(path, w, cx))
            });
        } else {
            let _ = open(Some(root), cx);
        }
    }
}
