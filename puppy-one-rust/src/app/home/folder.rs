//! `ProjectFolderGlyph` and `HomeProjectIcon` (`components/onboarding`):
//! the website's folder in its monochrome form, drawn in fill alone from the
//! theme's `--po-project-folder-*` tones. A back with its tall tab, one
//! sheet waiting behind a lighter front, and on a Cloud project the
//! product's cloud outlined on the front. The layers are the product's paths
//! (`assets/home/folder-*.svg`), tinted and stacked.
use crate::{
    theme::{self, Theme},
    ui::components::{Icon, ProductIcon},
    workspace::cloud::catalog::Location,
};
use gpui::{prelude::*, *};
use gpui_kit::component::Sizable as _;

/// The product draws the folder on a 48 × 38 grid.
const GRID: (f32, f32) = (48., 38.);
/// How far the sheet rises when a project is reached for, in grid units
/// (`translateY(-7px)` on the SVG group).
const SHEET_RISE: f32 = 7.;

/// `--po-project-folder-*` (`styles/tokens.css`, light and `.dark`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Tones {
    pub back: Rgba,
    pub front: Rgba,
    pub sheet: Rgba,
    pub ink: Rgba,
}
pub(super) fn tones(t: Theme) -> Tones {
    if t.dark {
        let sheet = theme::mix(t.text, t.canvas, 0.90);
        Tones {
            back: theme::mix(t.text, t.canvas, 0.20),
            front: theme::mix(t.text, t.canvas, 0.32),
            sheet,
            ink: theme::mix(sheet, t.canvas, 0.80),
        }
    } else {
        let sheet = t.panel_raised;
        Tones {
            back: theme::mix(t.text, t.canvas, 0.34),
            front: theme::mix(t.text, t.canvas, 0.22),
            sheet,
            ink: theme::mix(sheet, t.text, 0.84),
        }
    }
}
/// A reached-for project's folder leans 10% towards the ink.
pub(super) fn lit(tones: Tones, t: Theme) -> Tones {
    Tones {
        back: theme::mix(tones.back, t.text, 0.90),
        front: theme::mix(tones.front, t.text, 0.90),
        ..tones
    }
}

fn layer(path: &'static str, w: f32, h: f32, color: Rgba) -> Svg {
    svg()
        .path(path)
        .absolute()
        .top_0()
        .left_0()
        .w(px(w))
        .h(px(h))
        .text_color(color)
}

/// `ProjectFolder` (the Grid's 72 × 57 folder). `rise` is how far the sheet
/// has risen, 0 at rest and 1 when reached for; `lit` tints the folder.
pub(super) fn grid_folder(location: Location, rise: f32, lit: bool, t: Theme) -> Div {
    let (w, h) = (72., 57.);
    let scale = w / GRID.0;
    let tones = if lit {
        self::lit(tones(t), t)
    } else {
        tones(t)
    };
    let sheet_top = -SHEET_RISE * scale * rise.clamp(0., 1.);
    let sheet = |path: &'static str, color| layer(path, w, h, color).top(px(sheet_top));
    div()
        .relative()
        .flex_none()
        .w(px(w))
        .h(px(h))
        .child(layer("home/folder-back.svg", w, h, tones.back))
        .child(sheet("home/folder-sheet.svg", tones.sheet))
        .child(sheet("home/folder-sheet-ink.svg", tones.ink))
        .child(layer("home/folder-front.svg", w, h, tones.front))
        .when(location == Location::CloudOnly, |d| {
            // `.project-folder-cloud`: the blue leans towards the ink.
            d.child(layer(
                "home/folder-cloud.svg",
                w,
                h,
                theme::mix(t.brand_blue, t.text, 0.84),
            ))
        })
        .when(location == Location::Linked, |d| {
            // The 16px solid blue cloud, outlined in the page, off the front.
            d.child(
                div()
                    .absolute()
                    .right(px(-4.))
                    .bottom(px(-4.))
                    .size(px(16.))
                    .child(layer("home/cloud-fill.svg", 16., 16., t.brand_blue))
                    .child(
                        Icon::product(ProductIcon::Cloud)
                            .with_size(px(16.))
                            .stroke(2.)
                            .color(t.canvas),
                    ),
            )
        })
}

/// `HomeProjectIcon` in a 14px slot. `filled` draws a folder in the
/// Homepage's fill (19 × 15, overhanging the slot); otherwise the laptop
/// mark of a local folder. A Cloud project stays its outline cloud.
pub(in crate::app) fn list_icon(
    location: Location,
    filled: bool,
    lit: bool,
    t: Theme,
) -> AnyElement {
    let base = div().relative().size(px(14.)).flex_none();
    let glyph = match location {
        Location::CloudOnly => Icon::product(ProductIcon::Cloud)
            .with_size(px(14.))
            .stroke(1.85)
            .color(t.brand_blue)
            .into_any_element(),
        _ if filled => {
            let (w, h) = (19., 15.);
            let tones = if lit {
                self::lit(tones(t), t)
            } else {
                tones(t)
            };
            // `margin: -0.5px -2.5px` around the 14px slot.
            div()
                .absolute()
                .top(px(-0.5))
                .left(px(-2.5))
                .w(px(w))
                .h(px(h))
                .child(layer("home/folder-back.svg", w, h, tones.back))
                .child(layer("home/folder-front.svg", w, h, tones.front))
                .into_any_element()
        }
        _ => Icon::product(ProductIcon::Local)
            .with_size(px(14.))
            .stroke(1.85)
            .into_any_element(),
    };
    base.child(glyph)
        .when(location == Location::Linked, |d| {
            d.child(
                div().absolute().right(px(-4.)).bottom(px(-3.)).child(
                    Icon::product(ProductIcon::Cloud)
                        .with_size(px(9.))
                        .color(t.brand_blue),
                ),
            )
        })
        .into_any_element()
}

#[cfg(test)]
#[path = "folder_tests.rs"]
mod tests;
