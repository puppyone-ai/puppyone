//! The editor view (CodeMirror `@codemirror/view` counterpart) on GPUI Kit's
//! `editor_host`: Kit lays out and paints every text leaf; the view owns the
//! document state, decorations, the host boxes around the text, selection,
//! caret, IME, pointer and keyboard. Formats plug in through
//! `EditorExtension` and block widgets.
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
#[cfg(test)]
mod ime_tests;
mod input;
pub mod layout;
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
        ToggleBold,
        ToggleItalic,
        ToggleStrike,
        ToggleCode,
        ToggleUnderline,
        InsertLink,
        Cancel,
        Heading0,
        Heading1,
        Heading2,
        Heading3,
        Heading4,
        Heading5,
        Heading6,
        ToggleBulletList,
        ToggleOrderedList,
        ToggleTaskList,
        ToggleQuote,
    ]
);

/// Key context of every native document editor.
pub const KEY_CONTEXT: &str = "PuppyEditor";

/// macOS standard keymap (CodeMirror `standardKeymap` + platform motions).
pub fn bind_keys(cx: &mut App) {
    let c = Some(KEY_CONTEXT);
    cx.bind_keys([
        KeyBinding::new("left", MoveLeft, c),
        KeyBinding::new("right", MoveRight, c),
        KeyBinding::new("up", MoveUp, c),
        KeyBinding::new("down", MoveDown, c),
        KeyBinding::new("alt-left", MoveGroupLeft, c),
        KeyBinding::new("alt-right", MoveGroupRight, c),
        KeyBinding::new("cmd-left", MoveLineStart, c),
        KeyBinding::new("cmd-right", MoveLineEnd, c),
        KeyBinding::new("home", MoveLineStart, c),
        KeyBinding::new("end", MoveLineEnd, c),
        KeyBinding::new("ctrl-a", MoveLineStart, c),
        KeyBinding::new("ctrl-e", MoveLineEnd, c),
        KeyBinding::new("cmd-up", MoveDocStart, c),
        KeyBinding::new("cmd-down", MoveDocEnd, c),
        KeyBinding::new("pageup", MovePageUp, c),
        KeyBinding::new("pagedown", MovePageDown, c),
        KeyBinding::new("shift-left", SelectLeft, c),
        KeyBinding::new("shift-right", SelectRight, c),
        KeyBinding::new("shift-up", SelectUp, c),
        KeyBinding::new("shift-down", SelectDown, c),
        KeyBinding::new("alt-shift-left", SelectGroupLeft, c),
        KeyBinding::new("alt-shift-right", SelectGroupRight, c),
        KeyBinding::new("cmd-shift-left", SelectLineStart, c),
        KeyBinding::new("cmd-shift-right", SelectLineEnd, c),
        KeyBinding::new("shift-home", SelectLineStart, c),
        KeyBinding::new("shift-end", SelectLineEnd, c),
        KeyBinding::new("cmd-shift-up", SelectDocStart, c),
        KeyBinding::new("cmd-shift-down", SelectDocEnd, c),
        KeyBinding::new("shift-pageup", SelectPageUp, c),
        KeyBinding::new("shift-pagedown", SelectPageDown, c),
        KeyBinding::new("backspace", DeleteBackward, c),
        KeyBinding::new("shift-backspace", DeleteBackward, c),
        KeyBinding::new("delete", DeleteForward, c),
        KeyBinding::new("ctrl-d", DeleteForward, c),
        KeyBinding::new("alt-backspace", DeleteGroupBackward, c),
        KeyBinding::new("alt-delete", DeleteGroupForward, c),
        KeyBinding::new("cmd-backspace", DeleteLineBackward, c),
        KeyBinding::new("enter", InsertNewline, c),
        KeyBinding::new("shift-enter", InsertSoftNewline, c),
        KeyBinding::new("tab", Indent, c),
        KeyBinding::new("shift-tab", Outdent, c),
        // markdownEditingKeymap / markdownFormatHotkeys.
        KeyBinding::new("cmd-b", ToggleBold, c),
        KeyBinding::new("cmd-i", ToggleItalic, c),
        KeyBinding::new("cmd-u", ToggleUnderline, c),
        KeyBinding::new("cmd-d", ToggleStrike, c),
        KeyBinding::new("cmd-shift-x", ToggleStrike, c),
        KeyBinding::new("cmd-e", ToggleCode, c),
        KeyBinding::new("cmd-k", InsertLink, c),
        KeyBinding::new("escape", Cancel, c),
        KeyBinding::new("cmd-0", Heading0, c),
        KeyBinding::new("cmd-1", Heading1, c),
        KeyBinding::new("cmd-2", Heading2, c),
        KeyBinding::new("cmd-3", Heading3, c),
        KeyBinding::new("cmd-4", Heading4, c),
        KeyBinding::new("cmd-5", Heading5, c),
        KeyBinding::new("cmd-6", Heading6, c),
        KeyBinding::new("cmd-shift-7", ToggleOrderedList, c),
        KeyBinding::new("cmd-shift-8", ToggleBulletList, c),
        KeyBinding::new("cmd-shift-9", ToggleTaskList, c),
        KeyBinding::new("cmd-shift-.", ToggleQuote, c),
        KeyBinding::new("cmd-a", SelectAll, c),
        KeyBinding::new("cmd-c", Copy, c),
        KeyBinding::new("cmd-x", Cut, c),
        KeyBinding::new("cmd-v", Paste, c),
        KeyBinding::new("cmd-z", Undo, c),
        KeyBinding::new("cmd-shift-z", Redo, c),
    ]);
}

macro_rules! motion {
    ($view:ident, $div:ident, $cx:ident, $($action:ident => $motion:expr, $extend:expr;)*) => {
        $(let $div = $div.on_action($cx.listener(|v: &mut EditorView, _: &$action, _, cx| v.motion($motion, $extend, cx)));)*
    };
}

impl Render for EditorView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.watch_focus(window, cx);
        let root = div()
            .id("puppy-editor")
            .size_full()
            .key_context(KEY_CONTEXT)
            .track_focus(&self.focus)
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
            .on_action(cx.listener(|v, _: &ToggleBold, _, cx| v.edit_intent(EditIntent::Bold, cx)))
            .on_action(
                cx.listener(|v, _: &ToggleItalic, _, cx| v.edit_intent(EditIntent::Italic, cx)),
            )
            .on_action(
                cx.listener(|v, _: &ToggleStrike, _, cx| v.edit_intent(EditIntent::Strike, cx)),
            )
            .on_action(cx.listener(|v, _: &ToggleCode, _, cx| v.edit_intent(EditIntent::Code, cx)))
            .on_action(
                cx.listener(|v, _: &ToggleUnderline, _, cx| {
                    v.edit_intent(EditIntent::Underline, cx)
                }),
            )
            .on_action(cx.listener(|v, _: &InsertLink, _, cx| v.edit_intent(EditIntent::Link, cx)))
            .on_action(cx.listener(|v, _: &Cancel, _, cx| v.edit_intent(EditIntent::Escape, cx)))
            .on_action(
                cx.listener(|v, _: &Heading0, _, cx| v.edit_intent(EditIntent::Heading(0), cx)),
            )
            .on_action(
                cx.listener(|v, _: &Heading1, _, cx| v.edit_intent(EditIntent::Heading(1), cx)),
            )
            .on_action(
                cx.listener(|v, _: &Heading2, _, cx| v.edit_intent(EditIntent::Heading(2), cx)),
            )
            .on_action(
                cx.listener(|v, _: &Heading3, _, cx| v.edit_intent(EditIntent::Heading(3), cx)),
            )
            .on_action(
                cx.listener(|v, _: &Heading4, _, cx| v.edit_intent(EditIntent::Heading(4), cx)),
            )
            .on_action(
                cx.listener(|v, _: &Heading5, _, cx| v.edit_intent(EditIntent::Heading(5), cx)),
            )
            .on_action(
                cx.listener(|v, _: &Heading6, _, cx| v.edit_intent(EditIntent::Heading(6), cx)),
            )
            .on_action(cx.listener(|v, _: &ToggleBulletList, _, cx| {
                v.edit_intent(EditIntent::BulletList, cx)
            }))
            .on_action(cx.listener(|v, _: &ToggleOrderedList, _, cx| {
                v.edit_intent(EditIntent::OrderedList, cx)
            }))
            .on_action(
                cx.listener(|v, _: &ToggleTaskList, _, cx| v.edit_intent(EditIntent::TaskList, cx)),
            )
            .on_action(
                cx.listener(|v, _: &ToggleQuote, _, cx| v.edit_intent(EditIntent::Quote, cx)),
            )
            .on_action(cx.listener(|v, _: &SelectAll, _, cx| v.select_all(cx)))
            .on_action(cx.listener(|v, _: &Copy, _, cx| v.copy(false, cx)))
            .on_action(cx.listener(|v, _: &Cut, _, cx| v.copy(true, cx)))
            .on_action(cx.listener(|v, _: &Paste, w, cx| v.paste(w, cx)))
            .on_action(cx.listener(|v, _: &Undo, _, cx| v.undo(false, cx)))
            .on_action(cx.listener(|v, _: &Redo, _, cx| v.undo(true, cx)))
            .child(EditorElement { view: cx.entity() })
    }
}
