//! A QR code for a link to open on a phone.
use gpui::{prelude::*, *};
use qrcodegen::{QrCode as Matrix, QrCodeEcc};

/// Modules of light margin around the code (the scanners' quiet zone).
const QUIET: i32 = 3;

/// `text` as a QR code `size` wide: `ink` modules on a `paper` tile. Phone
/// scanners read dark on light, so callers pass those whatever the theme.
#[derive(IntoElement)]
pub struct QrCode {
    matrix: Option<Matrix>,
    size: Pixels,
    ink: Hsla,
    paper: Hsla,
}
impl QrCode {
    pub fn new(text: &str, ink: impl Into<Hsla>, paper: impl Into<Hsla>) -> Self {
        Self {
            matrix: Matrix::encode_text(text, QrCodeEcc::Medium).ok(),
            size: px(132.),
            ink: ink.into(),
            paper: paper.into(),
        }
    }
    pub fn size(mut self, size: Pixels) -> Self {
        self.size = size;
        self
    }
}
impl RenderOnce for QrCode {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let Self {
            matrix,
            size: side,
            ink,
            paper,
        } = self;
        div().size(side).rounded(px(6.)).bg(paper).child(
            canvas(
                |_, _, _| {},
                move |bounds, _, window, _| {
                    let Some(matrix) = &matrix else {
                        return;
                    };
                    let count = matrix.size() + QUIET * 2;
                    let scale = window.scale_factor();
                    // Whole device pixels per module keep the edges sharp.
                    let width = f32::from(bounds.size.width);
                    let module = ((width * scale) / count as f32).floor() / scale;
                    let inset = (width - module * count as f32) / 2.;
                    for y in 0..matrix.size() {
                        for x in 0..matrix.size() {
                            if matrix.get_module(x, y) {
                                let at = point(
                                    bounds.origin.x + px(inset + module * (x + QUIET) as f32),
                                    bounds.origin.y + px(inset + module * (y + QUIET) as f32),
                                );
                                window.paint_quad(fill(
                                    Bounds::new(at, size(px(module), px(module))),
                                    ink,
                                ));
                            }
                        }
                    }
                },
            )
            .size_full(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn a_telegram_start_link_fits_a_small_code() {
        let link =
            "https://t.me/Puppyoneofficial_bot?start=1Pyr9y6nZf7eA5TDV2J7aXDFHjuHwQjJ5UFAp-wVNmw";
        let matrix = Matrix::encode_text(link, QrCodeEcc::Medium).unwrap();
        // At 132px a module stays at least 3px wide on a 1x screen.
        assert!(matrix.size() + QUIET * 2 <= 44, "{}", matrix.size());
    }
}
