//! Pointer drag-selection and focus transitions
//! (product `core/state/pointerSelection.ts`, `livePreviewFocus.ts`).

#[derive(Clone, Copy, Debug)]
pub(super) struct FocusPointerTransition {
    pub(super) entered_focus: bool,
    pub(super) released_pointer: bool,
}

pub(super) fn transition(
    prev_focused: bool,
    prev_selecting: bool,
    focused: bool,
    selecting: bool,
) -> FocusPointerTransition {
    FocusPointerTransition {
        entered_focus: focused && !prev_focused,
        released_pointer: prev_selecting && !selecting,
    }
}

/// Whether inline reveal changes should stay frozen for the current selection
/// update so line boxes do not jump mid-drag or while unfocused.
pub(super) fn should_freeze_reveal(
    transition: FocusPointerTransition,
    selection_empty: bool,
    focused: bool,
    selecting: bool,
) -> bool {
    if selecting || !focused {
        return true;
    }
    !selection_empty && !transition.entered_focus && !transition.released_pointer
}
