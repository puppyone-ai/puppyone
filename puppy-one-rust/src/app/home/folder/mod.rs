//! `ProjectFolderGlyph` and `HomeProjectIcon` (`components/onboarding`):
//! every project's folder on Home and in the switcher rail. Empty and
//! file-bearing folders share one `104 × 78` SVG silhouette (`34 × 26` in List
//! rows) so adjacent projects align identically; a folder whose root holds
//! files shows up to three sheets between its back and front, each printed
//! with the layout of its kind (`sheet`).
mod sheet;
#[cfg(test)]
mod tests;

use super::previews::{PreviewKind, ProjectAssetPreview};
use crate::{
    theme::{self, Theme},
    ui::{
        appearance::ActiveAppearance as _,
        components::{Icon, ProductIcon},
    },
    workspace::cloud::catalog::Location,
};
use gpui::{prelude::*, *};
use gpui_kit::component::Sizable as _;

pub(super) const GRID_FOLDER_SIZE: (f32, f32) = (104., 78.);
pub(super) const LIST_FOLDER_SIZE: (f32, f32) = (34., 26.);

/// A Cloud Agent connected to a Cloud project (named in its tile's tooltip).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::app) struct FolderAgentBadge {
    pub id: String,
    pub name: String,
    pub avatar: Option<String>,
}

/// `--po-project-folder-back` / `--po-project-folder-front` mixed into canvas.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Tones {
    pub back: Rgba,
    pub front: Rgba,
}

fn base_tones(t: Theme) -> Tones {
    if t.dark {
        Tones {
            back: theme::mix(t.text, t.canvas, 0.20),
            front: theme::mix(t.text, t.canvas, 0.32),
        }
    } else {
        Tones {
            back: theme::mix(t.text, t.canvas, 0.34),
            front: theme::mix(t.text, t.canvas, 0.22),
        }
    }
}

/// Resting fill (`80%` back, `78%` front against `--po-canvas`).
pub(super) fn tones(t: Theme) -> Tones {
    let base = base_tones(t);
    Tones {
        back: theme::mix(base.back, t.canvas, 0.80),
        front: theme::mix(base.front, t.canvas, 0.78),
    }
}

/// Hovered / focused / menu-open fill (`90%` back, `88%` front against `--po-canvas`).
pub(super) fn lit(t: Theme) -> Tones {
    let base = base_tones(t);
    Tones {
        back: theme::mix(base.back, t.canvas, 0.90),
        front: theme::mix(base.front, t.canvas, 0.88),
    }
}

/// Fades an unavailable (`0.4`) or offline (`0.5`) folder cleanly into `--po-canvas`.
pub(super) fn faded(tones: Tones, strength: Option<f32>, t: Theme) -> Tones {
    let Some(w) = strength else { return tones };
    let fade = |c| theme::mix(c, t.canvas, w);
    Tones {
        back: fade(tones.back),
        front: fade(tones.front),
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

/// `ProjectFolderGlyph`: `104 × 78` Grid folder or `34 × 26` compact List
/// folder, with a sheet peeking out for each of up to three root files.
#[derive(IntoElement)]
pub(in crate::app::home) struct ProjectFolderGlyph {
    compact: bool,
    sheets: Vec<PreviewKind>,
    is_lit: bool,
    fade: Option<f32>,
}

impl ProjectFolderGlyph {
    /// `previews`: the root files read so far, in preview order.
    pub fn grid(previews: &[ProjectAssetPreview]) -> Self {
        Self {
            compact: false,
            sheets: previews.iter().take(3).map(|p| p.kind).collect(),
            is_lit: false,
            fade: None,
        }
    }

    pub fn compact(previews: &[ProjectAssetPreview]) -> Self {
        Self {
            compact: true,
            ..Self::grid(previews)
        }
    }

    pub fn lit(mut self, is_lit: bool) -> Self {
        self.is_lit = is_lit;
        self
    }

    pub fn fade(mut self, fade: Option<f32>) -> Self {
        self.fade = fade;
        self
    }
}

impl RenderOnce for ProjectFolderGlyph {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.palette();
        let (w, h) = if self.compact {
            LIST_FOLDER_SIZE
        } else {
            GRID_FOLDER_SIZE
        };
        let folder = faded(if self.is_lit { lit(t) } else { tones(t) }, self.fade, t);
        let paper = sheet::Paper::new(self.fade, t);
        let count = self.sheets.len();
        let sheets: Vec<Div> = match count {
            0 => vec![],
            _ if self.compact => {
                let (placements, order) = sheet::compact_sheet_placements(count);
                order
                    .iter()
                    .map(|&i| sheet::render_compact_sheet(placements[i], self.sheets[i], &paper))
                    .collect()
            }
            _ => {
                let (placements, order) = sheet::grid_sheet_placements(count);
                order
                    .iter()
                    .map(|&i| sheet::render_grid_sheet(placements[i], self.sheets[i], &paper))
                    .collect()
            }
        };
        div()
            .relative()
            .flex_none()
            .w(px(w))
            .h(px(h))
            .child(layer("home/folder-back.svg", w, h, folder.back))
            .children(sheets)
            .child(layer("home/folder-front.svg", w, h, folder.front))
    }
}

/// `HomeProjectIcon` in a 14px slot (the Header's project menu and the
/// project rail): the laptop mark of a local folder, with a small cloud on
/// a folder that has its own Cloud project; a Cloud project is its cloud.
pub(in crate::app) fn list_icon(location: Location, t: Theme) -> AnyElement {
    let glyph = match location {
        Location::CloudOnly => Icon::product(ProductIcon::Cloud)
            .with_size(px(14.))
            .stroke(1.85)
            .color(t.brand_blue),
        _ => Icon::product(ProductIcon::Local)
            .with_size(px(14.))
            .stroke(1.85),
    };
    div()
        .relative()
        .size(px(14.))
        .flex_none()
        .child(glyph)
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
