//! The side panes around the editor: the Explorer at the start and the right
//! sidebar at the end (`useDesktopExplorerFrame`, `useCollapsiblePaneResize`,
//! `CollapsiblePaneFrame`, `SidebarResizeHandle`).
//!
//! [`PaneLayout`] is the window's pane entity. It owns which pane is open
//! and how wide each is, an edge drag in progress, the keyboard resize of
//! an edge, and the frames' open / close motion (what the right sidebar shows
//! is [`super::right_sidebar`]'s). It takes its own input — the edges'
//! pointer and keys, Escape and the window losing focus during a drag — and
//! tells its owner what happened ([`PaneEvent`]): the shell stores a
//! committed layout and keeps the window minimum; nothing else touches pane
//! widths.
//!
//! - [`layout`]: the width policy and the window rectangles
//! - [`gesture`]: the edge drag state machine (`collapsiblePaneGesture.ts`)
//! - [`motion`]: the frames' open / close motion
//! - [`stack`]: the frames under the editor and the edges above it
mod gesture;
pub(super) mod layout;
mod motion;
mod stack;

use crate::{geometry::Rect, theme::pane};
use gesture::{Commit, Config, Gesture, Phase};
use gpui::{prelude::*, *};

pub(super) use gesture::Side;
pub(super) use layout::Layout;
pub(super) use stack::{PaneStack, edges};

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

/// The pane layout as stored (`sidebarCollapsed`, `explorerWidth`,
/// `rightSidebarWidth`): one preference for every window.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct StoredPanes {
    pub explorer_collapsed: bool,
    pub explorer_width: f32,
    pub right_width: f32,
}

/// `SidebarResizeIntent`: what a key on a focused edge asks for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ResizeIntent {
    /// ← on either edge.
    Decrease,
    /// → on either edge.
    Increase,
    /// Home: the pane closes.
    Minimum,
    /// End: the pane opens at its widest.
    Maximum,
}

/// What the pane layout tells its owner.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum PaneEvent {
    /// The person changed the stored layout (a toggle, a released drag, a
    /// key on an edge): store it.
    Committed,
    /// Which panes are open changed: the window minimum follows.
    OpenChanged,
    /// The closed right sidebar was pulled out from the window edge.
    PulledOut,
}

/// An edge drag in progress: the gesture and the rules it runs under.
#[derive(Clone, Copy, Debug)]
struct Drag {
    config: Config,
    gesture: Gesture,
}

/// Where the panes sit this frame.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(in crate::shell) struct PaneFrames {
    /// The window rectangles: the panes' content at their open width and
    /// outer edge, the editor between the frames' edges.
    pub layout: Layout,
    /// The Explorer's frame on screen, while it shows.
    pub start: Option<Rect>,
    /// The right sidebar's frame on screen, while it shows.
    pub end: Option<Rect>,
    /// A frame is moving: frames keep coming.
    pub running: bool,
}

pub(super) struct PaneLayout {
    explorer: SidePane,
    right: SidePane,
    drag: Option<Drag>,
    motion: motion::PaneMotion,
    /// The width the panes shared at the last frame (the window, less the
    /// project rail): a drag's live maxima and the keys' steps are bounded
    /// by it.
    available: f32,
    /// The widths the open panes resolved to at the last frame.
    resolved: motion::Widths,
    /// The native window minimum last handed out.
    window_minimum: f32,
    /// Each open edge is a tab stop that resizes with the arrow keys.
    start_focus: FocusHandle,
    end_focus: FocusHandle,
}
impl EventEmitter<PaneEvent> for PaneLayout {}

impl PaneLayout {
    /// Both panes at their default widths: the Explorer open, the right
    /// sidebar open when `right_open`.
    pub fn new(right_open: bool, window: &mut Window, cx: &mut Context<Self>) -> Self {
        // Escape rolls a drag back wherever focus is (TS listens on `window`
        // in the capture phase): intercepted before any binding.
        let panes = cx.weak_entity();
        let own = window.window_handle();
        cx.intercept_keystrokes(move |event, window, cx| {
            if window.window_handle() != own || event.keystroke.key != "escape" {
                return;
            }
            let _ = panes.update(cx, |p, cx| {
                if p.end_drag(false, cx).is_some() {
                    cx.stop_propagation();
                }
            });
        })
        .detach();
        // Leaving the window abandons a drag (`blur` cancels).
        cx.observe_window_activation(window, |p, window, cx| {
            if !window.is_window_active() {
                p.end_drag(false, cx);
            }
        })
        .detach();
        Self::detached(right_open, cx)
    }
    /// The state alone, without the window input (tests and benchmarks).
    fn detached(right_open: bool, cx: &mut Context<Self>) -> Self {
        Self {
            explorer: SidePane {
                open: true,
                width: pane::DEFAULT_EXPLORER_WIDTH,
            },
            right: SidePane {
                open: right_open,
                width: pane::DEFAULT_RIGHT_SIDEBAR_WIDTH,
            },
            drag: None,
            motion: Default::default(),
            available: 0.,
            resolved: (0., 0.),
            window_minimum: 0.,
            start_focus: cx.focus_handle().tab_stop(true),
            end_focus: cx.focus_handle().tab_stop(true),
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
    /// The edge's keyboard focus.
    pub fn focus(&self, side: Side) -> &FocusHandle {
        match side {
            Side::Start => &self.start_focus,
            Side::End => &self.end_focus,
        }
    }
    /// Apply a change to which panes are open and say so.
    fn changed(&mut self, before: (bool, bool), committed: bool, cx: &mut Context<Self>) {
        if (self.explorer.open, self.right.open) != before {
            cx.emit(PaneEvent::OpenChanged);
        }
        if committed {
            cx.emit(PaneEvent::Committed);
        }
        cx.notify();
    }
    fn open_state(&self) -> (bool, bool) {
        (self.explorer.open, self.right.open)
    }

    // ------------------------------------------------------------ commands
    /// The Header's expand button: the Explorer opens or closes, and the
    /// layout is stored. (Closing is the edge's: a drag past half the
    /// minimum, or Home on the focused edge.)
    pub fn toggle_explorer(&mut self, cx: &mut Context<Self>) {
        let before = self.open_state();
        self.explorer.open = !self.explorer.open;
        self.changed(before, true, cx);
    }
    /// Open or close the right sidebar; what it shows stays (the closing
    /// frame keeps its content). Whether it is open is not stored.
    pub fn set_right_open(&mut self, open: bool, cx: &mut Context<Self>) {
        if self.right.open == open {
            return;
        }
        let before = self.open_state();
        self.right.open = open;
        self.changed(before, false, cx);
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
    /// This window's own commits come back as no change.
    pub fn restore(&mut self, stored: StoredPanes, cx: &mut Context<Self>) {
        if stored == self.stored() {
            return;
        }
        let before = self.open_state();
        self.explorer.open = !stored.explorer_collapsed;
        self.explorer.width = stored.explorer_width;
        self.right.width = stored.right_width;
        self.motion = Default::default();
        self.changed(before, false, cx);
    }

    // ----------------------------------------------------------- edge drag
    /// The side whose edge is being dragged.
    pub fn dragging(&self) -> Option<Side> {
        self.drag.map(|drag| drag.config.side)
    }
    /// The rules a drag (or a key) on `side` runs under in the room the
    /// panes had at the last frame.
    fn config(&self, side: Side) -> Config {
        match side {
            Side::Start => Config::new(
                side,
                pane::MIN_EXPLORER_WIDTH,
                layout::explorer_max_width(self.available, self.right.open),
                pane::EXPLORER_COLLAPSE_THRESHOLD,
            ),
            Side::End => Config::new(
                side,
                pane::MIN_RIGHT_SIDEBAR_WIDTH,
                layout::right_sidebar_max_width(self.available, self.explorer.extent()),
                pane::RIGHT_SIDEBAR_COLLAPSE_THRESHOLD,
            ),
        }
    }
    /// A press on `side`'s edge at `point`.
    pub fn begin_drag(&mut self, side: Side, point: Point<Pixels>, cx: &mut Context<Self>) {
        let config = self.config(side);
        let pane = self.pane(side);
        let gesture = Gesture::begin(&config, coordinates(point), !pane.open, pane.width);
        self.drag = Some(Drag { config, gesture });
        cx.notify();
    }
    /// The pointer moved: only the preview changes. `false` with no drag.
    pub fn move_drag(&mut self, point: Point<Pixels>, cx: &mut Context<Self>) -> bool {
        let Some(drag) = &mut self.drag else {
            return false;
        };
        let moved = drag.gesture.moved_to(&drag.config, coordinates(point));
        if moved != drag.gesture {
            drag.gesture = moved;
            cx.notify();
        }
        true
    }
    /// Ends the drag: a release (`commit`) applies the gesture once, Escape
    /// or losing the window rolls the preview back. `None` with no drag,
    /// else whether the committed layout changed (and is stored).
    pub fn end_drag(&mut self, commit: bool, cx: &mut Context<Self>) -> Option<bool> {
        let drag = self.drag.take()?;
        let result = if commit {
            drag.gesture.finish(&drag.config)
        } else {
            None
        };
        let side = drag.config.side;
        let before = self.open_state();
        if let Some(result) = result {
            self.apply(side, result);
            if side == Side::End && !before.1 && self.right.open {
                cx.emit(PaneEvent::PulledOut);
            }
        }
        self.changed(before, result.is_some(), cx);
        Some(result.is_some())
    }
    fn apply(&mut self, side: Side, commit: Commit) {
        let pane = self.pane_mut(side);
        match commit {
            Commit::Collapse { restore_width } => {
                pane.width = restore_width;
                pane.open = false;
            }
            Commit::Expand { width } => {
                pane.width = width;
                pane.open = true;
            }
            Commit::Resize { width } => pane.width = width,
        }
    }

    // -------------------------------------------------------- keyboard edge
    /// `onKeyboardResize` on `side`'s focused edge (`resizeExplorerByKeyboard`,
    /// the auxiliary pane's `resizeByKeyboard`): 12px a step (24 with ⇧),
    /// Home closes the pane, End opens it at its widest, and a step below
    /// the minimum closes it. ← moves the edge left whichever side it is.
    pub fn resize_by_keyboard(
        &mut self,
        side: Side,
        intent: ResizeIntent,
        accelerated: bool,
        cx: &mut Context<Self>,
    ) {
        if self.drag.is_some() || !self.pane(side).open {
            return;
        }
        let config = self.config(side);
        let (min, max) = config.range();
        let commit = match intent {
            ResizeIntent::Minimum => Commit::Collapse { restore_width: min },
            ResizeIntent::Maximum => Commit::Expand { width: max },
            ResizeIntent::Decrease | ResizeIntent::Increase => {
                let step = if accelerated { 24. } else { 12. };
                // The edge moves; the Explorer grows to the right, the right
                // sidebar to the left.
                let toward_end = if intent == ResizeIntent::Increase {
                    1.
                } else {
                    -1.
                };
                let grow = match side {
                    Side::Start => toward_end,
                    Side::End => -toward_end,
                };
                let current = match side {
                    Side::Start => self.resolved.0,
                    Side::End => self.resolved.1,
                };
                let next = current + grow * step;
                if next < min {
                    Commit::Collapse { restore_width: min }
                } else {
                    Commit::Resize {
                        width: next.clamp(min, max),
                    }
                }
            }
        };
        let before = self.open_state();
        let unchanged = self.pane(side);
        self.apply(side, commit);
        let committed = self.pane(side) != unchanged;
        self.changed(before, committed, cx);
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
    /// Where the panes sit in a `w`×`h` window beside a `rail` wide project
    /// rail, advancing the open / close motion by one frame. An edge drag
    /// follows the pointer; opening and closing a pane (a toggle, or a drag
    /// crossing its collapse threshold) moves its frame, unless the system
    /// asks for reduced motion.
    pub fn frames(&mut self, w: f32, h: f32, rail: f32, reduce_motion: bool) -> PaneFrames {
        self.available = w - rail;
        let (explorer, right) = self.preview();
        let target = Layout::new(w, h, explorer.extent(), right.extent(), rail);
        self.resolved = (target.explorer.w, target.auxiliary.w);
        let animate = !reduce_motion
            && self
                .drag
                .is_none_or(|drag| drag.gesture.phase != Phase::Resizing);
        let motion = self.motion.frame(
            (explorer.open, right.open),
            self.resolved,
            animate,
            std::time::Instant::now(),
        );
        // A moving frame's content keeps the open width; a drag narrowing
        // the Explorer keeps it at the committed width instead of reflowing
        // the rows at every pointer sample.
        let mut content = motion.from.map_or(self.resolved, |from| {
            (from.0.max(self.resolved.0), from.1.max(self.resolved.1))
        });
        if self.dragging() == Some(Side::Start) && explorer.open && self.explorer.open {
            content.0 = content.0.max(self.explorer.width);
        }
        let (start, end) = motion.shown;
        // The right edge of the panes' room: past the window when every
        // minimum cannot fit (full screen).
        let room = target.auxiliary.right();
        let footer = target.footer.h;
        let body = h - target.header.h;
        let frame = |x: f32, w: f32| Rect::new(x, target.header.h, w, body);
        let layout = Layout {
            header: target.header,
            explorer: Rect::new(rail, target.explorer.y, content.0, target.explorer.h),
            footer: Rect::new(rail, h - footer, content.0, footer),
            editor: frame(rail + start, room - end - rail - start),
            auxiliary: frame(room - content.1, content.1),
        };
        PaneFrames {
            layout,
            start: (start > 0.5).then(|| frame(rail, start)),
            end: (end > 0.5).then(|| frame(room - end, end)),
            running: self.motion.running(),
        }
    }
    /// `side`'s plane at its open width in a `w`×`h` window beside a `rail`
    /// wide project rail: where its content lays out, whether or not its
    /// frame shows now (a closing pane keeps it to the end).
    pub fn open_plane(&self, side: Side, w: f32, h: f32, rail: f32) -> Rect {
        let (mut explorer, mut right) = (self.explorer, self.right);
        match side {
            Side::Start => explorer.open = true,
            Side::End => right.open = true,
        }
        let layout = Layout::new(w, h, explorer.extent(), right.extent(), rail);
        match side {
            Side::Start => layout.explorer,
            Side::End => layout.auxiliary,
        }
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
    use gpui::{TestAppContext, point, px};

    fn panes(cx: &mut TestAppContext, right_open: bool) -> Entity<PaneLayout> {
        cx.new(|cx| PaneLayout::detached(right_open, cx))
    }
    fn events(
        panes: &Entity<PaneLayout>,
        cx: &mut TestAppContext,
    ) -> std::rc::Rc<std::cell::RefCell<Vec<PaneEvent>>> {
        let heard = std::rc::Rc::new(std::cell::RefCell::new(vec![]));
        let sink = heard.clone();
        cx.update(|cx| {
            cx.subscribe(panes, move |_, event: &PaneEvent, _| {
                sink.borrow_mut().push(*event)
            })
            .detach()
        });
        heard
    }

    #[gpui::test]
    fn a_drag_commits_on_release_and_rolls_back_on_cancel(cx: &mut TestAppContext) {
        let panes = panes(cx, false);
        let heard = events(&panes, cx);
        let at = |x: f32| point(px(x), px(400.));
        panes.update(cx, |p, cx| {
            p.frames(1280., 800., 0., true);
            p.begin_drag(Side::Start, at(320.), cx);
            assert!(p.move_drag(at(280.), cx));
            // The preview moves; the committed width does not.
            assert_eq!(p.frames(1280., 800., 0., true).layout.editor.x, 280.);
            assert_eq!(p.explorer().width, 320.);
            assert_eq!(p.end_drag(true, cx), Some(true));
            assert_eq!(
                p.explorer(),
                SidePane {
                    open: true,
                    width: 280.
                }
            );
            // Cancelled: nothing changes, nothing to store.
            p.begin_drag(Side::Start, at(280.), cx);
            p.move_drag(at(40.), cx);
            assert_eq!(p.frames(1280., 800., 0., true).layout.editor.x, 0.);
            assert_eq!(p.end_drag(false, cx), Some(false));
            assert_eq!(p.explorer().width, 280.);
            assert_eq!(p.end_drag(true, cx), None);
        });
        assert_eq!(*heard.borrow(), vec![PaneEvent::Committed]);
    }

    #[gpui::test]
    fn the_stored_layout_round_trips_and_arrives_without_motion(cx: &mut TestAppContext) {
        let panes = panes(cx, false);
        let heard = events(&panes, cx);
        panes.update(cx, |p, cx| {
            p.frames(1280., 800., 0., false);
            let stored = StoredPanes {
                explorer_collapsed: true,
                explorer_width: 260.,
                right_width: 400.,
            };
            p.restore(stored, cx);
            assert_eq!(p.stored(), stored);
            let frames = p.frames(1280., 800., 0., false);
            assert!(!frames.running);
            assert_eq!(frames.layout.editor.x, 0.);
            assert_eq!(frames.start, None);
            // A toggle afterwards does move, and is stored.
            p.toggle_explorer(cx);
            assert!(p.frames(1280., 800., 0., false).running);
        });
        assert_eq!(
            *heard.borrow(),
            vec![
                PaneEvent::OpenChanged,
                PaneEvent::OpenChanged,
                PaneEvent::Committed
            ]
        );
    }

    #[gpui::test]
    fn a_moving_frame_keeps_its_content_at_the_open_width(cx: &mut TestAppContext) {
        let panes = panes(cx, false);
        panes.update(cx, |p, cx| {
            p.frames(1280., 800., 0., false);
            p.toggle_explorer(cx);
            // The first frame of the close shows the open pane…
            let first = p.frames(1280., 800., 0., false);
            assert_eq!(first.start.unwrap().w, 320.);
            p.motion.advance(std::time::Duration::from_millis(180));
            let mid = p.frames(1280., 800., 0., false);
            // …then the frame narrows while the content keeps its width and
            // edge, and the editor follows the frame.
            let frame = mid.start.unwrap();
            assert!(frame.w > 0. && frame.w < 320.);
            assert_eq!((mid.layout.explorer.x, mid.layout.explorer.w), (0., 320.));
            assert_eq!(mid.layout.editor.x, frame.right());
            p.motion.advance(std::time::Duration::from_millis(400));
            let settled = p.frames(1280., 800., 0., false);
            assert_eq!((settled.start, settled.running), (None, false));
        });
    }

    #[gpui::test]
    fn the_right_sidebar_content_is_anchored_at_its_end(cx: &mut TestAppContext) {
        let panes = panes(cx, false);
        panes.update(cx, |p, cx| {
            p.frames(1280., 800., 0., false);
            p.set_right_open(true, cx);
            p.frames(1280., 800., 0., false);
            p.motion.advance(std::time::Duration::from_millis(180));
            let frames = p.frames(1280., 800., 0., false);
            let end = frames.end.unwrap();
            assert_eq!(frames.layout.auxiliary.right(), end.right());
            assert_eq!(frames.layout.auxiliary.w, 560.);
            assert_eq!(frames.layout.editor.right(), end.x);
        });
    }

    #[gpui::test]
    fn keys_on_an_edge_step_the_width_and_close_below_the_minimum(cx: &mut TestAppContext) {
        let panes = panes(cx, true);
        let heard = events(&panes, cx);
        panes.update(cx, |p, cx| {
            p.frames(1600., 800., 0., true);
            // → widens the Explorer, ← widens the right sidebar.
            p.resize_by_keyboard(Side::Start, ResizeIntent::Increase, false, cx);
            p.frames(1600., 800., 0., true);
            assert_eq!(p.explorer().width, 332.);
            p.resize_by_keyboard(Side::End, ResizeIntent::Decrease, true, cx);
            p.frames(1600., 800., 0., true);
            assert_eq!(p.right().width, 584.);
            // End opens the Explorer at its widest within the room.
            p.resize_by_keyboard(Side::Start, ResizeIntent::Maximum, false, cx);
            assert_eq!(p.explorer().width, 520.);
            // Home closes it, to reopen at the minimum.
            p.frames(1600., 800., 0., true);
            p.resize_by_keyboard(Side::Start, ResizeIntent::Minimum, false, cx);
            assert_eq!(
                p.explorer(),
                SidePane {
                    open: false,
                    width: 220.
                }
            );
            // A closed pane has no edge to act on.
            p.resize_by_keyboard(Side::Start, ResizeIntent::Increase, false, cx);
            assert!(!p.explorer().open);
        });
        let committed = heard
            .borrow()
            .iter()
            .filter(|e| **e == PaneEvent::Committed)
            .count();
        assert_eq!(committed, 4);
    }

    #[gpui::test]
    fn the_window_minimum_is_handed_out_once_per_change(cx: &mut TestAppContext) {
        let panes = panes(cx, false);
        panes.update(cx, |p, cx| {
            assert_eq!(p.take_window_minimum(0.), Some(720.));
            assert_eq!(p.take_window_minimum(0.), None);
            p.set_right_open(true, cx);
            assert_eq!(p.take_window_minimum(0.), Some(868.));
        });
    }
}
