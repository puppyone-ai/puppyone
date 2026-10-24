// Use Kit as the single public UI dependency, including GPUI macros.
extern crate gpui_kit as gpui;
mod agent;
mod assets;
mod capture;
mod documents;
mod editor;
mod features;
mod file_kind;
mod geometry;
mod localization;
mod model;
mod model_connections;
mod native_editor;
mod platform;
mod shell;
#[cfg(feature = "webview-smoke")]
mod smoke;
mod theme;
mod typography;
mod ui;
mod wake;
#[cfg(target_os = "macos")]
mod web_composition_macos;
mod web_editor;
mod workspace;
use gpui::*;
fn main() {
    platform::text_rendering::match_product_font_smoothing();
    #[cfg(feature = "webview-smoke")]
    if std::env::var_os("PUPPYONE_SMOKE_DIR").is_some() {
        eprintln!("Smoke: starting native application");
    }
    gpui_kit::application()
        .with_assets(assets::Assets)
        .run(|cx: &mut App| {
            #[cfg(feature = "webview-smoke")]
            if std::env::var_os("PUPPYONE_SMOKE_DIR").is_some() {
                eprintln!("Smoke: GPUI ready");
            }
            cx.text_system()
                .add_fonts(vec![
                    std::borrow::Cow::Borrowed(include_bytes!("../assets/Geist-Regular.ttf")),
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
            platform::ime::init(cx);
            ui::input::bind_keys(cx);
            ui::form_input::bind_keys(cx);
            shell::bind_keys(cx);
            native_editor::bind_keys(cx);
            editor::view::bind_keys(cx);
            editor::csv::bind_keys(cx);
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
            let (window, shell_view) = open_shell_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(bounds)),
                    titlebar: Some(TitlebarOptions {
                        title: Some("PuppyOne GPUI — local text workspace".into()),
                        appears_transparent: true,
                        traffic_light_position: Some(point(px(12.), px(12.))),
                    }),
                    window_background: WindowBackgroundAppearance::Transparent,
                    window_min_size: Some(size(px(640.), px(420.))),
                    ..Default::default()
                },
                cx,
                |window, cx| cx.new(|cx| shell::Shell::new(window, cx)),
            )
            .expect("open GPUI window");
            // GPUI's macOS Undo/Redo menu items dispatch GPUI actions. Native
            // input consumes these first; an unhandled action reaches the editor model.
            let undo_view = shell_view.clone();
            cx.on_action(move |_: &ui::input::Undo, cx| {
                let _ = window.update(cx, |_, w, cx| {
                    undo_view.update(cx, |s, cx| s.command("undo", w, cx))
                });
            });
            let redo_view = shell_view.clone();
            cx.on_action(move |_: &ui::input::Redo, cx| {
                let _ = window.update(cx, |_, w, cx| {
                    redo_view.update(cx, |s, cx| s.command("redo", w, cx))
                });
            });
            cx.on_action(move |action: &shell::HostAction, cx| {
                let _ = window.update(cx, |_, window, cx| {
                    shell_view.update(cx, |s, cx| s.command(&action.name, window, cx))
                });
            });
            cx.on_window_closed(|cx, _| {
                if cx.windows().is_empty() {
                    cx.quit();
                }
            })
            .detach();
            cx.activate(true);
            #[cfg(feature = "webview-smoke")]
            if std::env::var_os("PUPPYONE_SMOKE_DIR").is_some() {
                let _ = window.update(cx, |_, w, _| w.activate_window());
            }
        });
}

// Kit's styled Root plugin paints an opaque background by default. The native
// WebView is beneath Metal, so this window explicitly refines that root style.
// Keep Kit's Root/plugins/focus facilities; use its public Styled seam only.
fn open_shell_window<V: Render>(
    options: WindowOptions,
    cx: &mut App,
    build: impl FnOnce(&mut Window, &mut App) -> Entity<V>,
) -> anyhow::Result<(AnyWindowHandle, Entity<V>)> {
    let mut built = None;
    let window = cx.open_window(options, |window, cx| {
        let view = build(window, cx);
        built = Some(view.clone());
        cx.new(|cx| gpui_kit::base::Root::new(view, window, cx).bg(transparent_black()))
    })?;
    Ok((window.into(), built.expect("shell constructed")))
}
