//! Copy buttons that answer: after a copy the button shows `check` for a
//! moment. Keyed by the button's id, so stateless renderers (Markdown code
//! blocks, tool output) get the same feedback as views with state.
use gpui::{App, ClipboardItem, Window};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// How long `check` stays.
pub const SHOWN_FOR: Duration = Duration::from_secs(2);
static COPIED: Mutex<Option<HashMap<String, Instant>>> = Mutex::new(None);

/// Copy `text` for the button `key` and redraw when its `check` ends.
pub fn copy(key: &str, text: String, window: &mut Window, cx: &mut App) {
    cx.write_to_clipboard(ClipboardItem::new_string(text));
    if let Ok(mut copied) = COPIED.lock() {
        let copied = copied.get_or_insert_with(HashMap::new);
        copied.retain(|_, at| at.elapsed() < SHOWN_FOR);
        copied.insert(key.to_owned(), Instant::now());
    }
    window.refresh();
    let handle = window.window_handle();
    cx.spawn(async move |cx| {
        cx.background_executor()
            .timer(SHOWN_FOR + Duration::from_millis(50))
            .await;
        let _ = handle.update(cx, |_, window, _| window.refresh());
    })
    .detach();
}

/// The button `key` was copied within [`SHOWN_FOR`].
pub fn copied(key: &str) -> bool {
    COPIED
        .lock()
        .ok()
        .and_then(|c| c.as_ref()?.get(key).copied())
        .is_some_and(|at| at.elapsed() < SHOWN_FOR)
}

/// When `key` was copied, while its `check` shows.
pub fn started(key: &str) -> Option<Instant> {
    COPIED
        .lock()
        .ok()
        .and_then(|c| c.as_ref()?.get(key).copied())
        .filter(|at| at.elapsed() < SHOWN_FOR)
}

/// How long one flip (`copy` to `check`, or back) takes.
const FLIP: Duration = Duration::from_millis(260);

/// The glyph and its horizontal scale at `delta` of [`SHOWN_FOR`]: a card
/// turning about its vertical axis, `copy` to `check` at the start and back
/// at the end; the glyph changes when it is edge-on.
pub fn flip(delta: f32) -> (&'static str, f32) {
    let flip = FLIP.as_secs_f32() / SHOWN_FOR.as_secs_f32();
    let turn = |p: f32| (std::f32::consts::PI * p).cos().abs().max(0.02);
    if delta < flip {
        let p = delta / flip;
        (if p < 0.5 { "copy" } else { "check" }, turn(p))
    } else if delta > 1. - flip {
        let p = (delta - (1. - flip)) / flip;
        (if p < 0.5 { "check" } else { "copy" }, turn(p))
    } else {
        ("check", 1.)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_glyph_flips_to_check_and_back_when_edge_on() {
        assert_eq!(flip(0.), ("copy", 1.));
        let edge = FLIP.as_secs_f32() / SHOWN_FOR.as_secs_f32() / 2.;
        assert!(flip(edge - 0.001).1 < 0.05 && flip(edge - 0.001).0 == "copy");
        assert_eq!(flip(edge + 0.001).0, "check");
        assert_eq!(flip(0.5), ("check", 1.));
        assert_eq!(flip(1. - edge + 0.001).0, "copy");
        assert!((flip(1.).1 - 1.).abs() < 1e-3 && flip(1.).0 == "copy");
    }
}
