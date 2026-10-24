//! Application adapter for GPUI Kit's Input / Textarea. Kit owns editing,
//! selection, IME, clipboard and history; this adapter only bridges host events.
pub use super::input::InputSnapshot;
use gpui::{prelude::*, *};
use gpui_kit::component::input::{
    Input, InputEvent as KitEvent, InputState, Textarea, TextareaState,
};
#[derive(Clone, Debug)]
pub enum InputEvent {
    Changed,
    Submit,
}
actions!(puppy_form, [NextField, PreviousField]);
enum Field {
    Single(Entity<InputState>),
    Multi(Entity<TextareaState>),
}
macro_rules! dispatch {
    ($field:expr,|$s:ident| $body:expr) => {
        match $field {
            Field::Single($s) => $body,
            Field::Multi($s) => $body,
        }
    };
}
pub struct TextInput {
    field: Field,
    focus: FocusHandle,
    value: SharedString,
    placeholder: SharedString,
    pending: Option<InputSnapshot>,
    pub dark: bool,
    pub appearance: bool,
    pub submit_on_enter: bool,
    pub min_height: f32,
    /// Prompt editors: Kit's smallest editor padding (4px inline, 0 block) so
    /// the host owns the inset, with an explicit text size and line height.
    pub prompt_text: Option<(f32, f32)>,
    /// Draw the placeholder in this colour (Kit's follows the global theme).
    pub placeholder_color: Option<Rgba>,
    max_chars: usize,
    _subscriptions: Vec<Subscription>,
}
impl EventEmitter<InputEvent> for TextInput {}
impl TextInput {
    pub fn new(
        placeholder: impl Into<SharedString>,
        multiline: bool,
        max_chars: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        if cx.try_global::<gpui_kit::component::Theme>().is_none() {
            gpui_kit::init(cx);
        }
        let placeholder = placeholder.into();
        let field = if multiline {
            Field::Multi(cx.new(|cx| {
                TextareaState::new(window, cx)
                    .placeholder(placeholder.clone())
                    .auto_grow(1, 12)
            }))
        } else {
            Field::Single(cx.new(|cx| {
                InputState::new(window, cx)
                    .placeholder(placeholder.clone())
                    .validate(move |text, _| text.chars().count() <= max_chars)
            }))
        };
        let focus = dispatch!(&field, |s| s.focus_handle(cx));
        let subscription = dispatch!(&field, |s| cx.subscribe_in(
            s,
            window,
            |this, state, event: &KitEvent, w, cx| {
                let (value, composing) = state.update(cx, |s, cx| {
                    (s.value(), s.marked_text_range(w, cx).is_some())
                });
                this.value = value;
                match event {
                    KitEvent::Change => cx.emit(InputEvent::Changed),
                    KitEvent::PressEnter {
                        secondary: true, ..
                    } if !composing => cx.emit(InputEvent::Submit),
                    KitEvent::PressEnter { .. }
                        if !composing && matches!(this.field, Field::Single(_)) =>
                    {
                        if this.submit_on_enter {
                            cx.emit(InputEvent::Submit)
                        } else {
                            move_focus(false, w, cx)
                        }
                    }
                    _ => {}
                }
                cx.notify();
            }
        ));
        Self {
            field,
            focus,
            value: "".into(),
            placeholder,
            pending: None,
            dark: true,
            appearance: true,
            submit_on_enter: false,
            prompt_text: None,
            placeholder_color: None,
            min_height: 22.,
            max_chars,
            _subscriptions: vec![subscription],
        }
    }
    pub fn text(&self) -> &str {
        &self.value
    }
    pub fn composing(&self, window: &mut Window, cx: &mut App) -> bool {
        dispatch!(&self.field, |s| s
            .update(cx, |s, cx| s.marked_text_range(window, cx).is_some()))
    }
    pub fn set_placeholder(&mut self, text: impl Into<SharedString>) {
        self.placeholder = text.into();
    }
    pub fn restore(&mut self, mut s: InputSnapshot, cx: &mut Context<Self>) {
        s.text = s.text.chars().take(self.max_chars).collect();
        s.anchor = s.anchor.min(s.text.len());
        s.cursor = s.cursor.min(s.text.len());
        self.value = s.text.clone().into();
        self.pending = Some(s);
        cx.notify();
    }
    /// Replace the value, placing the caret at the end.
    pub fn set_text(&mut self, text: impl Into<String>, cx: &mut Context<Self>) {
        let text = text.into();
        let end = text.len();
        self.restore(
            InputSnapshot {
                text,
                marks: vec![],
                anchor: end,
                cursor: end,
            },
            cx,
        );
    }
    pub fn clear(&mut self, cx: &mut Context<Self>) {
        self.restore(
            InputSnapshot {
                text: String::new(),
                marks: vec![],
                anchor: 0,
                cursor: 0,
            },
            cx,
        );
    }
}
impl Focusable for TextInput {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}
impl Render for TextInput {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if let Some(value) = self.pending.take() {
            dispatch!(&self.field, |s| s.update(cx, |s, cx| {
                s.set_value(value.text, window, cx);
                s.set_selected_range(
                    value.anchor.min(value.cursor)..value.anchor.max(value.cursor),
                    cx,
                );
            }));
        }
        // A custom placeholder colour is drawn by this host over an empty field.
        let kit_placeholder = if self.placeholder_color.is_some() {
            SharedString::default()
        } else {
            self.placeholder.clone()
        };
        dispatch!(&self.field, |s| {
            if s.read(cx).presentation().placeholder() != &kit_placeholder {
                s.update(cx, |s, cx| {
                    s.set_placeholder(kit_placeholder.clone(), window, cx)
                });
            }
        });
        let t = crate::theme::Theme::new(self.dark);
        let control = match &self.field {
            Field::Single(s) => Input::new(s)
                .appearance(self.appearance)
                .w_full()
                .when_some(self.prompt_text, |input, (size, line)| {
                    use gpui_kit::component::Sizable as _;
                    input.xsmall().text_size(px(size)).line_height(px(line))
                })
                .into_any_element(),
            Field::Multi(s) => Textarea::new(s)
                .appearance(self.appearance)
                .w_full()
                .when_some(self.prompt_text, |area, (size, line)| {
                    use gpui_kit::component::Sizable as _;
                    area.xsmall().text_size(px(size)).line_height(px(line))
                })
                .min_h(px(
                    self.min_height + if self.prompt_text.is_some() { 0. } else { 16. }
                ))
                .into_any_element(),
        };
        let overlay = self
            .placeholder_color
            .filter(|_| self.value.is_empty())
            .map(|color| {
                let (size, line) = self.prompt_text.unwrap_or((14., 21.));
                div()
                    .absolute()
                    .top_0()
                    .left(px(4.))
                    .right(px(4.))
                    .text_size(px(size))
                    .line_height(px(line))
                    .text_color(color)
                    .truncate()
                    .child(self.placeholder.clone())
            });
        div()
            .key_context("PuppyForm")
            .relative()
            .w_full()
            .text_color(t.text)
            .children(overlay)
            .on_action(cx.listener(|_, _: &NextField, w, cx| {
                move_focus(false, w, cx);
            }))
            .on_action(cx.listener(|_, _: &PreviousField, w, cx| {
                move_focus(true, w, cx);
            }))
            .on_action(|_: &super::input::Undo, w, cx| {
                w.dispatch_action(Box::new(gpui_kit::base::input::Undo), cx)
            })
            .on_action(|_: &super::input::Redo, w, cx| {
                w.dispatch_action(Box::new(gpui_kit::base::input::Redo), cx)
            })
            .on_action(|_: &super::input::Copy, w, cx| {
                w.dispatch_action(Box::new(gpui_kit::base::input::Copy), cx)
            })
            .on_action(|_: &super::input::Cut, w, cx| {
                w.dispatch_action(Box::new(gpui_kit::base::input::Cut), cx)
            })
            .on_action(|_: &super::input::Paste, w, cx| {
                w.dispatch_action(Box::new(gpui_kit::base::input::Paste), cx)
            })
            .on_action(|_: &super::input::SelectAll, w, cx| {
                w.dispatch_action(Box::new(gpui_kit::base::input::SelectAll), cx)
            })
            .capture_action(cx.listener(|s, _: &gpui_kit::base::input::Paste, w, cx| {
                if let Some(text) = cx.read_from_clipboard().and_then(|c| c.text()) {
                    let text = s.bounded(None, &text, w, cx);
                    dispatch!(&s.field, |field| field
                        .update(cx, |field, cx| field.replace(text, w, cx)));
                    s.value = dispatch!(&s.field, |field| field.read(cx).value());
                }
                cx.stop_propagation();
            }))
            .capture_action(
                cx.listener(|_, _: &gpui_kit::base::input::IndentInline, w, cx| {
                    move_focus(false, w, cx);
                    cx.stop_propagation();
                }),
            )
            .capture_action(
                cx.listener(|_, _: &gpui_kit::base::input::OutdentInline, w, cx| {
                    move_focus(true, w, cx);
                    cx.stop_propagation();
                }),
            )
            .capture_action(cx.listener(|s, a: &gpui_kit::base::input::Enter, w, cx| {
                if s.composing(w, cx) {
                    cx.stop_propagation();
                    return;
                }
                // Multi-line prompts with `submit_on_enter` send on Enter and keep
                // Shift+Enter for a new line (`AgentPromptEditor`'s keymap).
                if a.secondary
                    || (s.submit_on_enter && (matches!(s.field, Field::Single(_)) || !a.shift))
                {
                    cx.emit(InputEvent::Submit);
                    cx.stop_propagation();
                } else if matches!(s.field, Field::Multi(_)) {
                    s.replace_text_in_range(None, "\n", w, cx);
                    cx.stop_propagation();
                }
            }))
            .child(PlatformInput {
                host: cx.entity(),
                child: control,
            })
    }
}
pub fn bind_keys(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("tab", NextField, Some("PuppyForm")),
        KeyBinding::new("shift-tab", PreviousField, Some("PuppyForm")),
    ]);
}

mod platform_input;
use platform_input::PlatformInput;

#[cfg(test)]
mod tests;

// Kit owns the modal scope. Our form actions keep Tab navigation inside it,
// including when Kit's text-area indentation action wins key dispatch.
fn move_focus(backwards: bool, window: &mut Window, cx: &mut App) {
    let trap = gpui_kit::base::active_focus_trap(window, cx);
    let advance = if backwards {
        Window::focus_prev
    } else {
        Window::focus_next
    };
    advance(window, cx);
    if let Some(trap) = trap {
        let first = window.focused(cx);
        while !trap.contains_focused(window, cx) {
            advance(window, cx);
            if window.focused(cx) == first {
                trap.focus(window, cx);
                break;
            }
        }
    }
}
