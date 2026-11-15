//! `DocumentSourceSplit` (`editor/host/DocumentSourceSplit.tsx`,
//! `document-source-split.css`): a primary document surface with an optional
//! companion source panel on the right, separated by a 1px divider with a
//! 9px draggable/keyboard-focusable resize handle.
use crate::ui::{appearance::ActiveAppearance, components::ResizeHandle};
use gpui::{prelude::*, *};
use std::rc::Rc;

const DEFAULT_SHARE: f32 = 0.5;
const MIN_SHARE: f32 = 0.2;
const MAX_SHARE: f32 = 0.8;
const KEYBOARD_STEP: f32 = 0.025;

fn clamp_share(value: f32) -> f32 {
    if !value.is_finite() {
        return DEFAULT_SHARE;
    }
    ((value * 1000.).round() / 1000.).clamp(MIN_SHARE, MAX_SHARE)
}

pub struct SourceSplit {
    page: Rc<dyn Fn() -> AnyElement>,
    source: Rc<dyn Fn() -> Option<AnyElement>>,
    share: f32,
    resizing: Option<f32>,
    bounds: Option<Bounds<Pixels>>,
    focus: FocusHandle,
}

impl SourceSplit {
    pub fn new(
        page: impl Fn() -> AnyElement + 'static,
        source: impl Fn() -> Option<AnyElement> + 'static,
        cx: &mut Context<Self>,
    ) -> Self {
        Self {
            page: Rc::new(page),
            source: Rc::new(source),
            share: DEFAULT_SHARE,
            resizing: None,
            bounds: None,
            focus: cx.focus_handle(),
        }
    }

    #[cfg(test)]
    pub fn share(&self) -> f32 {
        self.share
    }
}

impl Render for SourceSplit {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        crate::web_host::frame_drawn(window);
        let page = (self.page)();
        let source = (self.source)();
        let view = cx.entity();
        let measure = canvas(
            move |bounds, _, cx| {
                view.update(cx, |s, _| s.bounds = Some(bounds));
            },
            |_, _, _, _| {},
        )
        .absolute()
        .size_full();
        let mut root = div()
            .id("document-source-split")
            .relative()
            .flex()
            .size_full()
            .min_w_0()
            .min_h_0()
            .child(measure)
            .child(div().flex_1().min_w_0().min_h_0().h_full().child(page));

        if let Some(source) = source {
            let handle = ResizeHandle::new("document-source-split-divider", Axis::Horizontal)
                .absolute()
                .top_0()
                .bottom_0()
                .left(px(-4.))
                .w(px(9.))
                .stroke_at(4.)
                .rest(cx.palette().divider)
                .resizing(self.resizing.is_some())
                .focused(self.focus.is_focused(window))
                .track_focus(&self.focus)
                .on_drag_start(cx.listener(|s, e: &MouseDownEvent, window, cx| {
                    cx.stop_propagation();
                    if e.click_count >= 2 {
                        s.resizing = None;
                        s.share = DEFAULT_SHARE;
                    } else {
                        s.resizing = Some(s.share);
                        s.focus.focus(window, cx);
                    }
                    cx.notify();
                }))
                .on_key_down(cx.listener(
                    |s, e: &KeyDownEvent, _, cx| match e.keystroke.key.as_str() {
                        "left" => {
                            cx.stop_propagation();
                            s.share = clamp_share(s.share + KEYBOARD_STEP);
                            cx.notify();
                        }
                        "right" => {
                            cx.stop_propagation();
                            s.share = clamp_share(s.share - KEYBOARD_STEP);
                            cx.notify();
                        }
                        "escape" => {
                            if let Some(start) = s.resizing.take() {
                                cx.stop_propagation();
                                s.share = start;
                                cx.notify();
                            }
                        }
                        _ => {}
                    },
                ));
            root = root
                .child(
                    div()
                        .relative()
                        .w(px(1.))
                        .h_full()
                        .flex_shrink_0()
                        .child(handle),
                )
                .child(
                    div()
                        .id("document-source-split-source")
                        .w(relative(self.share))
                        .flex_shrink_0()
                        .min_w_0()
                        .min_h_0()
                        .h_full()
                        .child(source),
                );
        }

        if self.resizing.is_some() {
            root = root
                .on_mouse_move(cx.listener(|s, e: &MouseMoveEvent, _, cx| {
                    if !e.pressed_button.is_some_and(|b| b == MouseButton::Left) {
                        s.resizing = None;
                        cx.notify();
                        return;
                    }
                    if let Some(bounds) = s.bounds {
                        let width = f32::from(bounds.size.width);
                        if width > 0. {
                            let from_end = f32::from(bounds.right() - e.position.x) / width;
                            s.share = clamp_share(from_end);
                            cx.notify();
                        }
                    }
                }))
                .on_mouse_up(
                    MouseButton::Left,
                    cx.listener(|s, _, _, cx| {
                        s.resizing = None;
                        cx.notify();
                    }),
                )
                .on_mouse_up_out(
                    MouseButton::Left,
                    cx.listener(|s, _, _, cx| {
                        s.resizing = None;
                        cx.notify();
                    }),
                )
                .child(
                    div()
                        .id("document-source-split-drag-shield")
                        .absolute()
                        .inset_0()
                        .cursor(CursorStyle::ResizeLeftRight),
                );
        }

        root
    }
}
