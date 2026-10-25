//! Native Explorer: port of `shared-ui/data/ExplorerTree.tsx`, the row actions
//! and menus of `data-workspace/nodeActions.tsx`, and the sidebar footer
//! navigation (`DesktopSidebarFooterNavigation`).
//!
//! - [`rows`]: tree rows and the list-end "New" row, built from
//!   [`SidebarRow`](crate::ui::components::SidebarRow)
//! - [`menus`]: the create and node-action menus on GPUI Kit popovers
//! - [`file_ops`]: rename, move, copy, import and delete on a worker
//! - [`rename`]: the rename / change file type dialog
//! - [`keyboard`]: Explorer key bindings
//! - [`footer`]: Settings and Help
use super::*;
use crate::{localization::t as tr, theme::metric, ui::appearance::ActiveAppearance};
use std::{path::Path, sync::mpsc};

mod file_ops;
mod footer;
mod keyboard;
mod menus;
pub(super) mod motion;
mod rename;
mod rows;

pub(super) use file_ops::{FileClipboard, FileOp, OpOutcome};
pub use keyboard::bind_keys;
pub(super) use menus::ExplorerMenu;
#[cfg(any(test, feature = "dev-capture"))]
pub(super) use menus::{MenuAt, RowTrigger};
pub(super) use rename::Rename;

/// Explorer state held by the shell.
pub(super) struct Explorer {
    pub focus: FocusHandle,
    pub scroll: UniformListScrollHandle,
    pub clipboard: Option<FileClipboard>,
    /// The open create or node-action menu.
    pub menu: Option<ExplorerMenu>,
    /// The running file operation.
    pub op: Option<mpsc::Receiver<OpOutcome>>,
    /// An operation waiting for the open document to close first.
    pub queued_op: Option<FileOp>,
    /// The document to reopen at its new path once the operation lands.
    pub reopen: Option<PathBuf>,
    /// The disclosure motion of the visible rows.
    pub motion: motion::TreeMotion,
}
impl Explorer {
    pub fn new(cx: &mut App) -> Self {
        Self {
            focus: cx.focus_handle(),
            scroll: UniformListScrollHandle::new(),
            clipboard: None,
            menu: None,
            op: None,
            queued_op: None,
            reopen: None,
            motion: motion::TreeMotion::default(),
        }
    }
}

fn parent_of(path: &Path) -> PathBuf {
    path.parent().unwrap_or(Path::new("")).to_owned()
}

impl Shell {
    /// Commits the visible rows to the disclosure motion and keeps frames
    /// coming while it runs. Called once per frame before the tree paints.
    pub(super) fn advance_tree_motion(&mut self, window: &mut Window, cx: &App) {
        let animate = self.panes.explorer().open && !cx.reduce_motion();
        if self.explorer.motion.sync(
            self.tree.id,
            self.tree.revision,
            &self.tree.rows,
            theme::sidebar_stride(),
            animate,
        ) {
            window.request_animation_frame();
        }
    }
    /// The Explorer panel: the virtual tree with its drop target, context
    /// menu and the fade into the footer.
    pub(super) fn explorer(&self, cx: &mut Context<Self>) -> Div {
        let t = cx.palette();
        let loading = self.tree.rows.is_empty() && (self.files.folder_busy || self.pending);
        let empty = self.tree.rows.is_empty() && !loading && self.files.workspace.is_some();
        let count =
            self.tree.rows.len() + usize::from(self.files.workspace.is_some() || self.fixture);
        let tree = div()
            .id("explorer-tree")
            .flex_1()
            .min_h_0()
            .track_focus(&self.explorer.focus)
            .key_context(keyboard::CONTEXT)
            .on_mouse_down(
                MouseButton::Right,
                cx.listener(|s, e: &MouseDownEvent, _, cx| {
                    // `onExplorerRootContextMenu`: create at the pointer.
                    s.open_create_menu(PathBuf::new(), menus::MenuAt::Pointer(e.position), cx)
                }),
            )
            .drag_over::<rows::DragNodes>(move |s, _, _, _| s.bg(theme::alpha(t.accent, 0.05)))
            .drag_over::<ExternalPaths>(move |s, _, _, _| s.bg(theme::alpha(t.accent, 0.05)))
            .on_drop(cx.listener(|s, drag: &rows::DragNodes, w, cx| {
                let paths: Vec<PathBuf> = drag
                    .paths
                    .iter()
                    .filter(|p| !parent_of(p).as_os_str().is_empty())
                    .cloned()
                    .collect();
                if !paths.is_empty() {
                    s.run_op(FileOp::Move(paths, PathBuf::new()), w, cx)
                }
            }))
            .on_drop(cx.listener(|s, paths: &ExternalPaths, w, cx| {
                s.run_op(
                    FileOp::Import(paths.paths().to_vec(), PathBuf::new()),
                    w,
                    cx,
                )
            }))
            .child(
                uniform_list(
                    "explorer",
                    count,
                    cx.processor(move |s, range: std::ops::Range<usize>, _, cx| {
                        #[cfg(test)]
                        {
                            s.painted_rows += range.len();
                        }
                        // The first row in view also paints the ghosts of
                        // rows that just went away.
                        let first = range.start;
                        range
                            .map(|index| s.explorer_row(index, index == first, cx))
                            .collect::<Vec<_>>()
                    }),
                )
                .size_full()
                .pt(px(12.))
                .pb(px(6.))
                .px(px(metric::SIDEBAR_ROW_LEFT_GAP))
                .track_scroll(&self.explorer.scroll),
            );
        at(self.layout.explorer)
            .flex()
            .flex_col()
            .bg(t.sidebar)
            .when(loading || empty, |d| {
                d.child(
                    div()
                        .px(px(
                            metric::SIDEBAR_ROW_LEFT_GAP + metric::TREE_ROW_CONTENT_LEFT
                        ))
                        .pt(px(12.))
                        .text_size(px(theme::ty().left.meta))
                        .text_color(t.subtle)
                        .child(tr(if loading {
                            "shared-ui.explorer.loadingWorkspace"
                        } else {
                            "shared-ui.explorer.emptyFolder"
                        })),
                )
            })
            .child(self.on_explorer_actions(tree, cx))
            .child(self.tree_bottom_fade(t))
            .children(self.context_menu(cx))
    }
    /// `.explorer-tree-shell::after` with the navigation at the bottom: while rows
    /// remain below the viewport the tree fades into the footer, which has no
    /// divider. Read at paint time so the fade follows every scroll frame.
    fn tree_bottom_fade(&self, t: Theme) -> impl IntoElement {
        let scroll = self.explorer.scroll.clone();
        let sidebar = t.sidebar;
        canvas(
            |_, _, _| {},
            move |bounds, _, window, _| {
                let fade = {
                    let state = scroll.0.borrow();
                    let (offset, max) =
                        (state.base_handle.offset(), state.base_handle.max_offset());
                    bottom_fade(f32::from(offset.y), f32::from(max.y))
                };
                if fade <= 0. {
                    return;
                }
                // linear-gradient(to top, sidebar 0%, sidebar/78% 46%, transparent 100%)
                // at height 18px x fade and opacity fade. GPUI gradients have two stops,
                // so the curve is two quads joined on a device-pixel row.
                let scale = window.scale_factor();
                let bottom = f32::from(bounds.bottom());
                let top = bottom - metric::SIDEBAR_NAVIGATION_FADE_SIZE * fade;
                let mid = ((bottom - (bottom - top) * 0.46) * scale).round() / scale;
                let left = bounds.origin.x;
                let width = bounds.size.width;
                let band = |from: f32, to: f32, y0: f32, y1: f32| {
                    fill(
                        Bounds::new(point(left, px(y0)), size(width, px(y1 - y0))),
                        linear_gradient(
                            0.,
                            linear_color_stop(theme::alpha(sidebar, from * fade), 0.),
                            linear_color_stop(theme::alpha(sidebar, to * fade), 1.),
                        ),
                    )
                };
                window.paint_quad(band(1., 0.78, mid, bottom));
                window.paint_quad(band(0.78, 0., top, mid));
            },
        )
        .absolute()
        .left_0()
        .right_0()
        .bottom_0()
        .h(px(metric::SIDEBAR_NAVIGATION_FADE_SIZE))
    }
}
/// `useScrollEdgeState` bottom fade: the remaining scroll over a 24px distance,
/// zero unless the list overflows by more than 1px. `offset_y` is GPUI's
/// (non-positive) scroll offset, `max_y` the maximum scroll distance.
pub(super) fn bottom_fade(offset_y: f32, max_y: f32) -> f32 {
    const FADE_DISTANCE: f32 = 24.;
    const OVERFLOW_THRESHOLD: f32 = 1.;
    if max_y <= OVERFLOW_THRESHOLD {
        return 0.;
    }
    let scroll_top = (-offset_y).clamp(0., max_y);
    ((max_y - scroll_top) / FADE_DISTANCE).clamp(0., 1.)
}
