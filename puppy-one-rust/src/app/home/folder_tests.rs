//! The folder glyph's tones (ProjectFolderGlyph).
use super::*;
use core::prelude::v1::test;

#[test]
fn folder_tones_follow_the_product_formulas() {
    let mut t = crate::theme::pack_theme(&crate::theme::pack_id(), false);
    t.text = rgb(0x000000);
    t.canvas = rgb(0xffffff);
    t.panel_raised = rgb(0xffffff);
    let light = tones(t);
    // color-mix(in srgb, text 34%, canvas): 66% white.
    assert!((light.back.r - 0.66).abs() < 1e-4);
    assert!((light.front.r - 0.78).abs() < 1e-4);
    assert_eq!(light.sheet, t.panel_raised);
    let mut d = t;
    d.dark = true;
    let dark = tones(d);
    assert!((dark.back.r - 0.80).abs() < 1e-4);
    assert!((dark.front.r - 0.68).abs() < 1e-4);
    // Lit tones mix 10% of the ink in.
    let lit = lit(light, t);
    assert!((lit.back.r - 0.66 * 0.9).abs() < 1e-4);
    assert_eq!(lit.sheet, light.sheet);
}
