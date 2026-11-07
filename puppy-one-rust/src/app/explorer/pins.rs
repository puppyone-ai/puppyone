//! `ExplorerPinnedFiles` and `explorerPins`: files pinned above the tree
//! like pinned browser tabs — always in the same place, one click away,
//! whatever the tree below is showing. The tree can fold away under them,
//! behind a chevron on a hairline. Pins belong to the project
//! (`Preferences::explorer_pins`, shared by its windows), follow a rename
//! or move, and go with a deletion. The session keeps them; this paints
//! them.
use super::*;
use crate::features::settings::ExplorerPins;
use crate::ui::components::FileIcon;
use crate::ui::components::Icon;
use crate::ui::components::ProductIcon;
use gpui_kit::{
    base::{h_flex, v_flex},
    component::Sizable as _,
};

/// `grid-template-columns: repeat(auto-fill, minmax(104px, 1fr))`, `gap: 4px`.
const PIN_MIN: f32 = 104.;
const PIN_GAP: f32 = 4.;
/// `.desktop-explorer-files-toggle`.
const TOGGLE_HEIGHT: f32 = 20.;

fn relative(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

impl Explorer {
    /// `onContextMenu` on a pin: the node menu for that file alone.
    fn open_pin_menu(&mut self, path: PathBuf, at: Point<Pixels>, cx: &mut Context<Self>) {
        self.menu = Some(ExplorerMenu {
            kind: menus::MenuKind::Node {
                paths: vec![path.clone()],
                primary: path,
            },
            at: MenuAt::Pointer(at),
            submenu_open: false,
        });
        cx.notify();
    }

    /// `.desktop-explorer-pins`: the pins in equal columns, then the fold.
    pub(super) fn pins_view(&self, pins: &ExplorerPins, cx: &mut Context<Self>) -> Div {
        let t = cx.palette();
        let ty = theme::ty().left;
        let icon_theme = self.preferences.read(cx).state.file_icon_theme.clone();
        let width =
            (self.host.frame.w - metric::SIDEBAR_ROW_LEFT_GAP - metric::SIDEBAR_ROW_RIGHT_GAP)
                .max(PIN_MIN);
        let columns = (((width + PIN_GAP) / (PIN_MIN + PIN_GAP)).floor() as usize).max(1);
        let active = self.host.opened.as_deref().map(relative);
        // The tree's own row fills, so a pin reads as a row, not a button.
        let tint = theme::alpha(t.hover, 0.86);
        let pin = |index: usize, file: &crate::features::settings::PinnedFile| {
            let lit = active.as_deref() == Some(file.path.as_str());
            let (label, _) = crate::file_kind::display_name(&file.name, false);
            let path = PathBuf::from(&file.path);
            let menu_path = path.clone();
            div()
                .id(("explorer-pin", index))
                .debug_selector({
                    let path = file.path.clone();
                    move || format!("explorer-pin:{path}")
                })
                .flex_1()
                .flex_basis(px(0.))
                .min_w_0()
                .flex()
                .items_center()
                .gap(px(metric::SIDEBAR_ICON_LABEL_GAP))
                .h(px(theme::control()))
                .pl(px(metric::SIDEBAR_ROW_CONTENT_LEFT))
                .pr(px(metric::SIDEBAR_ROW_CONTENT_RIGHT))
                .rounded(px(metric::SIDEBAR_ROW_RADIUS + 2.))
                .text_size(px(ty.content))
                .line_height(px(ty.line_height))
                .text_color(if lit { t.text } else { t.sidebar_text })
                .when(lit, |d| d.bg(tint))
                .cursor(theme::clickable_cursor())
                .hover(move |s| {
                    let s = s.text_color(t.text);
                    if lit {
                        s.bg(crate::ui::components::selected_gradient(t))
                    } else {
                        s.bg(tint)
                    }
                })
                .tooltip(crate::ui::components::tooltip(file.name.clone()))
                .child(
                    div()
                        .size(px(metric::SIDEBAR_ICON_SLOT))
                        .flex_none()
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(FileIcon::file(file.name.clone(), icon_theme.clone())),
                )
                .child(div().min_w_0().truncate().child(label))
                .on_click(cx.listener(move |_, _, _, cx| {
                    cx.emit(ExplorerEvent::Open(path.clone()));
                }))
                .on_mouse_down(
                    MouseButton::Right,
                    cx.listener(move |s, e: &MouseDownEvent, _, cx| {
                        cx.stop_propagation();
                        s.open_pin_menu(menu_path.clone(), e.position, cx)
                    }),
                )
                .into_any_element()
        };
        let mut grid = v_flex().gap(px(PIN_GAP));
        for (row, files) in pins.files.chunks(columns).enumerate() {
            let mut line = h_flex().gap(px(PIN_GAP)).min_w_0();
            for (column, file) in files.iter().enumerate() {
                line = line.child(pin(row * columns + column, file));
            }
            // The last line keeps the columns of the full ones.
            for _ in files.len()..columns {
                line = line.child(div().flex_1().flex_basis(px(0.)));
            }
            grid = grid.child(line);
        }
        let collapsed = pins.files_collapsed;
        // Only a chevron on a hairline: the tree under it needs no title.
        let toggle = div()
            .id("explorer-files-toggle")
            .debug_selector(|| "explorer-files-toggle".into())
            .group("explorer-files-toggle")
            .flex()
            .items_center()
            .w_full()
            .min_w_0()
            .h(px(TOGGLE_HEIGHT))
            .pl(px(metric::SIDEBAR_ROW_CONTENT_LEFT))
            .rounded(px(metric::SIDEBAR_ROW_RADIUS))
            .text_color(t.subtle)
            .cursor(theme::clickable_cursor())
            .tooltip(crate::ui::components::tooltip(tr(
                "workspace.explorer.allFiles",
            )))
            .child(
                div()
                    .w(px(metric::SIDEBAR_ICON_SLOT))
                    .flex_none()
                    .flex()
                    .items_center()
                    .justify_center()
                    .opacity(0.5)
                    .group_hover("explorer-files-toggle", |s| s.opacity(1.))
                    .child(
                        Icon::product(ProductIcon::Disclosure)
                            .with_size(px(12.))
                            .when(!collapsed, |i| i.rotate(std::f32::consts::FRAC_PI_2)),
                    ),
            )
            .child(div().flex_1().h(px(1.)).mx(px(2.)).bg(t.sidebar_divider))
            .on_click(cx.listener(move |s, _, _, cx| {
                s.session.update(cx, |session, cx| {
                    session.set_files_collapsed(!collapsed, cx)
                })
            }));
        v_flex()
            .flex_none()
            .gap(px(6.))
            .pt(px(metric::SIDEBAR_ROW_LEFT_GAP))
            .pl(px(metric::SIDEBAR_ROW_LEFT_GAP))
            .pr(px(metric::SIDEBAR_ROW_RIGHT_GAP))
            .child(grid)
            .child(toggle)
    }
}
