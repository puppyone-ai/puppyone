//! Bitmap format sniffing and restricted SVG rasterization for `AssetBroker`
//! (`platform/brokers/assets/decode.rs`, `R15`).
use crate::editor::markdown::platform::policy::svg::{self, SVG_SCALE};
use gpui::{ImageFormat, RenderImage};
use std::sync::Arc;

fn sniff_format(bytes: &[u8]) -> Option<ImageFormat> {
    let head = &bytes[..bytes.len().min(512)];
    Some(match head {
        [0x89, b'P', b'N', b'G', ..] => ImageFormat::Png,
        [0xff, 0xd8, 0xff, ..] => ImageFormat::Jpeg,
        [b'G', b'I', b'F', b'8', ..] => ImageFormat::Gif,
        [
            b'R',
            b'I',
            b'F',
            b'F',
            _,
            _,
            _,
            _,
            b'W',
            b'E',
            b'B',
            b'P',
            ..,
        ] => ImageFormat::Webp,
        [b'B', b'M', ..] => ImageFormat::Bmp,
        [0, 0, 1, 0, ..] => ImageFormat::Ico,
        [b'I', b'I', 42, 0, ..] | [b'M', b'M', 0, 42, ..] => ImageFormat::Tiff,
        _ if String::from_utf8_lossy(head).contains("<svg") => ImageFormat::Svg,
        _ => return None,
    })
}

pub(super) fn decode_bitmap(
    bytes: Vec<u8>,
    svg_renderer: &gpui::SvgRenderer,
) -> Option<(Arc<RenderImage>, f32, f32, usize)> {
    let format = sniff_format(&bytes)?;
    if format == ImageFormat::Svg {
        return decode_svg_bitmap(&bytes);
    }
    let image = gpui::Image::from_bytes(format, bytes)
        .to_image_data(svg_renderer.clone())
        .ok()?;
    let size = image.size(0);
    let decoded_bytes = (size.width.0.max(1) as usize) * (size.height.0.max(1) as usize) * 4;
    Some((
        image,
        size.width.0 as f32,
        size.height.0 as f32,
        decoded_bytes,
    ))
}

/// Rasterizes untrusted SVG bytes through `platform::policy::svg`
/// (no local filesystem or network reads, `R15`).
pub(crate) fn decode_svg_bitmap(bytes: &[u8]) -> Option<(Arc<RenderImage>, f32, f32, usize)> {
    let raster = svg::rasterize_svg(bytes, SVG_SCALE).ok()?;
    let decoded_bytes = raster.bgra.len();
    let buf = image::RgbaImage::from_raw(raster.pixel_width, raster.pixel_height, raster.bgra)?;
    let image = Arc::new(RenderImage::new(vec![image::Frame::new(buf)]));
    Some((
        image,
        raster.logical_width,
        raster.logical_height,
        decoded_bytes,
    ))
}
