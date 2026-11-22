//! Table focus, blur, and Escape gesture-cancellation helpers
//! (`tableFocus.ts`, extracted from `interaction.rs`).
use super::interaction::TableUi;
use gpui::{Context, Window};

/// Cancels any active drag or resize gesture (e.g. on window blur) without
/// opening a menu or modifying the document.
pub(super) fn cancel_active_gesture(ui: &mut TableUi, cx: &mut Context<TableUi>) {
    let mut changed = false;
    if ui.gestures.drag.take().is_some() {
        changed = true;
    }
    if ui.gestures.resizing.take().is_some() {
        ui.live = None;
        changed = true;
    }
    if changed {
        cx.notify();
    }
}

/// Handles window-level Escape: cancels an active drag/resize or clears a
/// structural selection wherever focus is (leaving an open menu to handle
/// its own Escape and focus restoration).
pub(super) fn handle_escape(ui: &mut TableUi, cx: &mut Context<TableUi>) -> bool {
    if ui.gestures.resizing.take().is_some() {
        ui.live = None;
        cx.notify();
        return true;
    }
    if ui.gestures.drag.take().is_some() {
        cx.notify();
        return true;
    }
    if ui.gestures.structural.take().is_some() {
        cx.notify();
        return true;
    }
    false
}

/// Restores focus back to the owning editor after a table menu dismisses.
pub(super) fn restore_editor_focus(ui: &TableUi, window: &mut Window, cx: &mut Context<TableUi>) {
    if let Some(frame) = &ui.frame {
        (frame.focus_editor)(window, cx);
    }
}
