//! Tree rows (`.tree-row`) and the list-end "New" row
//! (`desktop-explorer-list-end-create`).
use super::{menus::MenuAt, menus::RowTrigger, *};
use crate::{
    localization::tf,
    ui::components::{FileIcon, Icon, RowActionButton, RowVariant, SidebarRow},
};
use gpui_kit::{
    base::{Disableable as _, Selectable as _},
    component::Sizable as _,
};

/// Entries being dragged within the Explorer.
#[derive(Clone)]
pub(in crate::shell) struct DragNodes {
    pub paths: Vec<PathBuf>,
    pub label: SharedString,
}
impl Render for DragNodes {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.palette();
        div()
            .px(px(10.))
            .py(px(6.))
            .rounded(px(6.))
            .bg(t.menu_bg)
            .border_1()
            .border_color(t.border)
            .text_color(t.text)
            .text_size(px(theme::ty().left.content))
            .child(self.label.clone())
    }
}

impl Shell {
    /// One stride of the virtual list: a row inside its 1px block margins
    /// (`uniform_list` measures items without their margins).
    pub(super) fn explorer_row(&mut self, index: usize, cx: &mut Context<Self>) -> AnyElement {
        let row = match self.tree.rows.get(index).cloned() {
            Some(item) => self.tree_row(index, item, cx),
            None => self.list_end_row(cx),
        };
        div()
            .w_full()
            .h(px(theme::sidebar_stride()))
            .child(row)
            .into_any_element()
    }
    fn tree_row(
        &mut self,
        index: usize,
        item: crate::model::Row,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = cx.palette();
        let icon_theme = self.preferences.read(cx).state.file_icon_theme.clone();
        let width = self.layout.explorer.w - 2. * metric::SIDEBAR_ROW_LEFT_GAP;
        let selected = self.tree.selected == item.path || self.tree.selection.contains(&item.path);
        let lit = self
            .explorer
            .menu
            .as_ref()
            .and_then(|menu| menu.row_trigger(&item.path));
        let cut = matches!(&self.explorer.clipboard, Some(FileClipboard::Cut(p)) if p.contains(&item.path));

        let mut row = SidebarRow::new(("tree-row", index))
            .selected(selected)
            .open(lit.is_some())
            .dimmed(cut)
            .indent((item.depth as f32 * metric::TREE_INDENT).min((width - 64.).max(0.)));
        // `TreeDisclosureMarker` (12px, opacity .82) or the file glyph.
        row = if item.folder {
            row.icon(
                Icon::new(if item.expanded {
                    "tree-disclosure-open"
                } else {
                    "tree-disclosure"
                })
                .xsmall()
                .opacity(0.82),
            )
        } else {
            row.leading(FileIcon::file(item.name.clone(), icon_theme))
        };
        // Indent guides through the row's 1px margins.
        let levels = item
            .depth
            .min(((width - 40.).max(0.) / metric::TREE_INDENT) as usize);
        row = row.children((0..levels).map(|level| {
            div()
                .absolute()
                .top(px(-1.))
                .bottom(px(-1.))
                .left(px(metric::TREE_ROW_CONTENT_LEFT
                    + metric::SIDEBAR_ICON_SLOT / 2.
                    + level as f32 * metric::TREE_INDENT))
                .w(px(1.))
                .bg(t.guide)
        }));
        row = row.child(
            div()
                .flex()
                .flex_1()
                .min_w_0()
                .items_baseline()
                .gap(px(5.))
                .when(cut, |d| d.opacity(0.48))
                .child(div().min_w_0().truncate().child(item.display.clone()))
                .children(item.extension.clone().map(|ext| {
                    // `.tree-label-extension` with its `· ` prefix.
                    div()
                        .flex_shrink_0()
                        .text_size(px(theme::ty().left.meta))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(t.subtle)
                        .child(format!("· {ext}"))
                })),
        );
        if let Some(error) = item.error.clone() {
            let retry = item.path.clone();
            row = row.child(
                div()
                    .flex()
                    .items_center()
                    .flex_shrink(1.)
                    .min_w_0()
                    .gap(px(6.))
                    .text_size(px(theme::ty().left.meta))
                    .child(
                        div()
                            .min_w_0()
                            .truncate()
                            .text_color(t.danger)
                            .child(SharedString::from(error)),
                    )
                    .child(
                        div()
                            .id(("tree-row-retry", index))
                            .flex_shrink_0()
                            .px(px(4.))
                            .rounded(px(metric::SIDEBAR_ROW_RADIUS))
                            .text_color(t.text)
                            .hover(move |d| d.bg(t.hover))
                            .cursor(theme::clickable_cursor())
                            .child(tr("common.action.retry"))
                            .on_click(cx.listener(move |s, _, _, cx| {
                                cx.stop_propagation();
                                if s.tree.set_expanded(&retry, true) {
                                    s.files.load_children(retry.clone(), &s.wake);
                                }
                                cx.notify();
                            })),
                    ),
            );
        }
        // `.tree-row-actions`: "+" on folders, then "⋮".
        if item.folder {
            let parent = item.path.clone();
            row = row.action(
                self.menu_trigger(
                    ("row-create-menu", index),
                    MenuAt::Row(item.path.clone(), RowTrigger::Create),
                    RowActionButton::new(("row-create", index), Icon::new("plus").stroke(2.))
                        .label(tr("workspace.node.createNew"))
                        .open(lit == Some(RowTrigger::Create)),
                    move |s, cx| {
                        let at = MenuAt::Row(parent.clone(), RowTrigger::Create);
                        s.open_create_menu(parent.clone(), at, cx)
                    },
                    cx,
                ),
            );
        }
        let path = item.path.clone();
        row = row.action(
            self.menu_trigger(
                ("row-more-menu", index),
                MenuAt::Row(item.path.clone(), RowTrigger::More),
                RowActionButton::more(("row-more", index))
                    .label(tr("workspace.node.moreActions"))
                    .open(lit == Some(RowTrigger::More)),
                move |s, cx| {
                    s.open_node_menu(index, MenuAt::Row(path.clone(), RowTrigger::More), cx)
                },
                cx,
            ),
        );

        let drag_paths = if self.tree.selection.contains(&item.path) {
            self.tree.selected_roots()
        } else {
            vec![item.path.clone()]
        };
        let drag_label: SharedString = if drag_paths.len() > 1 {
            tf(
                "workspace.node.copyItems",
                &[("count", drag_paths.len().into())],
            )
            .into()
        } else {
            item.name.clone().into()
        };
        let drop_target = if item.folder {
            item.path.clone()
        } else {
            parent_of(&item.path)
        };
        let import_target = drop_target.clone();
        row.on_click(
            cx.listener(move |s, e: &ClickEvent, w, cx| s.click_row(index, e.modifiers(), w, cx)),
        )
        .on_mouse_down(
            MouseButton::Right,
            cx.listener(move |s, e: &MouseDownEvent, _, cx| {
                cx.stop_propagation();
                s.open_node_menu(index, MenuAt::Pointer(e.position), cx)
            }),
        )
        .on_drag(
            DragNodes {
                paths: drag_paths,
                label: drag_label,
            },
            |drag, _, _, cx| cx.new(|_| drag.clone()),
        )
        .drag_over::<DragNodes>(move |s, _, _, _| s.bg(theme::alpha(t.accent, 0.18)))
        .drag_over::<ExternalPaths>(move |s, _, _, _| s.bg(theme::alpha(t.accent, 0.18)))
        .on_drop(cx.listener(move |s, drag: &DragNodes, w, cx| {
            let paths: Vec<PathBuf> = drag
                .paths
                .iter()
                .filter(|p| !drop_target.starts_with(p) && parent_of(p) != drop_target)
                .cloned()
                .collect();
            if !paths.is_empty() {
                s.run_op(FileOp::Move(paths, drop_target.clone()), w, cx)
            }
        }))
        .on_drop(cx.listener(move |s, paths: &ExternalPaths, w, cx| {
            s.run_op(
                FileOp::Import(paths.paths().to_vec(), import_target.clone()),
                w,
                cx,
            )
        }))
        .into_any_element()
    }
    /// The quiet "New" row after the last item; it opens the create menu for
    /// the workspace root, end aligned under the row.
    fn list_end_row(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let enabled = self.files.workspace.is_some() && self.preferences.read(cx).loaded;
        let row = SidebarRow::new("explorer-new")
            .variant(RowVariant::Launcher)
            .icon(Icon::new("plus").small().stroke(2.2).opacity(0.76))
            .label(tr("workspace.explorer.new"))
            .disabled(!enabled);
        if !enabled {
            return row.into_any_element();
        }
        self.menu_trigger(
            "explorer-new-menu",
            MenuAt::NewRow,
            row,
            |s, cx| s.open_create_menu(PathBuf::new(), MenuAt::NewRow, cx),
            cx,
        )
        .w_full()
        .into_any_element()
    }
    pub(super) fn click_row(
        &mut self,
        index: usize,
        modifiers: Modifiers,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(row) = self.tree.rows.get(index).cloned() else {
            return;
        };
        self.explorer.focus.focus(window, cx);
        if modifiers.platform || modifiers.shift {
            self.tree
                .select(&row.path, modifiers.platform, modifiers.shift);
            cx.notify();
            return;
        }
        self.tree.select(&row.path, false, false);
        self.open_row(index, window, cx);
    }
}
