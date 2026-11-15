//! The folder glyph's tones and sheet stacking (`ProjectFolderGlyph`).
use super::*;
use core::prelude::v1::test;

#[test]
fn folder_tones_follow_the_product_formulas() {
    let mut t = crate::theme::pack_theme(&crate::theme::pack_id(), false);
    t.text = rgb(0x000000);
    t.canvas = rgb(0xffffff);
    t.panel_raised = rgb(0xffffff);

    // Light base: back = 66% white, front = 78% white; resting mixes 80% / 78% into canvas.
    let light = tones(t);
    assert!((light.back.r - (0.66 * 0.80 + 0.20)).abs() < 1e-4);
    assert!((light.front.r - (0.78 * 0.78 + 0.22)).abs() < 1e-4);

    // Lit mixes 90% / 88% into canvas.
    let light_lit = lit(t);
    assert!((light_lit.back.r - (0.66 * 0.90 + 0.10)).abs() < 1e-4);
    assert!((light_lit.front.r - (0.78 * 0.88 + 0.12)).abs() < 1e-4);

    // Dark base: back = 80% white, front = 68% white; resting mixes 80% / 78% into canvas.
    let mut d = t;
    d.dark = true;
    let dark = tones(d);
    assert!((dark.back.r - (0.80 * 0.80 + 0.20)).abs() < 1e-4);
    assert!((dark.front.r - (0.68 * 0.78 + 0.22)).abs() < 1e-4);
}

#[test]
fn three_sheet_fan_places_center_sheet_on_top() {
    let (placements, order) = grid_sheet_placements(3);
    assert_eq!(placements.len(), 3);
    assert_eq!(order, &[0, 2, 1]);
}
