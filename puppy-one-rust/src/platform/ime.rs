//! The system input method, for what GPUI does not handle itself.
//!
//! - Discarding a composition: when the app ends a composition itself (a
//!   click elsewhere, focus moving away, a command), the input method must
//!   drop its own composition state too, or its next keystroke continues the
//!   old preedit at the new caret. AppKit text views and WebKit / Chromium do
//!   the same with `-[NSTextInputContext discardMarkedText]` after committing
//!   the marked text.
//! - Function-key text: GPUI hands non-printing keys (arrows, Home, Page
//!   Down, …) to the input method first. AppKit's contract is that an input
//!   method returns those through `doCommandBySelector:`, but some (Sogou
//!   Pinyin, for one) call `insertText:` with the key's AppKit function-key
//!   character (`NSUpArrowFunctionKey` = U+F700 …) instead, and may claim
//!   the key as handled. Every GPUI text input of the app drops such text
//!   (GLFW and Chromium filter the same range) and the key is replayed
//!   through GPUI's own key dispatch when the platform did not deliver it.
use gpui::{App, Context, Keystroke, Modifiers, Window};
use std::cell::Cell;

/// Ask the current input context to discard its marked text. Call on the
/// main thread outside any input-handler callback (the input method may
/// call back into the view).
pub fn discard_marked_text() {
    #[cfg(all(target_os = "macos", not(test)))]
    // SAFETY: main thread (GPUI foreground executor); `currentInputContext`
    // returns an autoreleased context or nil, and `discardMarkedText` takes
    // no arguments and returns nothing.
    unsafe {
        use objc2::{class, msg_send, runtime::AnyObject};
        let context: *mut AnyObject = msg_send![class!(NSTextInputContext), currentInputContext];
        if let Some(context) = context.as_ref() {
            let _: () = msg_send![context, discardMarkedText];
        }
    }
}

thread_local! {
    /// Keystrokes GPUI has dispatched (see `init`).
    static DISPATCHED: Cell<u64> = const { Cell::new(0) };
}

/// Count the keystrokes GPUI dispatches, so a function key an input method
/// swallowed can be told from one GPUI delivers itself. Once per app.
pub fn init(cx: &mut App) {
    cx.observe_keystrokes(|_, _, _| DISPATCHED.with(|n| n.set(n.get().wrapping_add(1)))).detach();
}

/// AppKit's function-key characters (`NSUpArrowFunctionKey` …
/// `NSModeSwitchFunctionKey` and the rest of the OpenStep block).
fn is_function_key_char(c: char) -> bool {
    ('\u{F700}'..='\u{F8FF}').contains(&c)
}

/// Text made only of function-key characters: never document text.
pub fn is_function_key_text(text: &str) -> bool {
    !text.is_empty() && text.chars().all(is_function_key_char)
}

/// The GPUI key name of an AppKit function-key character (as GPUI's macOS
/// key parsing names it).
fn key_name(c: char) -> Option<String> {
    Some(match c as u32 {
        0xF700 => "up".into(),
        0xF701 => "down".into(),
        0xF702 => "left".into(),
        0xF703 => "right".into(),
        n @ 0xF704..=0xF726 => format!("f{}", n - 0xF704 + 1),
        // GPUI reports Insert as NSHelpFunctionKey.
        0xF727 | 0xF746 => "insert".into(),
        0xF728 => "delete".into(),
        0xF729 => "home".into(),
        0xF72B => "end".into(),
        0xF72C => "pageup".into(),
        0xF72D => "pagedown".into(),
        _ => return None,
    })
}

/// For an input handler's `replace_text_in_range` /
/// `replace_and_mark_text_in_range`: true when `text` is function-key text,
/// which the caller must drop. The key itself (with the modifiers held now)
/// is dispatched again after the current platform event, unless GPUI
/// dispatched a keystroke in the meantime (the input method handed it back).
pub fn intercept_function_key<T: 'static>(text: &str, window: &mut Window, cx: &mut Context<T>) -> bool {
    if !is_function_key_text(text) {
        return false;
    }
    let mut chars = text.chars();
    let (Some(key), None) = (chars.next().and_then(key_name), chars.next()) else { return true };
    let keystroke = Keystroke { modifiers: Modifiers { function: false, ..window.modifiers() }, key, key_char: None };
    let dispatched = DISPATCHED.with(Cell::get);
    cx.spawn_in(window, async move |_, cx| {
        if DISPATCHED.with(Cell::get) == dispatched {
            let _ = cx.update(|window, cx| window.dispatch_keystroke(keystroke, cx));
        }
    })
    .detach();
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn function_key_text_is_the_appkit_private_use_block() {
        assert!(is_function_key_text("\u{F700}") && is_function_key_text("\u{F702}\u{F703}"));
        assert!(!is_function_key_text("") && !is_function_key_text("a\u{F700}") && !is_function_key_text("中"));
        // Other private-use characters (icon fonts) stay text.
        assert!(!is_function_key_text("\u{E000}"));
        assert_eq!(key_name('\u{F701}').as_deref(), Some("down"));
        assert_eq!(key_name('\u{F70E}').as_deref(), Some("f11"));
        assert_eq!(key_name('\u{F72D}').as_deref(), Some("pagedown"));
        assert_eq!(key_name('\u{F747}'), None);
    }
}
