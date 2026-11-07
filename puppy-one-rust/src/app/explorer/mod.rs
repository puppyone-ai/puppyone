//! Native Explorer: port of `shared-ui/data/ExplorerTree.tsx` with the row
//! actions and menus of `data-workspace/nodeActions.tsx`.
//!
//! Two entities. [`ExplorerSession`] is the model: the project's tree,
//! selection, clipboard, running operation, directory subscription and pins,
//! kept per project. [`Explorer`] is the view: it paints the session, holds
//! what only the view has (focus, the open menu, the disclosure motion, what
//! the shell shows it in [`Host`]), and turns pointer and keys into the
//! session's commands. The shell hands the session listings and outcomes,
//! hands the view its host when it changes, and acts on what each asks for
//! ([`SessionEvent`], [`ExplorerEvent`]).
//!
//! - [`session`]: the model
//! - [`rows`]: tree rows and the list-end "New" row, built from
//!   [`SidebarRow`](crate::ui::components::SidebarRow)
//! - [`menus`]: the create and node-action menus on GPUI Kit popovers
//! - [`pins`]: the pinned files above the tree
//! - [`keyboard`]: Explorer key bindings
//! - [`motion`]: the disclosure motion
use crate::{
    features::{
        create_new::create_entry_menu_registry::Entry,
        settings::{
            preference_types::{ExplorerPins, FilesVisibility},
            preferences_store::{PreferencesStore, observe_slice},
        },
    },
    geometry::Rect,
    localization::t as tr,
    theme::{self, Theme, metric},
    ui::appearance::ActiveAppearance,
};
use gpui::{prelude::*, *};
use std::path::{Path, PathBuf};

mod keyboard;
mod menus;
mod motion;
mod pins;
mod rows;
mod session;

pub use keyboard::bind_keys;
use menus::ExplorerMenu;
pub(super) use menus::{MenuAt, RowTrigger};
pub(in crate::app) use rows::DragNodes;
use session::FileOp;
pub(in crate::app) use session::{Activation, ExplorerSession, FileClipboard, SessionEvent};

/// The project's Explorer: its session (the tree, selection, clipboard and
/// pins, kept per project) and its view in the left column.
pub(in crate::app) struct ExplorerPane {
    pub session: Entity<ExplorerSession>,
    pub view: Entity<Explorer>,
}

/// What the Explorer reads from the shell, pushed when it changes.
#[derive(Clone, Debug, Default, PartialEq)]
pub(in crate::app) struct Host {
    /// The panel in window coordinates, at its open width: it keeps it
    /// while its frame moves or a drag narrows it.
    pub frame: Rect,
    /// The pane is open: rows animate only then.
    pub open: bool,
    /// The document in the editor, workspace-relative.
    pub opened: Option<PathBuf>,
    pub open_resources: Vec<PathBuf>,
    /// A document switch, save or close is in flight.
    pub documents_busy: bool,
    /// A folder listing is loading.
    pub folder_busy: bool,
    /// The folder picker is open.
    pub picking: bool,
}

/// What the Explorer reads from the preferences while it paints and acts:
/// a write to anything else does not render it again.
#[derive(PartialEq)]
struct PaintedPreferences {
    loaded: bool,
    files: FilesVisibility,
    file_icon_theme: String,
    show_file_icons: bool,
    create_new: crate::features::create_new::create_entry_menu_registry::MenuSettings,
    puppy_flow_files: bool,
    cloud_workspace: bool,
    share_onboarding: bool,
    agent_file_activity_indicators: bool,
    explorer_pins: std::collections::BTreeMap<String, ExplorerPins>,
}
impl PaintedPreferences {
    fn of(store: &PreferencesStore) -> Self {
        let p = &store.state;
        Self {
            loaded: store.loaded,
            files: p.files.clone(),
            file_icon_theme: p.file_icon_theme.clone(),
            show_file_icons: p.show_file_icons,
            create_new: p.create_new.clone(),
            puppy_flow_files: p.experimental.puppy_flow_files,
            cloud_workspace: p.experimental.cloud_workspace,
            share_onboarding: p.experimental.share_onboarding,
            agent_file_activity_indicators: p.agent_file_activity_indicators,
            explorer_pins: p.explorer_pins.clone(),
        }
    }
}

/// What the person asked of the shell through the Explorer.
#[derive(Clone, Debug, PartialEq)]
pub(in crate::app) enum ExplorerEvent {
    /// Open a workspace file in the editor.
    Open(PathBuf),
    /// The create form for `entry` in `parent`.
    Create { entry: Entry, parent: PathBuf },
    /// The rename (or change file type) dialog for `path`.
    Rename { path: PathBuf, change_type: bool },
    /// Cloud Explorer "Copy Link": the hosted resource URL of `path`.
    CopyLink { path: PathBuf, folder: bool },
    /// "Share with…" on a folder: the share starts from `path`.
    Share { path: PathBuf },
    /// A notice.
    Error(String),
}

pub(in crate::app) struct Explorer {
    session: Entity<ExplorerSession>,
    preferences: Entity<PreferencesStore>,
    /// The window whose terminals' Agent file activity rows show.
    presence_owner: String,
    host: Host,
    weak: WeakEntity<Self>,
    focus: FocusHandle,
    /// The open create or node-action menu.
    menu: Option<ExplorerMenu>,
    /// The tree the view last showed: a new one (another project) closes
    /// the menu.
    shown_tree: u64,
    /// The disclosure motion of the visible rows.
    motion: motion::TreeMotion,
    #[cfg(test)]
    pub painted_rows: usize,
    /// Times the Explorer rendered (it is a cached view in the shell).
    #[cfg(test)]
    pub renders: usize,
}
impl EventEmitter<ExplorerEvent> for Explorer {}
impl Focusable for Explorer {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

fn parent_of(path: &Path) -> PathBuf {
    path.parent().unwrap_or(Path::new("")).to_owned()
}

impl Explorer {
    /// The view of `session`.
    pub fn new(
        session: Entity<ExplorerSession>,
        preferences: Entity<PreferencesStore>,
        cx: &mut Context<Self>,
    ) -> Self {
        // Only the preferences it paints and acts with render it again.
        observe_slice(
            &preferences,
            PaintedPreferences::of,
            |_: &mut Self, _, cx| cx.notify(),
            cx,
        )
        .detach();
        cx.observe(&session, |s, session, cx| {
            let tree = session.read(cx).tree().id;
            if std::mem::replace(&mut s.shown_tree, tree) != tree {
                s.menu = None;
            }
            cx.notify()
        })
        .detach();
        if let Some(presence) = crate::features::agent_presence::store(cx) {
            cx.observe(&presence, |_, _, cx| cx.notify()).detach();
        }
        let shown_tree = session.read(cx).tree().id;
        Self {
            session,
            preferences,
            presence_owner: String::new(),
            host: Host::default(),
            weak: cx.weak_entity(),
            focus: cx.focus_handle(),
            menu: None,
            shown_tree,
            motion: motion::TreeMotion::default(),
            #[cfg(test)]
            painted_rows: 0,
            #[cfg(test)]
            renders: 0,
        }
    }
    /// The owner window (`agent_presence::owner`).
    pub fn with_presence_owner(mut self, owner: String) -> Self {
        self.presence_owner = owner;
        self
    }
    /// What the shell holds that the Explorer shows: pushed when it changes
    /// (a document opens, a pane opens or closes, the window resizes), not
    /// every frame. Only a change renders the Explorer again.
    pub fn set_host(&mut self, host: Host, cx: &mut Context<Self>) {
        if self.host != host {
            self.host = host;
            cx.notify();
        }
    }
    /// The disclosure motion's frame: the visible rows are committed to it,
    /// and while it runs the Explorer asks for the next frame (its own: a
    /// cached view renders again only when notified).
    fn advance_motion(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let animate = self.host.open && !cx.reduce_motion();
        let tree = self.session.read(cx).tree();
        let moving = self.motion.sync(
            tree.id,
            tree.revision,
            &tree.rows,
            theme::sidebar_stride(),
            animate,
        );
        if moving {
            window.request_animation_frame();
        }
    }
    /// Closes the open menu; `false` when none was open.
    pub fn dismiss_menu(&mut self, cx: &mut Context<Self>) -> bool {
        let open = self.menu.take().is_some();
        if open {
            cx.notify();
        }
        open
    }
    /// `onActivate`: a folder opens or closes, a file opens in the editor.
    /// Nothing opens while the documents or the folder picker are busy.
    pub fn open_row(&mut self, index: usize, cx: &mut Context<Self>) {
        let host = self.host.clone();
        let activated = self
            .session
            .update(cx, |s, cx| s.activate(index, &host, cx));
        if let Some(Activation::File(path)) = activated {
            cx.emit(ExplorerEvent::Open(path));
        }
    }
    /// Delete asks first (`confirmDelete`), then runs on the session.
    fn confirm_delete(&mut self, paths: Vec<PathBuf>, window: &mut Window, cx: &mut Context<Self>) {
        use crate::localization::tf;
        if paths.is_empty() {
            return;
        }
        let message = if paths.len() == 1 {
            tf(
                "workspace.node.confirmDeleteOne",
                &[(
                    "name",
                    paths[0]
                        .file_name()
                        .map(|n| n.to_string_lossy().into_owned())
                        .unwrap_or_default()
                        .into(),
                )],
            )
        } else {
            tf(
                "workspace.node.confirmDeleteMany",
                &[("count", paths.len().into())],
            )
        };
        let delete = tf(
            "workspace.node.deleteItems",
            &[("count", paths.len().into())],
        );
        let answer = window.prompt(
            PromptLevel::Warning,
            &message,
            None,
            &[delete.as_str(), tr("common.action.cancel")],
            cx,
        );
        let session = self.session.downgrade();
        cx.spawn_in(window, async move |_, cx| {
            if answer.await == Ok(0) {
                let _ = session.update(cx, |s, cx| s.run_op(FileOp::Delete(paths), cx));
            }
        })
        .detach();
    }
}

/// Dev-capture scenario steps (`PUPPYONE_CAPTURE_SCENARIO`).
#[cfg(feature = "dev-capture")]
impl Explorer {
    /// The Custom files submenu opens without a hover.
    pub fn capture_open_submenu(&mut self, cx: &mut Context<Self>) {
        if let Some(menu) = &mut self.menu {
            menu.submenu_open = true;
            cx.notify();
        }
    }
    /// The tree row under a window point (rows stack from the list's 12px
    /// top padding, one stride each).
    pub fn row_at(&self, position: Point<Pixels>, cx: &App) -> Option<usize> {
        let (x, y) = (f32::from(position.x), f32::from(position.y));
        let list = self.host.frame;
        if x < list.x || x >= list.right() {
            return None;
        }
        let session = self.session.read(cx);
        let offset = f32::from(session.scroll().0.borrow().base_handle.offset().y);
        let row = (y - list.y - 12. - offset) / theme::sidebar_stride();
        (row >= 0.)
            .then_some(row as usize)
            .filter(|index| *index < session.tree().rows.len())
    }
}
/// Tests look inside.
#[cfg(test)]
impl Explorer {
    pub fn menu(&self) -> Option<&ExplorerMenu> {
        self.menu.as_ref()
    }
    pub fn motion(&self) -> &motion::TreeMotion {
        &self.motion
    }
}

impl Render for Explorer {
    /// The panel: the virtual tree with its drop target, context menu and the
    /// fade into the footer.
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        crate::platform::watchdog::activity("explorer.render");
        #[cfg(test)]
        {
            self.renders += 1;
            self.painted_rows = 0;
        }
        self.advance_motion(window, cx);
        let t = cx.palette();
        let session = self.session.read(cx);
        let rows = session.tree().rows.len();
        let listed = session.workspace().is_some();
        let loading = rows == 0 && (self.host.folder_busy || self.host.picking);
        let empty = rows == 0 && !loading && listed;
        let operation_error = session.operation_error().cloned().filter(|_| !loading);
        let count = rows + usize::from(listed || session.fixture());
        let scroll = session.scroll().clone();
        let pins = session.pins(cx);
        let pinned = !pins.files.is_empty();
        let folded = pinned && pins.files_collapsed;
        let tree = div()
            .id("explorer-tree")
            .flex_1()
            .min_h_0()
            .track_focus(&self.focus)
            .key_context(keyboard::CONTEXT)
            .on_mouse_down(
                MouseButton::Right,
                cx.listener(|s, e: &MouseDownEvent, _, cx| {
                    // `onExplorerRootContextMenu`: create at the pointer.
                    s.open_create_menu(PathBuf::new(), MenuAt::Pointer(e.position), cx)
                }),
            )
            .drag_over::<rows::DragNodes>(move |s, _, _, _| s.bg(theme::alpha(t.accent, 0.05)))
            .drag_over::<ExternalPaths>(move |s, _, _, _| s.bg(theme::alpha(t.accent, 0.05)))
            .on_drop(cx.listener(|s, drag: &rows::DragNodes, _, cx| {
                s.session.update(cx, |session, cx| {
                    if drag.belongs_to(&session.workspace().cloned()) {
                        session.move_into(&drag.paths, Path::new(""), cx)
                    }
                })
            }))
            .on_drop(cx.listener(|s, paths: &ExternalPaths, _, cx| {
                let import = FileOp::Import(paths.paths().to_vec(), PathBuf::new());
                s.session
                    .update(cx, |session, cx| session.run_op(import, cx))
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
                // The fold line already separates the pins from the first file.
                .pt(px(if pinned { 2. } else { 12. }))
                .pb(px(6.))
                .px(px(metric::SIDEBAR_ROW_LEFT_GAP))
                .track_scroll(&scroll),
            );
        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(t.sidebar)
            .when(pinned, |d| d.child(self.pins_view(&pins, cx)))
            .children(
                operation_error
                    .clone()
                    .filter(|_| !folded)
                    .map(|error| self.operation_error_banner(error, empty, t, cx)),
            )
            .when(
                (loading || empty) && operation_error.is_none() && !folded,
                |d| {
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
                },
            )
            // Folded away under the pins, the tree keeps its place.
            .child(
                self.on_explorer_actions(tree, cx)
                    .when(folded, |d| d.invisible()),
            )
            .when(theme::footer() > 0. && !folded, |d| {
                d.child(self.tree_bottom_fade(t, cx))
            })
            .child(crate::ui::scrollbar::vertical(
                "explorer-scrollbar",
                &scroll,
            ))
            .children(self.context_menu(cx))
    }
}
impl Explorer {
    /// `.explorer-tree-error-banner` above a tree with rows, or the root meta
    /// row of an empty tree: the failed import or move with its Retry.
    fn operation_error_banner(
        &self,
        error: SharedString,
        empty: bool,
        t: Theme,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let retry = div()
            .id("explorer-operation-retry")
            .flex_shrink_0()
            .ml(px(8.))
            .text_color(t.text)
            .cursor(theme::clickable_cursor())
            .child(tr("common.action.retry"))
            .on_click(cx.listener(|s, _, _, cx| {
                cx.stop_propagation();
                s.session.update(cx, |session, cx| session.retry_root(cx));
            }));
        let text = div().min_w_0().child(error);
        if empty {
            // `ExplorerTreeMetaRow depth={0}` with `role="alert"`.
            return div()
                .flex()
                .items_center()
                .px(px(
                    metric::SIDEBAR_ROW_LEFT_GAP + metric::TREE_ROW_CONTENT_LEFT
                ))
                .pt(px(12.))
                .text_size(px(theme::ty().left.meta))
                .text_color(t.danger)
                .child(text)
                .child(retry)
                .into_any_element();
        }
        div()
            .id("explorer-operation-error")
            .flex()
            .flex_none()
            .items_start()
            .mt(px(6.))
            .mb(px(4.))
            .ml(px(metric::SIDEBAR_ROW_LEFT_GAP))
            .mr(px(metric::SIDEBAR_ROW_RIGHT_GAP))
            .px(px(8.))
            .py(px(6.))
            .border_1()
            .border_color(theme::alpha(t.danger, 0.24))
            .rounded(px(metric::SIDEBAR_ROW_RADIUS))
            .bg(theme::mix(t.danger, t.sidebar, 0.08))
            .text_color(t.danger)
            .text_size(px(theme::ty().left.meta))
            .line_height(relative(1.4))
            .child(text.flex_1())
            .child(retry)
            .into_any_element()
    }
    /// `.explorer-tree-shell::after` with the navigation at the bottom: while rows
    /// remain below the viewport the tree fades into the footer, which has no
    /// divider. Read at paint time so the fade follows every scroll frame.
    fn tree_bottom_fade(&self, t: Theme, cx: &App) -> impl IntoElement {
        let scroll = self.session.read(cx).scroll().clone();
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

#[cfg(test)]
mod tests;
