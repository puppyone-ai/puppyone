//! Application adapter for GPUI Kit's Input / Textarea. Kit owns editing,
//! selection, IME, clipboard and history; this adapter only bridges host events.
pub use super::input::InputSnapshot;
use crate::ui::appearance::ActiveAppearance;
use gpui::{prelude::*, *};
use gpui_kit::component::input::{
    InlineToken, InlineTokenContext, Input, InputContent, InputEvent as KitEvent, InputState,
    Textarea, TextareaState,
};
use std::rc::Rc;

/// How an atomic inline token renders (a prompt mention's chip).
pub type TokenRenderer = Rc<dyn Fn(&InlineTokenContext, &mut Window, &mut App) -> AnyElement>;
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
    pub appearance: bool,
    /// Kit's disabled field: no editing or focus, muted.
    pub disabled: bool,
    pub submit_on_enter: bool,
    pub min_height: f32,
    /// Prompt editors: Kit's smallest editor padding (4px inline, 0 block) so
    /// the host owns the inset, with an explicit text size and line height.
    pub prompt_text: Option<(f32, f32)>,
    /// Draw the placeholder in this colour (Kit's follows the global theme).
    pub placeholder_color: Option<Rgba>,
    /// Atomic inline tokens (prompt mentions) render through this.
    pub token_renderer: Option<TokenRenderer>,
    /// Text with tokens to install at the next render (a restored draft).
    pending_content: Option<InputContent>,
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
            appearance: true,
            disabled: false,
            submit_on_enter: false,
            prompt_text: None,
            placeholder_color: None,
            min_height: 22.,
            token_renderer: None,
            pending_content: None,
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
    /// `AgentPromptEditor`'s mention insertion: atomic tokens at the caret
    /// (replacing a selection), a space between them, one before unless
    /// whitespace precedes and one after unless whitespace or the end
    /// follows; the caret lands after them. `(id, text)` per token.
    pub fn insert_tokens(
        &mut self,
        tokens: &[(String, String)],
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if tokens.is_empty() {
            return true;
        }
        dispatch!(&self.field, |s| s.update(cx, |s, cx| {
            let value = s.value().to_string();
            let range = s.selected_range();
            let before = value[..range.start].chars().next_back();
            let after = value[range.end..].chars().next();
            if !range.is_empty() {
                use gpui::EntityInputHandler as _;
                let utf16 = |byte: usize| value[..byte].encode_utf16().count();
                s.replace_text_in_range(Some(utf16(range.start)..utf16(range.end)), "", window, cx);
            }
            if before.is_some_and(|c| !c.is_whitespace()) {
                s.insert(" ", window, cx);
            }
            for (index, (id, text)) in tokens.iter().enumerate() {
                if index > 0 {
                    s.insert(" ", window, cx);
                }
                let at = s.cursor();
                if s.replace_range_with_token(
                    at..at,
                    InlineToken::new(id.clone(), text.clone()),
                    window,
                    cx,
                )
                .is_err()
                {
                    return false;
                }
            }
            if after.is_some_and(|c| !c.is_whitespace()) {
                s.insert(" ", window, cx);
            }
            true
        }))
    }
    /// The ids of the tokens in the text, in order.
    pub fn token_ids(&self, cx: &App) -> Vec<String> {
        dispatch!(&self.field, |s| s
            .read(cx)
            .tokens()
            .iter()
            .map(|span| span.token().id().to_string())
            .collect())
    }
    /// Replace the value with text that carries tokens; the caret ends it.
    pub fn restore_content(&mut self, content: InputContent, cx: &mut Context<Self>) {
        self.pending = None;
        self.value = content.text().clone();
        self.pending_content = Some(content);
        cx.notify();
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
        if let Some(content) = self.pending_content.take() {
            dispatch!(&self.field, |s| s.update(cx, |s, cx| {
                let end = content.text().len();
                s.set_value(content, window, cx);
                s.set_selected_range(end..end, cx);
            }));
        }
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
        let t = cx.palette();
        let control = match &self.field {
            Field::Single(s) => Input::new(s)
                .when_some(self.token_renderer.clone(), |input, render| {
                    input.token(move |token, window, cx| render(token, window, cx))
                })
                .appearance(self.appearance)
                .disabled(self.disabled)
                .w_full()
                .when_some(self.prompt_text, |input, (size, line)| {
                    use gpui_kit::component::Sizable as _;
                    input.xsmall().text_size(px(size)).line_height(px(line))
                })
                .into_any_element(),
            Field::Multi(s) => Textarea::new(s)
                .when_some(self.token_renderer.clone(), |area, render| {
                    area.token(move |token, window, cx| render(token, window, cx))
                })
                .appearance(self.appearance)
                .disabled(self.disabled)
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
