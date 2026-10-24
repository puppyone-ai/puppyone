// Use Kit as the single public UI dependency, including GPUI macros.
extern crate gpui_kit as gpui;
mod app;
mod buffer;
mod model;
// Shared primitives intentionally expose more functionality than this one lab uses.
#[allow(dead_code)]
#[path = "../../src/geometry.rs"]
mod geometry;
#[allow(dead_code)]
#[path = "../../src/ui/input.rs"]
mod input;
#[allow(dead_code)]
#[path = "../../src/theme.rs"]
mod theme;
#[allow(dead_code)]
#[path = "../../src/typography.rs"]
mod typography;
use gpui::*;
fn main() {
    gpui_kit::application().run(|cx: &mut App| {
        cx.text_system()
            .add_fonts(vec![
                std::borrow::Cow::Borrowed(include_bytes!("../assets/Geist-Regular.ttf")),
                std::borrow::Cow::Borrowed(include_bytes!("../assets/Geist-Bold.ttf")),
                std::borrow::Cow::Borrowed(include_bytes!("../assets/OpenSans-Regular.ttf")),
                std::borrow::Cow::Borrowed(include_bytes!("../assets/OpenSans-Bold.ttf")),
                std::borrow::Cow::Borrowed(include_bytes!("../assets/OpenSans-Italic.ttf")),
                std::borrow::Cow::Borrowed(include_bytes!("../assets/OpenSans-BoldItalic.ttf")),
            ])
            .expect("load lab fonts");
        input::bind_keys(cx);
        app::bind_keys(cx);
        cx.set_menus(vec![
            Menu {
                disabled: false,
                name: "Native Editor Lab".into(),
                items: vec![MenuItem::action("Quit", app::LabAction::new("quit"))],
            },
            // The lab has no catalog; labels for the stable item ids.
            input::edit_menu(|id| {
                match id {
                    "edit" => "Edit",
                    "undo" => "Undo",
                    "redo" => "Redo",
                    "cut" => "Cut",
                    "copy" => "Copy",
                    "paste" => "Paste",
                    _ => "Select All",
                }
                .into()
            }),
        ]);
        let bounds = Bounds::centered(None, size(px(1100.), px(800.)), cx);
        let window = cx
            .open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(bounds)),
                    window_min_size: Some(size(px(720.), px(520.))),
                    titlebar: Some(TitlebarOptions {
                        title: Some("PuppyOne — GPUI Native Editor Lab (memory only)".into()),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
                |w, cx| cx.new(|cx| app::Probe::new(w, cx)),
            )
            .expect("open GPUI lab");
        cx.on_action(move |_: &input::Undo, cx| {
            let _ = window.update(cx, |s, w, cx| s.command("undo", w, cx));
        });
        cx.on_action(move |_: &input::Redo, cx| {
            let _ = window.update(cx, |s, w, cx| s.command("redo", w, cx));
        });
        cx.on_action(move |a: &app::LabAction, cx| {
            let _ = window.update(cx, |s, w, cx| s.command(&a.name, w, cx));
        });
        cx.on_window_closed(|cx, _| {
            if cx.windows().is_empty() {
                cx.quit();
            }
        })
        .detach();
        cx.activate(true);
    });
}
