//! The pane layout policy (`app-shell/layout/desktopPaneLayout.ts` and
//! `window-layout-contract.mjs`): how wide each open pane gets in a window,
//! the live maxima of a dragged edge, the native window minimum, and the
//! window rectangles every shell surface is placed in. The pane constants
//! themselves are tokens (`theme::pane`), shared with the stored preferences.
use crate::{
    geometry::Rect,
    theme::{HEADER, footer, pane},
};

/// `resolveDesktopPaneLayout().minimumWidth`: the main pane floor plus the
/// minimum of every open side pane (and the Explorer's gutter).
fn pane_minimum_width(explorer_open: bool, right_open: bool) -> f32 {
    use pane::*;
    let when = |open: bool, value: f32| if open { value } else { 0. };
    MIN_MAIN_PANE_WIDTH
        + when(
            explorer_open,
            EXPLORER_RESIZE_GUTTER_WIDTH + MIN_EXPLORER_WIDTH,
        )
        + when(right_open, MIN_RIGHT_SIDEBAR_WIDTH)
}
/// `window-layout:set-minimum-width`: the native window never gets narrower
/// than the open panes' minima (plus the project rail), nor the product floor.
pub(super) fn window_minimum_width(explorer_open: bool, right_open: bool, rail: f32) -> f32 {
    (pane_minimum_width(explorer_open, right_open) + rail).max(pane::WINDOW_MIN_WIDTH)
}
/// `resolveDesktopPaneLayout`: `(explorer, right sidebar, layout width)` for
/// the preferred widths of the open panes (`0` = closed). Passive window
/// resizing consumes the main pane first, then the auxiliary pane, then the
/// Explorer; when every minimum cannot fit, the layout keeps its minimum
/// width; the shell raises the native window minimum to match
/// (`window_minimum_width`), so this only happens where the window cannot
/// grow (full screen).
pub(super) fn resolve_pane_widths(available: f32, explorer: f32, right: f32) -> (f32, f32, f32) {
    use pane::*;
    let width = available.max(0.).round();
    let (explorer_open, right_open) = (explorer > 0., right > 0.);
    let when = |open: bool, value: f32| if open { value } else { 0. };
    let gutter = when(explorer_open, EXPLORER_RESIZE_GUTTER_WIDTH);
    let layout = width.max(pane_minimum_width(explorer_open, right_open));
    let right_max = width.max(MIN_RIGHT_SIDEBAR_WIDTH);
    let mut explorer_width = when(
        explorer_open,
        explorer
            .round()
            .clamp(MIN_EXPLORER_WIDTH, MAX_EXPLORER_WIDTH),
    );
    let mut right_width = when(
        right_open,
        right.round().clamp(MIN_RIGHT_SIDEBAR_WIDTH, right_max),
    );
    let mut deficit =
        (MIN_MAIN_PANE_WIDTH - (layout - gutter - explorer_width - right_width)).max(0.);
    if deficit > 0. && right_open {
        let reclaimed = deficit.min(right_width - MIN_RIGHT_SIDEBAR_WIDTH);
        right_width -= reclaimed;
        deficit -= reclaimed;
    }
    if deficit > 0. && explorer_open {
        explorer_width -= deficit.min(explorer_width - MIN_EXPLORER_WIDTH);
    }
    (explorer_width, right_width, layout)
}
/// Live maximum of a dragged Explorer (`explorer.maxWidth`): what remains
/// after its gutter, the main pane floor and an open right sidebar's minimum,
/// within the Explorer's own range.
pub(super) fn explorer_max_width(available: f32, right_open: bool) -> f32 {
    use pane::*;
    let right = if right_open {
        MIN_RIGHT_SIDEBAR_WIDTH
    } else {
        0.
    };
    (available.max(pane_minimum_width(true, right_open))
        - EXPLORER_RESIZE_GUTTER_WIDTH
        - MIN_MAIN_PANE_WIDTH
        - right)
        .clamp(MIN_EXPLORER_WIDTH, MAX_EXPLORER_WIDTH)
}
/// Live maximum of a dragged right sidebar: what remains after the current
/// Explorer, its gutter and the main pane floor (`rightSidebar.maxWidth`).
pub(super) fn right_sidebar_max_width(available: f32, explorer: f32) -> f32 {
    use pane::*;
    let gutter = if explorer > 0. {
        EXPLORER_RESIZE_GUTTER_WIDTH
    } else {
        0.
    };
    (available - gutter - MIN_MAIN_PANE_WIDTH - explorer).clamp(
        MIN_RIGHT_SIDEBAR_WIDTH,
        available.max(MIN_RIGHT_SIDEBAR_WIDTH),
    )
}
/// Where every shell surface sits in the window. The editor pane
/// (`.desktop-editor-pane`) fills the main pane: the Explorer's divider is
/// its own last column (`.po-pane-edge-chrome`), and the pane edges overlay
/// their neighbours instead of reserving a strip.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(in crate::shell) struct Layout {
    pub header: Rect,
    pub explorer: Rect,
    pub footer: Rect,
    pub editor: Rect,
    pub auxiliary: Rect,
}
impl Layout {
    /// `left` / `right` are the preferred widths of the open panes (`0` when
    /// closed); the product pane policy resolves what they get.
    pub(in crate::shell) fn new(w: f32, h: f32, left: f32, right: f32, rail: f32) -> Self {
        let (left, right, layout) = resolve_pane_widths(w - rail, left, right);
        let main = layout - left - right;
        let footer = footer();
        Self {
            header: Rect::new(0., 0., w, HEADER),
            explorer: Rect::new(rail, HEADER, left, h - HEADER - footer),
            footer: Rect::new(rail, h - footer, left, footer),
            editor: Rect::new(rail + left, HEADER, main, h - HEADER),
            auxiliary: Rect::new(rail + left + main, HEADER, right, h - HEADER),
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{theme::set_scale, typography::Scale};
    use core::prelude::v1::test;
    #[test]
    fn panes_tile_without_overlapping() {
        for w in [640., 875., 1280., 1920.] {
            for rail in [0., 56.] {
                let l = Layout::new(w, 800., 320., 560., rail);
                assert_eq!(l.explorer.right(), l.editor.x);
                assert_eq!(l.editor.right(), l.auxiliary.x);
                assert!(l.editor.w >= pane::MIN_MAIN_PANE_WIDTH);
                assert_eq!(l.header.h, 40.);
                assert_eq!(l.footer.h, 48.);
            }
        }
    }
    #[test]
    fn pane_widths_follow_the_product_policy() {
        // Defaults at 1280: Explorer 320, right sidebar 560, main 400.
        let l = Layout::new(1280., 800., 320., 560., 0.);
        assert_eq!(
            (l.explorer.w, l.editor.w, l.auxiliary.w),
            (320., 400., 560.)
        );
        assert_eq!(l.auxiliary.x, 720.);
        // Narrowing the window takes the main pane down to its 320 floor
        // (plus the 8px Explorer gutter), then the auxiliary pane yields.
        assert_eq!(resolve_pane_widths(1208., 320., 560.).1, 560.);
        assert_eq!(resolve_pane_widths(1000., 320., 560.).1, 352.);
        // Only once the auxiliary pane is at its minimum does the Explorer.
        assert_eq!(resolve_pane_widths(900., 320., 560.), (252., 320., 900.));
        // Below every minimum the layout keeps its minimum width.
        assert_eq!(resolve_pane_widths(700., 320., 560.), (220., 320., 868.));
        // Preferences are clamped to each pane's range.
        assert_eq!(resolve_pane_widths(1600., 100., 0.), (220., 0., 1600.));
        assert_eq!(resolve_pane_widths(1600., 900., 0.), (520., 0., 1600.));
        assert_eq!(right_sidebar_max_width(1280., 320.), 632.);
        // The Explorer keeps the main floor and an open right sidebar's minimum.
        assert_eq!(explorer_max_width(1280., false), 520.);
        assert_eq!(explorer_max_width(1000., true), 352.);
        assert_eq!(explorer_max_width(700., true), 220.);
    }
    #[test]
    fn the_window_minimum_follows_the_open_panes() {
        assert_eq!(window_minimum_width(true, true, 0.), 868.);
        assert_eq!(window_minimum_width(true, true, 56.), 924.);
        assert_eq!(window_minimum_width(true, false, 0.), 640.);
        assert_eq!(window_minimum_width(false, true, 0.), 640.);
        assert_eq!(window_minimum_width(false, false, 0.), 640.);
    }
    #[test]
    fn sidebar_footer_follows_the_navigation_height_formula() {
        // control + outer 12 + inner 4, per text-size preset.
        for (preset, height) in [
            (Scale::Small, 46.),
            (Scale::Medium, 48.),
            (Scale::Large, 50.),
        ] {
            set_scale(preset);
            assert_eq!(footer(), height);
            let l = Layout::new(1280., 800., 320., 0., 0.);
            assert_eq!(l.footer.h, height);
            assert_eq!(l.explorer.bottom(), l.footer.y);
        }
        set_scale(Scale::Medium);
    }
    #[test]
    fn collapsed_panels_consume_no_space() {
        assert_eq!(Layout::new(875., 701., 0., 0., 0.).editor.w, 875.);
    }
}
