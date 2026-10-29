// Use Kit as the single public UI dependency, including GPUI macros.
extern crate gpui_kit as gpui;
mod agent;
mod asset_catalog;
mod assets;
#[cfg(all(test, target_os = "macos"))]
mod bench;
mod capture;
mod cloud_auth;
mod cloud_publication;
mod documents;
mod editor;
mod features;
mod file_kind;
mod formats;
mod geometry;
#[cfg(feature = "dev-capture")]
mod lab;
mod localization;
mod model;
mod model_connections;
mod native_window;
mod platform;
mod shell;
mod theme;
mod typography;
mod ui;
mod wake;
mod web_host;
mod workspace;
use gpui::*;
fn main() {
    // An Agent CLI's Hook runs this executable as its bridge: forward the
    // event and exit before any UI or single-instance work starts.
    if std::env::args().nth(1).as_deref() == Some(platform::agent_activity::hook::FLAG) {
        platform::agent_activity::hook::run();
        return;
    }
    platform::text_rendering::match_product_font_smoothing();
    let application = gpui_kit::application().with_assets(assets::Assets);
    // Dock click with no window: the last active project (`activate`).
    application.on_reopen(|cx| {
        if shell::windows::count(cx) == 0 {
            let last = shell::windows::last_active_project(cx);
            let _ = shell::windows::open(last, cx);
        }
    });
    // Finder "Open With", `open -a` and second launches deliver folders here
    // (`requestSingleInstanceLock` + `desktop-launch-intent`).
    let (open_tx, open_rx) = async_channel::unbounded::<Vec<String>>();
    application.on_open_urls(move |urls| {
        let _ = open_tx.try_send(urls);
    });
    application.run(move |cx: &mut App| {
        cx.text_system()
            .add_fonts(vec![
                std::borrow::Cow::Borrowed(include_bytes!("../assets/Geist-Regular.ttf")),
                std::borrow::Cow::Borrowed(include_bytes!("../assets/Geist-Medium.ttf")),
                std::borrow::Cow::Borrowed(include_bytes!("../assets/Geist-SemiBold.ttf")),
                std::borrow::Cow::Borrowed(include_bytes!("../assets/Geist-Bold.ttf")),
                // Agent Markdown inline code (`tools/import-agent-code-font.py`).
                std::borrow::Cow::Borrowed(include_bytes!("../assets/fonts/agent-inline-code.ttf")),
                std::borrow::Cow::Borrowed(include_bytes!("../assets/OpenSans-Regular.ttf")),
                std::borrow::Cow::Borrowed(include_bytes!("../assets/OpenSans-Bold.ttf")),
                std::borrow::Cow::Borrowed(include_bytes!("../assets/OpenSans-Italic.ttf")),
                std::borrow::Cow::Borrowed(include_bytes!("../assets/OpenSans-BoldItalic.ttf")),
            ])
            .expect("load native UI and content fonts");
        cx.text_system()
            .add_fonts(editor::view::style::font_bytes())
            .expect("load editor faces");
        // Before any input: tells swallowed function keys from delivered ones.
        cx.set_reduce_motion(platform::accessibility::reduce_motion());
        ui::ime::init(cx);
        ui::input::bind_keys(cx);
        ui::form_input::bind_keys(cx);
        shell::bind_keys(cx);
        // Hooked terminal Agents' file activity, for every window.
        features::agent_presence::init(cx);
        features::sub_theme_catalog::init(cx);
        editor::actions::bind_keys(cx);
        editor::view::bind_keys(cx);
        editor::csv::bind_keys(cx);
        editor::viewers::pdf::bind_keys(cx);
        editor::host::bind_keys(cx);
        features::desktop_agent::bind_keys(cx);
        cx.set_menus(shell::app_menus());
        let dimension = |key, default| {
            std::env::var(key)
                .ok()
                .and_then(|v| v.parse::<f32>().ok())
                .unwrap_or(default)
        };
        let bounds = Bounds::centered(
            None,
            size(
                px(dimension("PUPPYONE_WIDTH", 1280.)),
                px(dimension("PUPPYONE_HEIGHT", 800.)),
            ),
            cx,
        );
        #[cfg(feature = "dev-capture")]
        if let Ok(case) = std::env::var("PUPPYONE_LAB") {
            // The lab must never interrupt the person at the keyboard: no
            // Dock icon or menu bar, no activation, no key window, and
            // the window waits behind every other one. `screencapture -l`
            // reads the window's own backing store, so it still captures.
            capture::run_in_background();
            let window = cx
                .open_window(
                    WindowOptions {
                        window_bounds: Some(WindowBounds::Windowed(bounds)),
                        titlebar: None,
                        focus: false,
                        window_background: WindowBackgroundAppearance::Opaque,
                        ..Default::default()
                    },
                    |window, cx| {
                        let view = cx.new(|cx| lab::Lab::new(&case, window, cx));
                        cx.new(|cx| gpui_kit::base::Root::new(view, window, cx))
                    },
                )
                .expect("open lab window");
            let _ = window.update(cx, |_, window, cx| {
                capture::send_to_back(window);
                capture::pump_frames(window, cx);
            });
            cx.on_window_closed(|cx, _| {
                if cx.windows().is_empty() {
                    cx.quit();
                }
            })
            .detach();
            return;
        }
        // Dev captures of the shell run like the lab: an accessory window
        // behind every other one that never takes the keyboard.
        #[cfg(feature = "dev-capture")]
        let background = std::env::var_os("PUPPYONE_SCREENSHOT").is_some();
        #[cfg(not(feature = "dev-capture"))]
        let background = false;
        #[cfg(feature = "dev-capture")]
        if background {
            capture::run_in_background();
        }
        features::cloud_account::install(!background, cx);
        cx.spawn(async move |cx| {
            while let Ok(urls) = open_rx.recv().await {
                cx.update(|cx| shell::windows::open_launch_urls(urls, cx));
            }
        })
        .detach();
        // One foreground serves every window: beat for the stall watcher.
        platform::watchdog::start();
        platform::watchdog::install_crash_hook();
        cx.spawn(async move |cx| {
            loop {
                platform::watchdog::beat();
                cx.background_executor()
                    .timer(platform::watchdog::BEAT)
                    .await;
            }
        })
        .detach();
        let mut options = shell::windows::window_options(bounds, !background);
        if background {
            options.focus = false;
        }
        let (window, _shell_view) = open_shell_window(options, cx, |window, cx| {
            cx.new(|cx| shell::Shell::new(window, cx))
        })
        .expect("open GPUI window");
        #[cfg(feature = "dev-capture")]
        if background {
            let _ = window.update(cx, |_, window, cx| {
                capture::send_to_back(window);
                capture::pump_frames(window, cx);
            });
        }
        #[cfg(not(feature = "dev-capture"))]
        let _ = window;
        // GPUI's macOS Undo/Redo menu items dispatch GPUI actions. Native
        // input consumes these first; an unhandled action reaches the
        // active window's editor model. Every menu-bar action follows
        // the key window, not the first one opened.
        fn to_active(command: shell::Command, cx: &mut App) {
            if let Some((handle, shell)) = shell::windows::active(cx) {
                let _ = handle.update(cx, |_, w, cx| {
                    shell.update(cx, |s, cx| s.command(command, w, cx))
                });
            } else if command == shell::Command::NewWindow {
                let _ = shell::windows::open(None, cx);
            } else if command == shell::Command::QuitApp {
                cx.quit();
            }
        }
        cx.on_action(|_: &ui::input::Undo, cx| to_active(shell::Command::Undo, cx));
        cx.on_action(|_: &ui::input::Redo, cx| to_active(shell::Command::Redo, cx));
        shell::on_global_shell_actions(cx, to_active);
        cx.set_dock_menu(shell::dock_menu());
        shell::on_app_actions(cx);
        cx.on_window_closed(|cx, _| {
            if cx.windows().is_empty() {
                cx.quit();
            }
        })
        .detach();
        if !background {
            cx.activate(true);
        }
    });
}

// The shell window keeps Kit's Root (plugins, focus facilities, its opaque
// background under the shell's own surfaces).
fn open_shell_window<V: Render>(
    options: WindowOptions,
    cx: &mut App,
    build: impl FnOnce(&mut Window, &mut App) -> Entity<V>,
) -> anyhow::Result<(AnyWindowHandle, Entity<V>)> {
    let mut built = None;
    let window = cx.open_window(options, |window, cx| {
        let view = build(window, cx);
        built = Some(view.clone());
        cx.new(|cx| gpui_kit::base::Root::new(view, window, cx))
    })?;
    Ok((window.into(), built.expect("shell constructed")))
}
