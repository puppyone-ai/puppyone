//! Changes section sizing: the same adjacent-pair limits for pointer and
//! keyboard input, with rollback when the gesture loses its owner.
use super::*;
use crate::ui::components::ResizeHandle;
use std::{cell::RefCell, rc::Rc};

#[derive(Clone, Copy, Debug)]
pub(super) struct Geometry {
    pub height: f32,
    pub min: f32,
    pub max: f32,
}
#[derive(Clone, Copy, Debug)]
struct Pair {
    panels: [Panel; 2],
    start: [f32; 2],
    lower: f32,
    upper: f32,
}
impl Pair {
    fn new(panels: [Panel; 2], geometry: [Geometry; 2]) -> Option<Self> {
        let [a, b] = geometry;
        let total = a.height + b.height;
        let lower = a.min.max(total - b.max);
        let upper = a.max.min(total - b.min);
        (lower.is_finite() && upper.is_finite() && lower <= upper).then_some(Self {
            panels,
            start: [a.height, b.height],
            lower,
            upper,
        })
    }
    fn sizes(self, requested: f32) -> [f32; 2] {
        let first = requested.clamp(self.lower, self.upper);
        [
            first.round(),
            (self.start[0] + self.start[1] - first).round(),
        ]
    }
}
#[derive(Clone, Copy)]
struct Drag {
    pair: Pair,
    y: f32,
    original: [Option<f32>; 2],
}
pub(super) struct Layout {
    pub heights: [Option<f32>; 4],
    pub geometry: Rc<RefCell<[Option<Geometry>; 4]>>,
    drag: Option<Drag>,
    focus: [FocusHandle; 4],
}
impl Layout {
    pub fn new(cx: &mut Context<SourceControl>) -> Self {
        Self {
            heights: [None; 4],
            geometry: Default::default(),
            drag: None,
            focus: std::array::from_fn(|_| cx.focus_handle().tab_stop(true)),
        }
    }
    fn pair(&self, previous: Panel, next: Panel) -> Option<Pair> {
        let geometry = self.geometry.borrow();
        Pair::new(
            [previous, next],
            [geometry[previous as usize]?, geometry[next as usize]?],
        )
    }
    fn apply(&mut self, pair: Pair, requested: f32) {
        for (panel, height) in pair.panels.into_iter().zip(pair.sizes(requested)) {
            self.heights[panel as usize] = Some(height);
        }
    }
    pub fn cancel(&mut self) -> bool {
        let Some(drag) = self.drag.take() else {
            return false;
        };
        for (panel, height) in drag.pair.panels.into_iter().zip(drag.original) {
            self.heights[panel as usize] = height;
        }
        true
    }
    pub fn reconcile(&mut self, panels: &[Panel]) {
        if self
            .drag
            .is_some_and(|drag| !panels.windows(2).any(|pair| pair == drag.pair.panels))
        {
            self.cancel();
        }
        let mut geometry = self.geometry.borrow_mut();
        for (index, value) in geometry.iter_mut().enumerate() {
            if !panels.iter().any(|panel| *panel as usize == index) {
                *value = None;
            }
        }
    }
}

pub(super) fn install(window: &mut Window, cx: &mut Context<SourceControl>) {
    let host = cx.weak_entity();
    let own_window = window.window_handle();
    cx.intercept_keystrokes(move |event, window, cx| {
        if window.window_handle() == own_window && event.keystroke.key == "escape" {
            let _ = host.update(cx, |s, cx| {
                if s.panel_layout.cancel() {
                    cx.stop_propagation();
                    cx.notify();
                }
            });
        }
    })
    .detach();
    cx.observe_window_activation(window, |s, window, cx| {
        if !window.is_window_active() && s.panel_layout.cancel() {
            cx.notify();
        }
    })
    .detach();
    cx.observe_window_visibility(window, |s, visibility, _, cx| {
        if !visibility.is_visible() && s.panel_layout.cancel() {
            cx.notify();
        }
    })
    .detach();
}

impl SourceControl {
    pub fn cancel_panel_resize(&mut self, cx: &mut Context<Self>) {
        if self.panel_layout.cancel() {
            cx.notify();
        }
    }
    fn move_section_resize(&mut self, y: f32, cx: &mut Context<Self>) {
        if let Some(drag) = self.panel_layout.drag {
            let geometry = *self.panel_layout.geometry.borrow();
            let current = drag.pair.panels.map(|panel| geometry[panel as usize]);
            let [Some(mut a), Some(mut b)] = current else {
                self.cancel_panel_resize(cx);
                return;
            };
            // Rows and type scale can change mid-gesture. Keep its original
            // total while rechecking the current rendered content limits.
            [a.height, b.height] = drag.pair.start;
            let Some(pair) = Pair::new(drag.pair.panels, [a, b]) else {
                self.cancel_panel_resize(cx);
                return;
            };
            self.panel_layout.apply(pair, pair.start[0] + y - drag.y);
            cx.notify();
        }
    }
    pub(super) fn section_resize_tracking(&self, cx: &Context<Self>) -> AnyElement {
        let host = cx.weak_entity();
        canvas(
            |_, _, _| {},
            move |_, _, window, _| {
                let moves = host.clone();
                window.on_mouse_event(move |event: &MouseMoveEvent, phase, _, cx| {
                    if phase == DispatchPhase::Capture {
                        let _ = moves.update(cx, |s, cx| {
                            if event.pressed_button == Some(MouseButton::Left) {
                                s.move_section_resize(event.position.y.into(), cx);
                            } else if s.panel_layout.cancel() {
                                cx.notify();
                            }
                        });
                    }
                });
                let releases = host.clone();
                window.on_mouse_event(move |event: &MouseUpEvent, phase, _, cx| {
                    if phase == DispatchPhase::Capture && event.button == MouseButton::Left {
                        let _ = releases.update(cx, |s, cx| {
                            s.move_section_resize(event.position.y.into(), cx);
                            if s.panel_layout.drag.take().is_some() {
                                cx.notify();
                            }
                        });
                    }
                });
            },
        )
        .absolute()
        .size_0()
        .into_any_element()
    }
    pub(super) fn section_resize_handle(
        &self,
        previous: Panel,
        next: Panel,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = cx.palette();
        let focus = &self.panel_layout.focus[previous as usize];
        ResizeHandle::new(
            SharedString::from(format!("git-resize-{previous:?}-{next:?}")),
            Axis::Vertical,
        )
        .debug_selector(|| "git-section-resize".into())
        .track_focus(focus)
        .focused(focus.is_focused(window))
        .focus_ring()
        .resizing(
            self.panel_layout
                .drag
                .is_some_and(|drag| drag.pair.panels == [previous, next]),
        )
        .rest(t.sidebar_divider)
        .stroke_at(5.)
        .on_drag_start(cx.listener(move |s, event: &MouseDownEvent, window, cx| {
            s.panel_layout.cancel();
            if let Some(pair) = s.panel_layout.pair(previous, next) {
                let original = pair.panels.map(|p| s.panel_layout.heights[p as usize]);
                s.panel_layout.drag = Some(Drag {
                    pair,
                    y: event.position.y.into(),
                    original,
                });
                window.focus(&s.panel_layout.focus[previous as usize], cx);
                cx.stop_propagation();
                cx.notify();
            }
        }))
        .on_key_down(cx.listener(move |s, event: &KeyDownEvent, _, cx| {
            let Some(pair) = s.panel_layout.pair(previous, next) else {
                return;
            };
            let step = if event.keystroke.modifiers.shift {
                32.
            } else {
                8.
            };
            let requested = match event.keystroke.key.as_str() {
                "up" => pair.start[0] - step,
                "down" => pair.start[0] + step,
                "home" => pair.lower,
                "end" => pair.upper,
                _ => return,
            };
            s.panel_layout.cancel();
            s.panel_layout.apply(pair, requested);
            cx.stop_propagation();
            cx.notify();
        }))
        .relative()
        .flex_shrink_0()
        .h(px(SECTION_DIVIDER_HEIGHT))
        .mx(px(metric::SIDEBAR_ROW_LEFT_GAP))
        .into_any_element()
    }
}
