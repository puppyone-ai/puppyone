//! Window ownership (`electron/main.mjs` `createWindow`, `windowStateById`,
//! `createOrRevealWindow`). Every window hosts one `Shell`; process-wide
//! owners (preferences, accounts) are shared, per-window state is not.
//!
//! - File/Dock → New Window opens a window on the Homepage.
//! - A project opens in the window it was chosen from, even when another
//!   window shows it too (`workspace-window-index.mjs`: the app "never
//!   chooses a user's destination window").
//! - A folder from Finder or a second launch opens in a new window; a
//!   Markdown, CSV or HTML file in a file window of its own (the window
//!   already showing it comes forward). At launch such a request replaces
//!   the window the launch would otherwise open.
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
            .file
            .as_ref()
            .is_some_and(|f| f.target.path == path)
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
/// files cannot be opened on their own. `true` when a window now shows one.
pub fn open_launch_urls(urls: Vec<String>, cx: &mut App) -> bool {
    let mut shown = false;
    for url in urls {
        if open_template_link(&url, cx) {
            shown = true;
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
        shown |= open_path(path, cx);
    }
    shown
}

/// `openPathFromSystem`: `true` when a window now shows `path`.
pub fn open_path(path: PathBuf, cx: &mut App) -> bool {
    if path.is_dir() {
        open(Some(path), cx).is_ok()
    } else if super::file_mode::is_file_mode_file(&path) {
        open_file(path, cx).is_ok()
    } else {
        eprintln!(
            "This file type cannot be opened on its own: {}",
            path.display()
        );
        false
    }
}

/// What a command line names (`findLaunchTargetArg`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct LaunchArgs {
    /// The last folder or file named; anything that is not a path is
    /// ignored, as are other flags.
    pub target: Option<PathBuf>,
    /// `--file <relative>`: the project's document to open first.
    pub open: Option<PathBuf>,
}
/// Parse arguments (without the program) resolved against `cwd`; a
/// `file://` URI names its path. `--workspace <folder>` and `--file
/// <relative>` are the native build's own developer flags.
pub fn parse_launch_args(
    args: impl IntoIterator<Item = std::ffi::OsString>,
    cwd: &std::path::Path,
) -> LaunchArgs {
    let resolve = |arg: &std::ffi::OsStr| {
        let text = arg.to_string_lossy();
        let path = match url::Url::parse(&text).ok().filter(|u| u.scheme() == "file") {
            Some(url) => url.to_file_path().ok()?,
            None => PathBuf::from(arg),
        };
        let path = cwd.join(path).canonicalize().ok()?;
        (path.is_dir() || path.is_file()).then_some(path)
    };
    let mut parsed = LaunchArgs::default();
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        if arg == "--workspace" {
            if let Some(path) = args.next().as_deref().and_then(resolve) {
                parsed.target = Some(path);
            }
        } else if arg == "--file" {
            parsed.open = args.next().map(PathBuf::from);
        } else if !arg.to_string_lossy().starts_with('-')
            && let Some(path) = resolve(&arg)
        {
            parsed.target = Some(path);
        }
    }
    parsed
}

/// `handleSecondInstanceLaunch`: a later launch's command line. A template
/// link shows its card; a file opens in its file window, a folder in a new
/// window; otherwise (or when that fails) a window comes forward.
pub fn second_instance(args: Vec<std::ffi::OsString>, cwd: PathBuf, cx: &mut App) {
    if args
        .iter()
        .any(|arg| open_template_link(&arg.to_string_lossy(), cx))
    {
        return;
    }
    let parsed = parse_launch_args(args, &cwd);
    if parsed.target.is_some_and(|path| open_path(path, cx)) {
        return;
    }
    reveal_or_create(cx);
}

/// `createOrRevealWindow`: the window last in front comes forward, or a new
/// one opens.
fn reveal_or_create(cx: &mut App) {
    let front = active(cx).or_else(|| live(cx).into_iter().next());
    match front {
        Some((handle, _)) => {
            let _ = handle.update(cx, |_, window, _| window.activate_window());
            cx.activate(true);
        }
        None => {
            let _ = open(last_active_project(cx), cx);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use std::ffi::OsString;

    #[test]
    fn the_last_folder_or_file_on_the_command_line_is_the_target() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        std::fs::write(root.join("a.md"), "# A\n").unwrap();
        std::fs::create_dir(root.join("notes")).unwrap();
        let parse = |args: &[&str]| parse_launch_args(args.iter().map(OsString::from), &root);
        // Flags and names that are not there are ignored; the last path wins.
        assert_eq!(
            parse(&["-psn_0_1", "missing.md", "a.md"]).target,
            Some(root.join("a.md"))
        );
        assert_eq!(parse(&["a.md", "notes"]).target, Some(root.join("notes")));
        let uri = url::Url::from_file_path(root.join("a.md")).unwrap();
        assert_eq!(parse(&[uri.as_str()]).target, Some(root.join("a.md")));
        assert_eq!(parse(&["--unknown"]), LaunchArgs::default());
        // The native developer flags.
        let parsed = parse(&["--workspace", "notes", "--file", "README.md"]);
        assert_eq!(parsed.target, Some(root.join("notes")));
        assert_eq!(parsed.open, Some(PathBuf::from("README.md")));
    }
}
