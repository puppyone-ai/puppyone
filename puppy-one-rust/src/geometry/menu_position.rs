//! Popup placement, ported from the product so a Rust menu opens at exactly
//! the rectangle the Web menu does:
//! - `resolveDesktopSidebarActionMenuPosition` (`components/DesktopSidebarActionMenu.tsx`)
//! - `getCreateEntryMenuPosition` (`features/data-workspace/nodeActions.tsx`)
//! - `resolveAnchoredOverlayPosition` (`features/app-shell/useAnchoredOverlayPosition.ts`)
//!
//! Pure geometry in window coordinates; no GPUI dependency.
use super::Rect;

/// `SIDEBAR_ACTION_MENU_GAP` / `SIDEBAR_ACTION_MENU_VIEWPORT_MARGIN`.
const SIDEBAR_ACTION_MENU_GAP: f32 = 4.;
const SIDEBAR_ACTION_MENU_VIEWPORT_MARGIN: f32 = 12.;
/// `CREATE_ENTRY_MENU_MARGIN` and the 6px gap of `getCreateEntryMenuPosition`.
const CREATE_ENTRY_MENU_MARGIN: f32 = 12.;
const CREATE_ENTRY_MENU_GAP: f32 = 6.;
/// `CREATE_ENTRY_MENU_WIDTH` / `CREATE_ENTRY_SUBMENU_WIDTH` / `CREATE_ENTRY_SUBMENU_GAP`.
pub const CREATE_ENTRY_MENU_WIDTH: f32 = 184.;
pub const CREATE_ENTRY_SUBMENU_WIDTH: f32 = 184.;
pub const CREATE_ENTRY_SUBMENU_GAP: f32 = 4.;
/// `NODE_ACTION_MENU_WIDTH`.
pub const NODE_ACTION_MENU_WIDTH: f32 = 224.;

fn clamp(value: f32, min: f32, max: f32) -> f32 {
    value.max(min).min(max)
}

/// A context menu opened by the pointer anchors on a zero-size rectangle
/// (`getContextMenuAnchorRect` → `new DOMRect(clientX, clientY, 0, 0)`).
pub fn point_anchor(x: f32, y: f32) -> Rect {
    Rect::new(x, y, 0., 0.)
}

/// `resolveDesktopSidebarActionMenuPosition`: 4px below the anchor, start
/// aligned, clamped 12px inside the viewport; never flips.
pub fn sidebar_action_menu_origin(
    anchor: Rect,
    menu_width: f32,
    estimated_height: f32,
    viewport: (f32, f32),
) -> (f32, f32) {
    let (vw, vh) = viewport;
    let margin = SIDEBAR_ACTION_MENU_VIEWPORT_MARGIN;
    let max_left = margin.max(vw - menu_width - margin);
    let max_top = margin.max(vh - estimated_height - margin);
    (
        clamp(anchor.x, margin, max_left),
        clamp(anchor.bottom() + SIDEBAR_ACTION_MENU_GAP, margin, max_top),
    )
}

/// `DesktopCreateEntryAnchor.placement`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
/// Only the placements the desktop Explorer uses: `below-start` (row "+",
/// pointer, node menu) and `auto-end` (list-end "New").
pub enum CreatePlacement {
    BelowStart,
    /// The Explorer's list-end "New" row (`sidebarLauncher`).
    AutoEnd,
}
/// Menu width for a create menu: the sidebar launcher spans its row.
pub fn create_menu_width(anchor: Rect, placement: CreatePlacement) -> f32 {
    if placement == CreatePlacement::AutoEnd {
        CREATE_ENTRY_MENU_WIDTH.max(anchor.w)
    } else {
        CREATE_ENTRY_MENU_WIDTH
    }
}
/// `getCreateEntryMenuPosition`.
pub fn create_menu_origin(
    anchor: Rect,
    placement: CreatePlacement,
    menu_width: f32,
    estimated_height: f32,
    viewport: (f32, f32),
) -> (f32, f32) {
    let (vw, vh) = viewport;
    let margin = CREATE_ENTRY_MENU_MARGIN;
    let max_left = margin.max(vw - menu_width - margin);
    let max_top = margin.max(vh - estimated_height - margin);
    let below_top = anchor.bottom() + CREATE_ENTRY_MENU_GAP;
    let above_top = anchor.y - estimated_height - CREATE_ENTRY_MENU_GAP;
    let below_fits = below_top <= max_top;
    let above_fits = above_top >= margin;
    // Both placements prefer below and flip above only when that fits.
    let top = if below_fits || !above_fits {
        below_top
    } else {
        above_top
    };
    let left = if placement == CreatePlacement::AutoEnd {
        anchor.right() - menu_width
    } else {
        anchor.x
    };
    (clamp(left, margin, max_left), clamp(top, margin, max_top))
}
/// Which side the Custom files submenu opens on (`data-submenu-side`).
pub fn create_submenu_opens_at_end(menu_left: f32, menu_width: f32, viewport_width: f32) -> bool {
    viewport_width - (menu_left + menu_width) - CREATE_ENTRY_MENU_MARGIN
        >= CREATE_ENTRY_SUBMENU_WIDTH + CREATE_ENTRY_SUBMENU_GAP
}

/// `resolveAnchoredOverlayPosition` as `DesktopTitlebarMenuLayer` uses it:
/// `placementPreference: "below"`, the viewport as the boundary.
#[derive(Clone, Copy, Debug)]
pub struct AnchoredOverlay {
    pub preferred_width: f32,
    pub preferred_max_height: f32,
    pub gap: f32,
    pub margin: f32,
    /// `alignment="center"` for the centered Header project.
    pub centered: bool,
}
/// Resolved `{left, top, width, maxHeight}` of an anchored overlay.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OverlayPosition {
    pub left: f32,
    pub top: f32,
    pub width: f32,
    pub max_height: f32,
}
pub fn anchored_overlay(
    anchor: Rect,
    options: AnchoredOverlay,
    viewport: (f32, f32),
) -> OverlayPosition {
    let (vw, vh) = viewport;
    let margin = options.margin;
    let (safe_left, safe_right) = (margin, vw - margin);
    let available_width = (safe_right - safe_left).max(1.);
    let width = options.preferred_width.min(available_width);
    let preferred_left = if options.centered {
        anchor.x + (anchor.w - width) / 2.
    } else {
        anchor.x
    };
    let left = clamp(preferred_left, safe_left, safe_left.max(safe_right - width));
    let space_below = (vh - margin - anchor.bottom() - options.gap).max(0.);
    OverlayPosition {
        left,
        top: anchor.bottom() + options.gap,
        width,
        max_height: options.preferred_max_height.min(space_below).max(1.),
    }
}
/// `DesktopTitlebarMenuLayer` defaults (margin 8) for a width, gap and
/// maximum height.
pub fn titlebar_menu(width: f32, gap: f32, max_height: f32, centered: bool) -> AnchoredOverlay {
    AnchoredOverlay {
        preferred_width: width,
        preferred_max_height: max_height,
        gap,
        margin: 8.,
        centered,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn sidebar_action_menus_open_four_pixels_below_their_trigger() {
        // The ⋮ button of the "docs" row in a 320px Explorer at 1280×800.
        let button = Rect::new(280., 91., 24., 24.);
        let (left, top) = sidebar_action_menu_origin(button, 224., 323., (1280., 800.));
        assert_eq!((left, top), (280., 119.));
        // A right click anchors at the pointer.
        let (left, top) =
            sidebar_action_menu_origin(point_anchor(200., 307.), 224., 314., (1280., 800.));
        assert_eq!((left, top), (200., 311.));
        // Near the bottom the menu is clamped, not flipped.
        let (_, top) =
            sidebar_action_menu_origin(point_anchor(200., 700.), 224., 314., (1280., 800.));
        assert_eq!(top, 800. - 314. - 12.);
        // And near the right edge it stays 12px inside.
        let (left, _) =
            sidebar_action_menu_origin(point_anchor(1250., 100.), 224., 314., (1280., 800.));
        assert_eq!(left, 1280. - 224. - 12.);
    }

    #[test]
    fn create_menus_follow_the_product_placements() {
        let plus = Rect::new(254., 91., 24., 24.);
        // Row "+" (below-start): 6px below, start aligned.
        assert_eq!(
            create_menu_origin(plus, CreatePlacement::BelowStart, 184., 177., (1280., 800.)),
            (254., 121.)
        );
        // Right click on empty Explorer space near the bottom flips above.
        let point = point_anchor(150., 700.);
        assert_eq!(
            create_menu_origin(
                point,
                CreatePlacement::BelowStart,
                184.,
                177.,
                (1280., 800.)
            ),
            (150., 700. - 177. - 6.)
        );
        // The list-end "New" row spans the row and aligns to its end.
        let new_row = Rect::new(12., 325., 296., 32.);
        let width = create_menu_width(new_row, CreatePlacement::AutoEnd);
        assert_eq!(width, 296.);
        assert_eq!(
            create_menu_origin(
                new_row,
                CreatePlacement::AutoEnd,
                width,
                168.,
                (1280., 800.)
            ),
            (12., 363.)
        );
        // A narrow row still gets the 184px menu, ending at the row's end.
        let narrow = Rect::new(12., 325., 150., 32.);
        let width = create_menu_width(narrow, CreatePlacement::AutoEnd);
        assert_eq!(width, 184.);
        assert_eq!(
            create_menu_origin(narrow, CreatePlacement::AutoEnd, width, 168., (1280., 800.)).0,
            12.
        );
        assert!(create_submenu_opens_at_end(254., 184., 1280.));
        assert!(!create_submenu_opens_at_end(1000., 184., 1280.));
    }

    #[test]
    fn titlebar_menus_hang_below_their_trigger() {
        let trigger = Rect::new(86., 6., 75.2, 28.);
        let p = anchored_overlay(trigger, titlebar_menu(240., 2., 520., false), (1280., 800.));
        assert_eq!((p.left, p.top, p.width), (86., 36., 240.));
        assert_eq!(p.max_height, 520.);
        // Clamped 8px inside the right edge.
        let right = Rect::new(1200., 6., 60., 28.);
        let p = anchored_overlay(right, titlebar_menu(240., 2., 520., false), (1280., 800.));
        assert_eq!(p.left, 1280. - 8. - 240.);
        // A short window limits the height to the space below.
        let p = anchored_overlay(trigger, titlebar_menu(240., 2., 520., false), (1280., 400.));
        assert_eq!(p.max_height, 400. - 8. - 34. - 2.);
        // The centered Header project centres its menu on the trigger.
        let centered = Rect::new(600., 6., 80., 28.);
        let p = anchored_overlay(centered, titlebar_menu(240., 2., 520., true), (1280., 800.));
        assert_eq!(p.left, 520.);
    }
}
