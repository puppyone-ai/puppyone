//! The generic editor view (CodeMirror `@codemirror/view` counterpart) on GPUI
//! Kit's `editor_host`: owns document state, layered decorations, host boxes,
//! selection, caret, IME, pointer and standard text-editing keybindings
//! (`TA-10`, `TA-17`, `TA-20`). Format-specific actions, shortcuts and add-ons
//! are contributed by extensions and view plugins, never hardcoded here.
#[cfg(all(test, target_os = "macos"))]
mod bench;
pub mod command;
pub mod commands;
mod composition;
pub mod decoration;
pub mod editor;
pub mod element;
pub mod extension;
pub mod find;
mod heights;
#[cfg(test)]
mod ime_tests;
mod input;
pub mod layout;
pub mod plugins;
mod pointer;
pub mod projection;
pub mod render;
pub mod style;
#[cfg(test)]
mod tests;
pub mod widget;

use crate::ui::input::{Copy, Cut, Paste, Redo, SelectAll, Undo};
use commands::Motion;
pub use editor::EditorView;
use element::EditorElement;
use extension::EditIntent;
use gpui::{prelude::*, *};

actions!(
    puppy_editor,
    [
        MoveLeft,
        MoveRight,
        MoveUp,
        MoveDown,
        MoveGroupLeft,
        MoveGroupRight,
        MoveLineStart,
        MoveLineEnd,
        MoveDocStart,
        MoveDocEnd,
        MovePageUp,
        MovePageDown,
        SelectLeft,
        SelectRight,
        SelectUp,
        SelectDown,
        SelectGroupLeft,
        SelectGroupRight,
        SelectLineStart,
        SelectLineEnd,
        SelectDocStart,
        SelectDocEnd,
        SelectPageUp,
        SelectPageDown,
        DeleteBackward,
        DeleteForward,
        DeleteGroupBackward,
        DeleteGroupForward,
        DeleteLineBackward,
        InsertNewline,
        InsertSoftNewline,
        Indent,
        Outdent,
        Cancel,
    ]
);

/// Key context of every native document editor.
pub const KEY_CONTEXT: &str = "PuppyEditor";

/// Cross-platform standard editor keymap using GPUI's `secondary-` modifier
/// (`Cmd` on macOS, `Ctrl` on Windows/Linux, `TA-17`).
pub fn bind_keys(cx: &mut App) {
    if !extension::mark_core_keys_bound(cx) {
        return;
    }
    let c = Some(KEY_CONTEXT);
    cx.bind_keys([
        KeyBinding::new("left", MoveLeft, c),
        KeyBinding::new("right", MoveRight, c),
        KeyBinding::new("up", MoveUp, c),
        KeyBinding::new("down", MoveDown, c),
        KeyBinding::new("alt-left", MoveGroupLeft, c),
        KeyBinding::new("alt-right", MoveGroupRight, c),
        KeyBinding::new("secondary-left", MoveLineStart, c),
        KeyBinding::new("secondary-right", MoveLineEnd, c),
        KeyBinding::new("home", MoveLineStart, c),
        KeyBinding::new("end", MoveLineEnd, c),
        KeyBinding::new("secondary-up", MoveDocStart, c),
        KeyBinding::new("secondary-down", MoveDocEnd, c),
        KeyBinding::new("pageup", MovePageUp, c),
        KeyBinding::new("pagedown", MovePageDown, c),
        KeyBinding::new("shift-left", SelectLeft, c),
        KeyBinding::new("shift-right", SelectRight, c),
        KeyBinding::new("shift-up", SelectUp, c),
        KeyBinding::new("shift-down", SelectDown, c),
        KeyBinding::new("alt-shift-left", SelectGroupLeft, c),
        KeyBinding::new("alt-shift-right", SelectGroupRight, c),
        KeyBinding::new("secondary-shift-left", SelectLineStart, c),
        KeyBinding::new("secondary-shift-right", SelectLineEnd, c),
        KeyBinding::new("shift-home", SelectLineStart, c),
        KeyBinding::new("shift-end", SelectLineEnd, c),
        KeyBinding::new("secondary-shift-up", SelectDocStart, c),
        KeyBinding::new("secondary-shift-down", SelectDocEnd, c),
        KeyBinding::new("shift-pageup", SelectPageUp, c),
        KeyBinding::new("shift-pagedown", SelectPageDown, c),
        KeyBinding::new("backspace", DeleteBackward, c),
        KeyBinding::new("shift-backspace", DeleteBackward, c),
        KeyBinding::new("delete", DeleteForward, c),
        KeyBinding::new("alt-backspace", DeleteGroupBackward, c),
        KeyBinding::new("alt-delete", DeleteGroupForward, c),
        KeyBinding::new("secondary-backspace", DeleteLineBackward, c),
        KeyBinding::new("enter", InsertNewline, c),
        KeyBinding::new("shift-enter", InsertSoftNewline, c),
        KeyBinding::new("tab", Indent, c),
        KeyBinding::new("shift-tab", Outdent, c),
        KeyBinding::new("escape", Cancel, c),
        KeyBinding::new("secondary-a", SelectAll, c),
        KeyBinding::new("secondary-c", Copy, c),
        KeyBinding::new("secondary-x", Cut, c),
        KeyBinding::new("secondary-v", Paste, c),
        KeyBinding::new("secondary-z", Undo, c),
        KeyBinding::new("secondary-shift-z", Redo, c),
    ]);
    if crate::platform::conventions::Conventions::current().emacs_line_bindings {
        cx.bind_keys([
            KeyBinding::new("ctrl-a", MoveLineStart, c),
            KeyBinding::new("ctrl-e", MoveLineEnd, c),
            KeyBinding::new("ctrl-d", DeleteForward, c),
        ]);
    }
}

macro_rules! motion {
    ($view:ident, $div:ident, $cx:ident, $($action:ident => $motion:expr, $extend:expr;)*) => {
        $(let $div = $div.on_action($cx.listener(|v: &mut EditorView, _: &$action, _, cx| v.motion($motion, $extend, cx)));)*
    };
}

impl Render for EditorView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.watch_focus(window, cx);
        let mut headers = Vec::new();
        let mut overlays = Vec::new();
        for plugin in &self.extensions.plugins {
            headers.extend(plugin.header(self, cx));
            overlays.extend(plugin.overlay(self, cx));
        }
        self.has_header_banner = !headers.is_empty();

        let focus_target = div()
            .relative()
            .flex_1()
            .min_h_0()
            .w_full()
            .track_focus(&self.focus)
            .child(EditorElement { view: cx.entity() })
            .children(overlays);

        let body = if headers.is_empty() {
            div().size_full().flex().flex_col().child(focus_target)
        } else {
            div()
                .size_full()
                .flex()
                .flex_col()
                .bg(self.surface().background)
                .children(headers)
                .child(focus_target)
        };

        // A widget inside holds the keyboard (an MDX tab): the editor's key
        // bindings stand aside, as the product's editor ignores the events of
        // its widgets, so no editing key reaches the document meanwhile.
        let widget_focus =
            !self.focus.is_focused(window) && self.focus.contains_focused(window, cx);
        let mut scoped = self.extensions.bind_actions(body, cx);
        for ext_ctx in self.extensions.key_contexts().into_iter().rev() {
            scoped = div()
                .size_full()
                .when(!widget_focus, |d| d.key_context(ext_ctx))
                .child(scoped);
        }

        let root = div()
            .id("puppy-editor")
            .relative()
            .size_full()
            .when(!widget_focus, |d| d.key_context(KEY_CONTEXT))
            .on_hover(cx.listener(|s, hovered: &bool, _, _| {
                if !hovered {
                    s.pointer.link_press = None;
                }
            }))
            .on_mouse_down(MouseButton::Left, cx.listener(Self::mouse_down))
            .on_mouse_move(cx.listener(Self::mouse_move))
            .on_mouse_up(MouseButton::Left, cx.listener(Self::mouse_up))
            .on_mouse_up_out(MouseButton::Left, cx.listener(Self::mouse_up))
            .on_scroll_wheel(cx.listener(Self::scroll_wheel));
        let root = root
            .on_action(cx.listener(|v, _: &MoveLeft, _, cx| {
                v.intent_or_motion(EditIntent::CharLeft, Motion::CharLeft, cx)
            }))
            .on_action(cx.listener(|v, _: &MoveLineStart, _, cx| {
                v.intent_or_motion(EditIntent::LineStart, Motion::LineStart, cx)
            }));
        motion!(self, root, cx,
            MoveRight => Motion::CharRight, false;
            MoveUp => Motion::Up, false;
            MoveDown => Motion::Down, false;
            MoveGroupLeft => Motion::GroupLeft, false;
            MoveGroupRight => Motion::GroupRight, false;
            MoveLineEnd => Motion::LineEnd, false;
            MoveDocStart => Motion::DocStart, false;
            MoveDocEnd => Motion::DocEnd, false;
            MovePageUp => Motion::PageUp, false;
            MovePageDown => Motion::PageDown, false;
            SelectLeft => Motion::CharLeft, true;
            SelectRight => Motion::CharRight, true;
            SelectUp => Motion::Up, true;
            SelectDown => Motion::Down, true;
            SelectGroupLeft => Motion::GroupLeft, true;
            SelectGroupRight => Motion::GroupRight, true;
            SelectLineStart => Motion::LineStart, true;
            SelectLineEnd => Motion::LineEnd, true;
            SelectDocStart => Motion::DocStart, true;
            SelectDocEnd => Motion::DocEnd, true;
            SelectPageUp => Motion::PageUp, true;
            SelectPageDown => Motion::PageDown, true;
        );
        root.on_action(cx.listener(|v, _: &DeleteBackward, _, cx| v.delete(Motion::CharLeft, cx)))
            .on_action(cx.listener(|v, _: &DeleteForward, _, cx| v.delete(Motion::CharRight, cx)))
            .on_action(
                cx.listener(|v, _: &DeleteGroupBackward, _, cx| v.delete(Motion::GroupLeft, cx)),
            )
            .on_action(
                cx.listener(|v, _: &DeleteGroupForward, _, cx| v.delete(Motion::GroupRight, cx)),
            )
            .on_action(
                cx.listener(|v, _: &DeleteLineBackward, _, cx| v.delete(Motion::LineStart, cx)),
            )
            .on_action(
                cx.listener(|v, _: &InsertNewline, _, cx| v.edit_intent(EditIntent::Enter, cx)),
            )
            .on_action(cx.listener(|v, _: &InsertSoftNewline, _, cx| {
                v.edit_intent(EditIntent::SoftEnter, cx)
            }))
            .on_action(cx.listener(|v, _: &Indent, _, cx| v.edit_intent(EditIntent::Tab, cx)))
            .on_action(cx.listener(|v, _: &Outdent, _, cx| v.edit_intent(EditIntent::BackTab, cx)))
            .on_action(cx.listener(|v, _: &Cancel, _, cx| v.edit_intent(EditIntent::Escape, cx)))
            .on_action(cx.listener(|v, _: &SelectAll, _, cx| v.select_all(cx)))
            .on_action(cx.listener(|v, _: &Copy, _, cx| v.copy(false, cx)))
            .on_action(cx.listener(|v, _: &Cut, _, cx| v.copy(true, cx)))
            .on_action(cx.listener(|v, _: &Paste, w, cx| v.paste(w, cx)))
            .on_action(cx.listener(|v, _: &Undo, _, cx| v.undo(false, cx)))
            .on_action(cx.listener(|v, _: &Redo, _, cx| v.undo(true, cx)))
            .child(scoped)
    }
}
