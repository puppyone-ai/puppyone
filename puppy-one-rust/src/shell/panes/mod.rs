//! The side panes around the editor: the Explorer at the start and the right
//! sidebar at the end (`useDesktopExplorerFrame`, `useCollapsiblePaneResize`,
//! `CollapsiblePaneFrame`).
//!
//! [`Panes`] owns which pane is open, how wide each is, what the right
//! sidebar shows, an edge drag in progress and the frames' open / close
//! motion. The shell sends it commands and pointer events, stores what it
//! commits, and paints the [`PaneFrame`] it hands out each frame; nothing
//! else touches pane widths.
//!
//! - [`layout`]: the width policy and the window rectangles
//! - [`gesture`]: the edge drag state machine (`collapsiblePaneGesture.ts`)
//! - [`motion`]: the frames' open / close motion
mod gesture;
pub(super) mod layout;
mod motion;

use crate::{geometry::Rect, theme::pane};
use gesture::{Commit, Config, Gesture, Phase};
use gpui::{Pixels, Point};

pub(super) use gesture::Side;
pub(super) use layout::Layout;
pub(super) use motion::PaneFrame;

/// One side pane: whether it is open, and its width.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct SidePane {
    pub open: bool,
    /// The expanded width, kept while the pane is closed.
    pub width: f32,
}
impl SidePane {
    /// The width it takes in the window: nothing while closed.
    fn extent(self) -> f32 {
        if self.open { self.width } else { 0. }
    }
}

/// What the right sidebar shows.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) enum RightContent {
    /// The auxiliary workbench: Agent chats and terminals.
    #[default]
    Workbench,
    /// Changes (source control), opened from the Header.
    Changes,
}

/// The pane layout as stored (`sidebarCollapsed`, `explorerWidth`,
/// `rightSidebarWidth`): one preference for every window.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct StoredPanes {
    pub explorer_collapsed: bool,
    pub explorer_width: f32,
    pub right_width: f32,
}

/// An edge drag in progress: the gesture and the rules it runs under.
#[derive(Clone, Copy, Debug)]
struct Drag {
    config: Config,
    gesture: Gesture,
}

pub(super) struct Panes {
    explorer: SidePane,
    right: SidePane,
    content: RightContent,
    drag: Option<Drag>,
    motion: motion::PaneMotion,
    /// The native window minimum last handed out.
    window_minimum: f32,
}

impl Panes {
    /// Both panes at their default widths: the Explorer open, the right
    /// sidebar open on `content` when `right_open`.
    pub fn new(right_open: bool, content: RightContent) -> Self {
        Self {
            explorer: SidePane {
                open: true,
                width: pane::DEFAULT_EXPLORER_WIDTH,
            },
            right: SidePane {
                open: right_open,
                width: pane::DEFAULT_RIGHT_SIDEBAR_WIDTH,
            },
            content,
            drag: None,
            motion: Default::default(),
            window_minimum: 0.,
        }
    }
    pub fn explorer(&self) -> SidePane {
        self.explorer
    }
    pub fn right(&self) -> SidePane {
        self.right
    }
    pub fn pane(&self, side: Side) -> SidePane {
        match side {
            Side::Start => self.explorer,
            Side::End => self.right,
        }
    }
    fn pane_mut(&mut self, side: Side) -> &mut SidePane {
        match side {
            Side::Start => &mut self.explorer,
            Side::End => &mut self.right,
        }
    }
    /// What the right sidebar shows (or shows when it reopens).
    pub fn content(&self) -> RightContent {
        self.content
    }
    /// The right sidebar is open on `content`.
    pub fn shows(&self, content: RightContent) -> bool {
        self.right.open && self.content == content
    }

    // ------------------------------------------------------------ commands
    /// ⌘B and the Header's expand button.
    pub fn toggle_explorer(&mut self) {
        self.explorer.open = !self.explorer.open;
    }
    /// ⌘J and the Header's Agent entry: from Changes, switch to the
    /// workbench; otherwise open or close the sidebar on it.
    pub fn toggle_workbench(&mut self) {
        self.right.open = self.content == RightContent::Changes || !self.right.open;
        self.content = RightContent::Workbench;
    }
    /// The Header's Changes: open the sidebar on Changes, or close it when it
    /// already shows them (it then reopens on the workbench). Returns whether
    /// Changes show now.
    pub fn toggle_changes(&mut self) -> bool {
        let show = !self.shows(RightContent::Changes);
        self.right.open = show;
        self.content = if show {
            RightContent::Changes
        } else {
            RightContent::Workbench
        };
        show
    }
    /// Dev-capture surfaces open the right sidebar directly.
    #[cfg(feature = "dev-capture")]
    pub fn open_right(&mut self) {
        self.right.open = true;
    }

    // ------------------------------------------------------- stored layout
    pub fn stored(&self) -> StoredPanes {
        StoredPanes {
            explorer_collapsed: !self.explorer.open,
            explorer_width: self.explorer.width,
            right_width: self.right.width,
        }
    }
    /// The stored layout arriving: the starting state, shown without motion.
    /// The shell stores its own changes first, so a difference here is the
    /// stored layout, not an echo of a toggle.
    pub fn restore(&mut self, stored: StoredPanes) {
        if stored != self.stored() {
            self.explorer.open = !stored.explorer_collapsed;
            self.explorer.width = stored.explorer_width;
            self.right.width = stored.right_width;
            self.motion = Default::default();
        }
    }

    // ----------------------------------------------------------- edge drag
    /// The side whose edge is being dragged.
    pub fn dragging(&self) -> Option<Side> {
        self.drag.map(|drag| drag.config.side)
    }
    /// A press on `side`'s edge at `point`. `available` is the width the
    /// panes share (the window, less the project rail); it bounds how wide
    /// the dragged pane can get beside the main pane floor.
    pub fn begin_drag(&mut self, side: Side, point: Point<Pixels>, available: f32) {
        let config = match side {
            Side::Start => Config::new(
                side,
                pane::MIN_EXPLORER_WIDTH,
                layout::explorer_max_width(available, self.right.open),
                pane::EXPLORER_COLLAPSE_THRESHOLD,
            ),
            Side::End => Config::new(
                side,
                pane::MIN_RIGHT_SIDEBAR_WIDTH,
                layout::right_sidebar_max_width(available, self.explorer.extent()),
                pane::RIGHT_SIDEBAR_COLLAPSE_THRESHOLD,
            ),
        };
        let pane = self.pane(side);
        let gesture = Gesture::begin(&config, coordinates(point), !pane.open, pane.width);
        self.drag = Some(Drag { config, gesture });
    }
    /// The pointer moved: only the preview changes. `false` with no drag.
    pub fn move_drag(&mut self, point: Point<Pixels>) -> bool {
        let Some(drag) = &mut self.drag else {
            return false;
        };
        drag.gesture = drag.gesture.moved_to(&drag.config, coordinates(point));
        true
    }
    /// Ends the drag: a release (`commit`) applies the gesture once, Escape
    /// or losing the window rolls the preview back. `None` with no drag,
    /// else whether the committed layout changed (and needs storing).
    pub fn end_drag(&mut self, commit: bool) -> Option<bool> {
        let drag = self.drag.take()?;
        let result = if commit {
            drag.gesture.finish(&drag.config)
        } else {
            None
        };
        let pane = self.pane_mut(drag.config.side);
        match result {
            Some(Commit::Collapse { restore_width }) => {
                pane.width = restore_width;
                pane.open = false;
            }
            Some(Commit::Expand { width }) => {
                pane.width = width;
                pane.open = true;
            }
            Some(Commit::Resize { width }) => pane.width = width,
            None => {}
        }
        Some(result.is_some())
    }

    // --------------------------------------------------------------- frames
    /// The panes as the window shows them now: committed, or previewed by a
    /// drag.
    fn preview(&self) -> (SidePane, SidePane) {
        let mut panes = (self.explorer, self.right);
        if let Some(drag) = &self.drag {
            let preview = match drag.config.side {
                Side::Start => &mut panes.0,
                Side::End => &mut panes.1,
            };
            preview.open = !drag.gesture.preview_collapsed;
            if preview.open {
                preview.width = drag.gesture.preview_width;
            }
        }
        panes
    }
    /// What to paint in a `w`×`h` window beside a `rail` wide project rail,
    /// advancing the open / close motion. An edge drag follows the pointer;
    /// opening and closing a pane (a toggle, or a drag crossing its collapse
    /// threshold) moves its frame, unless the system asks for reduced motion.
    pub fn frame(&mut self, w: f32, h: f32, rail: f32, reduce_motion: bool) -> PaneFrame {
        let (explorer, right) = self.preview();
        let target = Layout::new(w, h, explorer.extent(), right.extent(), rail);
        let animate = !reduce_motion
            && self
                .drag
                .is_none_or(|drag| drag.gesture.phase != Phase::Resizing);
        let mut frame = self
            .motion
            .frame((explorer.open, right.open), target, animate);
        // Shrinking the Explorer clips its content at the committed width
        // instead of reflowing it at every pointer sample.
        if self.dragging() == Some(Side::Start)
            && frame.left_clip.is_none()
            && explorer.open
            && self.explorer.open
            && explorer.width < self.explorer.width
        {
            let pane = frame.layout.explorer;
            frame.left_clip = Some(Rect::new(
                pane.x,
                pane.y,
                pane.w,
                frame.layout.footer.bottom() - pane.y,
            ));
            frame.layout.explorer.w = self.explorer.width;
            frame.layout.footer.w = self.explorer.width;
        }
        frame
    }
    /// `window-layout:set-minimum-width`: the native window minimum for the
    /// committed panes beside a `rail` wide project rail, when it changed
    /// since the last call.
    pub fn take_window_minimum(&mut self, rail: f32) -> Option<f32> {
        let minimum = layout::window_minimum_width(self.explorer.open, self.right.open, rail);
        (minimum != self.window_minimum).then(|| {
            self.window_minimum = minimum;
            minimum
        })
    }
    #[cfg(test)]
    pub fn window_minimum(&self) -> f32 {
        self.window_minimum
    }
}

fn coordinates(point: Point<Pixels>) -> (f32, f32) {
    (f32::from(point.x), f32::from(point.y))
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use gpui::{point, px};

    #[test]
    fn the_header_entries_switch_and_close_the_right_sidebar() {
        let mut panes = Panes::new(false, RightContent::Workbench);
        // Changes opens on Changes; the Agent entry then switches to the
        // workbench without closing; the Agent entry again closes.
        assert!(panes.toggle_changes());
        assert!(panes.shows(RightContent::Changes));
        panes.toggle_workbench();
        assert!(panes.shows(RightContent::Workbench));
        panes.toggle_workbench();
        assert!(!panes.right().open);
        // Changes twice: open on Changes, then closed, reopening on the
        // workbench.
        assert!(panes.toggle_changes());
        assert!(!panes.toggle_changes());
        assert!(!panes.right().open);
        assert_eq!(panes.content(), RightContent::Workbench);
    }

    #[test]
    fn a_drag_commits_on_release_and_rolls_back_on_cancel() {
        let mut panes = Panes::new(false, RightContent::Workbench);
        let at = |x: f32| point(px(x), px(400.));
        panes.begin_drag(Side::Start, at(320.), 1280.);
        assert!(panes.move_drag(at(280.)));
        // The preview moves; the committed width does not.
        assert_eq!(panes.frame(1280., 800., 0., true).layout.editor.x, 280.);
        assert_eq!(panes.explorer().width, 320.);
        assert_eq!(panes.end_drag(true), Some(true));
        assert_eq!(
            panes.explorer(),
            SidePane {
                open: true,
                width: 280.
            }
        );
        // Cancelled: nothing changes, nothing to store.
        panes.begin_drag(Side::Start, at(280.), 1280.);
        panes.move_drag(at(40.));
        assert_eq!(panes.frame(1280., 800., 0., true).layout.editor.x, 0.);
        assert_eq!(panes.end_drag(false), Some(false));
        assert_eq!(
            panes.explorer(),
            SidePane {
                open: true,
                width: 280.
            }
        );
        assert_eq!(panes.end_drag(true), None);
    }

    #[test]
    fn the_stored_layout_round_trips_and_arrives_without_motion() {
        let mut panes = Panes::new(false, RightContent::Workbench);
        panes.frame(1280., 800., 0., false);
        let stored = StoredPanes {
            explorer_collapsed: true,
            explorer_width: 260.,
            right_width: 400.,
        };
        panes.restore(stored);
        assert_eq!(panes.stored(), stored);
        let frame = panes.frame(1280., 800., 0., false);
        assert!(!frame.running);
        assert_eq!(frame.layout.editor.x, 0.);
        // A toggle afterwards does move.
        panes.toggle_explorer();
        assert!(panes.frame(1280., 800., 0., false).running);
    }

    #[test]
    fn the_window_minimum_is_handed_out_once_per_change() {
        let mut panes = Panes::new(false, RightContent::Workbench);
        assert_eq!(panes.take_window_minimum(0.), Some(640.));
        assert_eq!(panes.take_window_minimum(0.), None);
        panes.toggle_workbench();
        assert_eq!(panes.take_window_minimum(0.), Some(868.));
    }
}
