//! Copy buttons that answer: after a copy the button shows `check` for a
//! moment. Keyed by the window and the button's key, so stateless renderers
//! (Markdown code blocks, tool output) get the same feedback as views with
//! state, and a copy in one window never shows in another.
//!
//! The glyph turns over to `check` in [`FLIP`], holds still, and turns back
//! in the last [`FLIP`] of [`SHOWN_FOR`]: frames are drawn only while it
//! turns (`ui::motion`), and two timers redraw the window when the turn back
//! starts and when the feedback ends. With reduced motion it shows `check`
//! still for the whole time.
use crate::ui::motion::Timeline;
use gpui::{App, ClipboardItem, Global, SharedString, Window, WindowId};
use std::collections::HashMap;
use std::time::{Duration, Instant};

/// How long `check` stays.
pub const SHOWN_FOR: Duration = Duration::from_secs(2);
/// How long one flip (`copy` to `check`, or back) takes.
pub const FLIP: Duration = Duration::from_millis(260);

/// When each `(window, key)` was copied.
#[derive(Default)]
struct Copied(HashMap<(WindowId, SharedString), Instant>);
impl Global for Copied {}

/// Copy `text` for the button `key` of `window` and redraw when its glyph
/// turns back and when its `check` ends.
pub fn copy(key: &str, text: String, window: &mut Window, cx: &mut App) {
    cx.write_to_clipboard(ClipboardItem::new_string(text));
    let id = window.window_handle().window_id();
    let copied = &mut cx.default_global::<Copied>().0;
    copied.retain(|_, at| at.elapsed() < SHOWN_FOR);
    copied.insert((id, SharedString::from(key.to_owned())), Instant::now());
    window.refresh();
    let handle = window.window_handle();
    cx.spawn(async move |cx| {
        for wait in [SHOWN_FOR - FLIP, FLIP + Duration::from_millis(50)] {
            cx.background_executor().timer(wait).await;
            if handle.update(cx, |_, window, _| window.refresh()).is_err() {
                return;
            }
        }
    })
    .detach();
}

/// When the button `key` of `window` was copied, while its `check` shows.
pub fn started(key: &str, window: &Window, cx: &App) -> Option<Instant> {
    let id = window.window_handle().window_id();
    cx.try_global::<Copied>()?
        .0
        .get(&(id, SharedString::from(key.to_owned())))
        .copied()
        .filter(|at| at.elapsed() < SHOWN_FOR)
}

/// The button `key` of `window` was copied within [`SHOWN_FOR`].
pub fn copied(key: &str, window: &Window, cx: &App) -> bool {
    started(key, window, cx).is_some()
}

/// The glyph of a copy made `at`: its name, its horizontal scale (a card
/// turning about its vertical axis, changing glyph when edge-on) and whether
/// it is turning, so the next frame is wanted. Still `check` between the two
/// turns, and throughout with `reduce_motion`.
pub fn face(at: Instant, reduce_motion: bool) -> (&'static str, f32, bool) {
    let turn = |p: f32| (std::f32::consts::PI * p).cos().abs().max(0.02);
    let back = SHOWN_FOR.saturating_sub(FLIP);
    let elapsed = at.elapsed();
    if elapsed >= SHOWN_FOR {
        ("copy", 1., false)
    } else if reduce_motion || (FLIP..back).contains(&elapsed) {
        ("check", 1., false)
    } else if elapsed < FLIP {
        let p = Timeline::since(at, FLIP).time();
        (if p < 0.5 { "copy" } else { "check" }, turn(p), true)
    } else {
        let p = Timeline::since(at + back, FLIP).time();
        (if p < 0.5 { "check" } else { "copy" }, turn(p), true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ms(n: u64) -> Duration {
        Duration::from_millis(n)
    }
    /// The glyph of a copy made `ago`.
    fn at(ago: Duration, reduce: bool) -> (&'static str, f32, bool) {
        face(Instant::now() - ago, reduce)
    }

    #[test]
    fn the_glyph_flips_to_check_holds_still_and_flips_back() {
        let edge = FLIP / 2;
        assert_eq!(at(ms(0), false).0, "copy");
        assert!(at(ms(0), false).2, "turning");
        let before = at(edge - ms(20), false);
        assert!(before.0 == "copy" && before.1 < 0.3);
        assert_eq!(at(edge + ms(20), false).0, "check");
        // Between the turns nothing moves, so no frame is wanted.
        assert_eq!(at(ms(1000), false), ("check", 1., false));
        let back = SHOWN_FOR - FLIP;
        assert!(at(back + ms(20), false).2);
        assert_eq!(at(back + edge - ms(20), false).0, "check");
        assert_eq!(at(back + edge + ms(20), false).0, "copy");
        assert_eq!(at(SHOWN_FOR, false), ("copy", 1., false));
    }

    #[test]
    fn reduced_motion_shows_check_without_turning() {
        for n in [0, 100, 1000, 1900] {
            assert_eq!(at(ms(n), true), ("check", 1., false));
        }
    }
}
