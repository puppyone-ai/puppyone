//! The system input method, for what GPUI does not forward: when the app
//! ends a composition itself (a click elsewhere, focus moving away, a
//! command), the input method must drop its own composition state too, or
//! its next keystroke continues the old preedit at the new caret. AppKit
//! text views and WebKit / Chromium do the same with
//! `-[NSTextInputContext discardMarkedText]` after committing the marked text.

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
