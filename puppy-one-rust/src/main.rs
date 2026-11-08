// Use Kit as the single public UI dependency, including GPUI macros.
extern crate gpui_kit as gpui;
mod app;
#[cfg(all(test, target_os = "macos"))]
mod bench;
mod capture;
mod features;
#[cfg(feature = "dev-capture")]
mod lab;
mod native_window;

// The layers below the window, under the names the sources use.
use gpui::*;
use po_agent::agent;
use po_contracts::{clock, file_kind, formats, geometry, model, text, wake};
use po_editor::{documents, editor, web_host};
use po_platform::{localization, platform};
use po_ui::{assets, theme, typography, ui};
use po_workspace::{cloud, workspace};
/// `createCliControlServer` + `createCliControlRequests`: `puppyone open`
/// over the per-user socket, answered by this app's windows. The first
/// answer settles a launch by the command line: whether anything opened.
#[cfg(unix)]
fn serve_cli(outcome: async_channel::Sender<bool>, cx: &mut App) {
    use platform::cli_control::{self, Incoming, Request};
    let identity = platform::build_identity::current();
    let info = cli_control::AppInfo {
        name: app::windows::APP_NAME.into(),
        version: identity.version.clone(),
        channel: format!("{:?}", identity.channel).to_lowercase(),
    };
    let endpoint = cli_control::endpoint(&platform::data_dir(), unsafe { libc::getuid() });
    let incoming = match cli_control::serve(&endpoint, info.clone()) {
        Ok(incoming) => incoming,
        Err(error) => {
            eprintln!("Unable to accept command-line requests: {error}");
            return;
        }
    };
    cx.spawn(async move |cx| {
        while let Ok(Incoming { request, reply }) = incoming.recv().await {
            let answer = cx.update(|cx| match request {
                Ok(Request::Hello) => cli_control::hello(
                    &info,
                    &app::windows::file_mode_extensions(),
                    app::windows::MAX_EDITOR_BYTES,
                ),
                Ok(Request::Open { paths, activate }) => {
                    let results = paths
                        .iter()
                        .map(|path| {
                            cli_control::result(
                                path,
                                app::windows::open_from_cli(path, activate, cx),
                            )
                        })
                        .collect();
                    cli_control::opened(&info, results)
                }
                Err(answer) => answer,
            });
            let opened = answer["results"]
                .as_array()
                .is_some_and(|r| r.iter().any(|r| r["status"] != "rejected"));
            let _ = reply.send(answer).await;
            let _ = outcome.try_send(opened);
        }
    })
    .detach();
}

fn main() {
    // An Agent CLI's Hook runs this executable as its bridge: forward the
    // event and exit before any UI or single-instance work starts.
    if std::env::args().nth(1).as_deref() == Some(platform::agent_activity::hook::FLAG) {
        platform::agent_activity::hook::run();
        return;
    }
    // PuppyOne Host: no windows, its own state and lock; it keeps sharing
    // this computer's folders after the App quits.
    if std::env::args().any(|a| a == workspace::hosts::process::HOST_ARGUMENT) {
        std::process::exit(workspace::hosts::process::run(
            &platform::data_dir(),
            env!("CARGO_PKG_VERSION"),
        ));
    }
    // `requestSingleInstanceLock`: a later launch hands its command line to
    // the running app and exits (captures and the lab run on their own).
    #[cfg(unix)]
    let instance = {
        let isolated = std::env::var_os("PUPPYONE_LAB").is_some()
            || std::env::var_os("PUPPYONE_SCREENSHOT").is_some();
        let args: Vec<_> = std::env::args_os().skip(1).collect();
        let cwd = std::env::current_dir().unwrap_or_default();
        if isolated {
            None
        } else {
            platform::single_instance::acquire(&platform::data_dir(), &args, &cwd)
        }
    };
    #[cfg(unix)]
    if matches!(
        instance,
        Some(platform::single_instance::Instance::Forwarded)
    ) {
        return;
    }
    platform::text_rendering::match_product_font_smoothing();
    let application = gpui_kit::application().with_assets(assets::Assets);
    // Dock click with no window: the last active project (`activate`).
    application.on_reopen(|cx| {
        if app::windows::count(cx) == 0 {
            let last = app::windows::last_active_project(cx);
            let _ = app::windows::open(last, cx);
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
        app::bind_keys(cx);
        // Hooked terminal Agents' file activity, for every window.
        features::agent_presence::init(cx);
        features::sub_theme_catalog::init(cx);
        editor::actions::bind_keys(cx);
        editor::view::bind_keys(cx);
        editor::csv::bind_keys(cx);
        editor::viewers::pdf::bind_keys(cx);
        editor::host::bind_keys(cx);
        features::desktop_agent::bind_keys(cx);
        cx.set_menus(app::app_menus());
        let dimension = |key, default| {
            std::env::var(key)
                .ok()
                .and_then(|v| v.parse::<f32>().ok())
                .unwrap_or(default)
        };
        let bounds = Bounds::centered(
            None,
            size(
                px(dimension("PUPPYONE_WIDTH", app::windows::WINDOW_SIZE.0)),
                px(dimension("PUPPYONE_HEIGHT", app::windows::WINDOW_SIZE.1)),
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
        // behind every other one that never takes the keyboard. A live
        // capture (`PUPPYONE_CAPTURE_LIVE`, for frame timing) replays its
        // scenario in an ordinary foreground window on the display link.
        #[cfg(feature = "dev-capture")]
        let background = std::env::var_os("PUPPYONE_SCREENSHOT").is_some()
            && std::env::var_os("PUPPYONE_CAPTURE_LIVE").is_none();
        #[cfg(not(feature = "dev-capture"))]
        let background = false;
        #[cfg(feature = "dev-capture")]
        if background {
            capture::run_in_background();
        }
        features::cloud::account::install(!background, cx);
        // Captures paint a development build's analytics state without files.
        #[cfg(feature = "dev-capture")]
        if background {
            features::telemetry::install_fixture(
                Some(features::telemetry::fixture(
                    platform::telemetry::Level::Basic,
                    false,
                    false,
                )),
                cx,
            );
        } else {
            features::telemetry::init(cx);
        }
        #[cfg(not(feature = "dev-capture"))]
        features::telemetry::init(cx);
        // `appPreviewRuntime.closeAll()`: running App Previews stop with the
        // app; the quit waits for their process groups, bounded.
        cx.on_app_quit(|_| {
            let (done, stopped) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                platform::app_preview::runtime::runtime().close_all();
                let _ = done.send(());
            });
            let _ = stopped.recv_timeout(std::time::Duration::from_secs(4));
            async {}
        })
        .detach();
        // What the launch itself was asked to open (a file or folder from
        // Finder) arrives before launching finishes and replaces the window
        // the launch would otherwise open (`openPendingPaths`).
        let pending: Vec<String> = std::iter::from_fn(|| open_rx.try_recv().ok())
            .flatten()
            .collect();
        let mut launched = !pending.is_empty() && app::windows::open_launch_urls(pending, cx);
        // A file named on the command line opens in a file window of its
        // own instead, as `pendingOpenPaths` does (folders stay the first
        // window's, `findLaunchTargetArg`).
        if !background
            && let Some(file) = app::windows::parse_launch_args(
                std::env::args_os().skip(1),
                &std::env::current_dir().unwrap_or_default(),
            )
            .target
            .filter(|path| path.is_file())
        {
            launched |= app::windows::open_path(file, cx);
        }
        cx.spawn(async move |cx| {
            while let Ok(urls) = open_rx.recv().await {
                cx.update(|cx| app::windows::open_launch_urls(urls, cx));
            }
        })
        .detach();
        // A launch by `puppyone open` waits for its request instead of
        // restoring the last project, and quits when it opens nothing.
        let launched_by_cli =
            std::env::args_os().any(|arg| arg == platform::cli_control::LAUNCH_ARGUMENT);
        let (cli_outcome_tx, cli_outcome) = async_channel::bounded::<bool>(1);
        #[cfg(unix)]
        if let Some(platform::single_instance::Instance::Primary(launches)) = instance {
            cx.spawn(async move |cx| {
                while let Ok((args, cwd)) = launches.recv().await {
                    cx.update(|cx| app::windows::second_instance(args, cwd, cx));
                }
            })
            .detach();
            serve_cli(cli_outcome_tx, cx);
        }
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
        if launched_by_cli && !launched {
            launched = true;
            cx.spawn(async move |cx| {
                let wait = cx
                    .background_executor()
                    .timer(platform::cli_control::LAUNCH_WAIT);
                let outcome =
                    futures_util::future::select(Box::pin(cli_outcome.recv()), wait).await;
                cx.update(|cx| match outcome {
                    futures_util::future::Either::Left((Ok(true), _)) => {}
                    futures_util::future::Either::Left((Ok(false), _))
                        if app::windows::count(cx) == 0 =>
                    {
                        cx.quit()
                    }
                    _ if app::windows::count(cx) == 0 => {
                        let _ = app::windows::open(app::windows::last_active_project(cx), cx);
                    }
                    _ => {}
                });
            })
            .detach();
        }
        if !launched {
            let mut options = app::windows::window_options(bounds, !background);
            if background {
                options.focus = false;
            }
            let (window, _shell_view) = open_shell_window(options, cx, |window, cx| {
                cx.new(|cx| app::Shell::new(window, cx))
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
        }
        // GPUI's macOS Undo/Redo menu items dispatch GPUI actions. Native
        // input consumes these first; an unhandled action reaches the
        // active window's editor model. Every menu-bar action follows
        // the key window, not the first one opened.
        fn to_active(command: app::Command, cx: &mut App) {
            if let Some((handle, shell)) = app::windows::active(cx) {
                let _ = handle.update(cx, |_, w, cx| {
                    shell.update(cx, |s, cx| s.command(command, w, cx))
                });
            } else if command == app::Command::NewWindow {
                let _ = app::windows::open(None, cx);
            } else if command == app::Command::QuitApp {
                cx.quit();
            }
        }
        cx.on_action(|_: &ui::input::Undo, cx| to_active(app::Command::Undo, cx));
        cx.on_action(|_: &ui::input::Redo, cx| to_active(app::Command::Redo, cx));
        app::on_global_shell_actions(cx, to_active);
        cx.set_dock_menu(app::dock_menu());
        app::on_app_actions(cx);
        // `window-all-closed`: on macOS the app stays until it is quit (a
        // capture ends with its window).
        cx.on_window_closed(move |cx, _| {
            if cx.windows().is_empty() && (background || app::windows::last_close_quits(cx)) {
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

/// The architecture's boundaries are part of the suite: a feature reached
/// past its facade, a render that writes state, untyped JSON in a view or a
/// provider named outside its runtime fails `cargo test`
/// (`tools/check-ui-boundaries.py`).
#[cfg(test)]
mod boundaries {
    use core::prelude::v1::test;

    #[test]
    fn the_architecture_boundaries_hold() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let output = std::process::Command::new("python3")
            .arg(root.join("tools/check-ui-boundaries.py"))
            .current_dir(root)
            .output()
            .expect("python3 runs the boundary check");
        assert!(
            output.status.success(),
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
