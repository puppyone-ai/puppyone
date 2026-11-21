use super::*;
use core::prelude::v1::test;

#[test]
fn window_hooks_are_safe_to_call_in_tests() {
    // `reduce_motion` and `match_product_font_smoothing` must never panic
    // in headless test runners on any OS.
    let _ = reduce_motion();
    match_product_font_smoothing();
    discard_marked_text();
}
