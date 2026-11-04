//! Window ownership (`electron/main.mjs` `createWindow`, `windowStateById`,
//! `createOrRevealWindow`). Every window hosts one `Shell`; process-wide
//! owners (preferences, accounts) are shared, per-window state is not.
//!
//! - File/Dock → New Window opens a window on the Homepage.
//! - A project opens in the window it was chosen from, even when another
//!   window shows it too (`workspace-window-index.mjs`: the app "never
//!   chooses a user's destination window").
//! - A folder from Finder or a second launch opens in a new window.
//! - Menu-bar actions (and Undo/Redo) reach the active window's shell.
//! - Quit asks every window to close through its own close barrier. On
//!   macOS closing the last window leaves the app running; the Dock opens
//!   the last active project (`readLastActiveWorkspaceComposition`), as
//!   does a launch without arguments.
use super::Shell;
use crate::features::settings::preferences_store::PreferencesStore;
use gpui::*;
use std::path::PathBuf;

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
    /// A file window's file (`initialFilePath`).
    pub file: Option<PathBuf>,
    /// The project's document to open first (`initialOpenPath`), relative
    /// to the project.
    pub open: Option<PathBuf>,
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
            file: None,
            open: None,
            from_args: first,
        },
    }
}
/// The preferences every window shares, once a window created them.
pub(super) fn preferences(cx: &App) -> Option<Entity<PreferencesStore>> {
    cx.try_global::<SharedPreferences>().map(|p| p.0.clone())
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
pub fn quitting(cx: &App) -> bool {
    cx.try_global::<Registry>().is_some_and(|r| r.quitting)
}
/// Whether the last window closing ends the app: always when quitting,
/// never on macOS otherwise (`resumeAfterLastWindowClosed`).
pub fn last_close_quits(cx: &App) -> bool {
    quitting(cx) || !cfg!(target_os = "macos")
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

/// The product's application name (`application-identity.mjs`).
pub const APP_NAME: &str = "PuppyOne";
/// `createWindow`: a project window is 1180 × 760, centred.
pub const WINDOW_SIZE: (f32, f32) = (1180., 760.);
/// `DEFAULT_MACOS_WINDOW_BUTTON_POSITION`: the leading inset, and the
/// buttons centred in the 40px Header lane (`(40 - 14) / 2`).
pub const TRAFFIC_LIGHTS: (f32, f32) = (12., 13.);

/// The window options shared by launch and New Window.
pub fn window_options(bounds: Bounds<Pixels>, focus: bool) -> WindowOptions {
    WindowOptions {
        focus,
        window_bounds: Some(WindowBounds::Windowed(bounds)),
        titlebar: Some(TitlebarOptions {
            title: Some(APP_NAME.into()),
            appears_transparent: true,
            traffic_light_position: Some(point(px(TRAFFIC_LIGHTS.0), px(TRAFFIC_LIGHTS.1))),
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
    open_with(
        Launch {
            workspace,
            file: None,
            open: None,
            from_args: false,
        },
        cx,
    )
}
/// A new window on a project just created, its first document open
/// (`openWorkspaceInNewWindow(path, { initialOpenPath })`).
pub fn open_created(
    workspace: PathBuf,
    open: Option<PathBuf>,
    cx: &mut App,
) -> anyhow::Result<AnyWindowHandle> {
    open_with(
        Launch {
            workspace: Some(workspace),
            file: None,
            open,
            from_args: false,
        },
        cx,
    )
}
/// `openPathFromSystem` for a file: the window already showing it comes
/// forward, otherwise a file window opens.
pub fn open_file(path: PathBuf, cx: &mut App) -> anyhow::Result<AnyWindowHandle> {
    if let Some((handle, _)) = live(cx).into_iter().find(|(_, shell)| {
        shell
            .read(cx)
            .file_target
            .as_ref()
            .is_some_and(|f| f.path == path)
    }) {
        let _ = handle.update(cx, |_, w, _| w.activate_window());
        return Ok(handle);
    }
    open_with(
        Launch {
            workspace: None,
            file: Some(path),
            open: None,
            from_args: false,
        },
        cx,
    )
}
fn open_with(launch: Launch, cx: &mut App) -> anyhow::Result<AnyWindowHandle> {
    let (w, h) = if launch.file.is_some() {
        super::file_mode::FILE_WINDOW_SIZE
    } else {
        WINDOW_SIZE
    };
    cx.set_global(PendingLaunch(Some(launch)));
    // `center: true`: every new window is centred.
    let bounds = Bounds::centered(None, size(px(w), px(h)), cx);
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

/// `queueTemplateIntent`: the app's own template link
/// (`puppyone://templates/import?id=…`) shows its card in the window in
/// front, or a new one. Anything else is not a template link.
fn open_template_link(url: &str, cx: &mut App) -> bool {
    use crate::platform::{build_identity, templates::link};
    let channel = build_identity::current().channel;
    if !url.starts_with(&format!("{}://templates/", link::scheme(channel))) {
        return false;
    }
    let origin = link::store_origin();
    let Ok(template) = link::parse(url, &origin, channel) else {
        // Invalid external intents are ignored.
        return true;
    };
    let share = link::share_link(&template, &origin);
    let target = active(cx).or_else(|| {
        let handle = open(None, cx).ok()?;
        live(cx).into_iter().find(|(h, _)| *h == handle)
    });
    if let Some((handle, shell)) = target {
        let _ = handle.update(cx, |_, window, cx| {
            window.activate_window();
            shell.update(cx, |s, cx| s.open_template_link(share, window, cx));
        });
    }
    true
}
/// Paths the platform asked us to open (`openPathFromSystem`): a folder in
/// a new window; a Markdown, CSV or HTML file in its own file window. Other
/// files cannot be opened on their own.
pub fn open_launch_urls(urls: Vec<String>, cx: &mut App) {
    for url in urls {
        if open_template_link(&url, cx) {
            continue;
        }
        let Some(path) = url::Url::parse(&url)
            .ok()
            .filter(|u| u.scheme() == "file")
            .and_then(|u| u.to_file_path().ok())
            .and_then(|p| p.canonicalize().ok())
        else {
            continue;
        };
        if path.is_dir() {
            let _ = open(Some(path), cx);
        } else if super::file_mode::is_file_mode_file(&path) {
            let _ = open_file(path, cx);
        } else {
            eprintln!(
                "This file type cannot be opened on its own: {}",
                path.display()
            );
        }
    }
}
