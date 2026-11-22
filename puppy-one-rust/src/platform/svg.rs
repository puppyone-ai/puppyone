//! Restricted SVG rasterizer (`resvg` / `usvg` 0.46):
//!
//! Never touches the local filesystem or network when parsing `<image>`,
//! `<feImage>`, `<use>`, or stylesheet references. Only self-contained
//! `data:` raster images (and bounded nested `data:image/svg+xml` parsed with
//! the same restricted resolver) are permitted.
use crate::platform::image_transcode::{DecodeError, DecodedFrame, DecodedImage};
use resvg::{tiny_skia, usvg};
use std::{
    cell::Cell,
    sync::{Arc, OnceLock},
};

/// Maximum rendered pixel edge to avoid GPU texture allocation panics.
pub const MAX_SVG_RASTER_EDGE: u32 = 8192;
/// Maximum raw decoded byte size for an embedded `data:` image inside an SVG.
const MAX_EMBEDDED_DATA_BYTES: usize = 8 * 1024 * 1024;
/// Maximum recursion depth for nested `data:image/svg+xml` documents.
const MAX_SUB_SVG_DEPTH: u8 = 2;

thread_local! {
    static SUB_SVG_DEPTH: Cell<u8> = const { Cell::new(0) };
}

/// Rasterized SVG pixel buffer in GPUI's native straight-alpha BGRA byte order.
#[derive(Clone, Debug)]
pub struct RasterizedSvg {
    pub bgra: Vec<u8>,
    pub pixel_width: u32,
    pub pixel_height: u32,
    pub logical_width: f32,
    pub logical_height: f32,
}

fn shared_fontdb() -> Arc<usvg::fontdb::Database> {
    static FONTDB: OnceLock<Arc<usvg::fontdb::Database>> = OnceLock::new();
    FONTDB
        .get_or_init(|| {
            let mut db = usvg::fontdb::Database::new();
            db.load_system_fonts();
            Arc::new(db)
        })
        .clone()
}

fn restricted_options() -> usvg::Options<'static> {
    let resolve_data: usvg::ImageHrefDataResolverFn<'static> =
        Box::new(|mime: &str, data: Arc<Vec<u8>>, opts: &usvg::Options| {
            if data.len() > MAX_EMBEDDED_DATA_BYTES {
                return None;
            }
            match mime {
                "image/png" => Some(usvg::ImageKind::PNG(data)),
                "image/jpg" | "image/jpeg" => Some(usvg::ImageKind::JPEG(data)),
                "image/gif" => Some(usvg::ImageKind::GIF(data)),
                "image/webp" => Some(usvg::ImageKind::WEBP(data)),
                "image/svg+xml" => {
                    let depth = SUB_SVG_DEPTH.with(Cell::get);
                    if depth >= MAX_SUB_SVG_DEPTH {
                        return None;
                    }
                    SUB_SVG_DEPTH.with(|d| d.set(depth + 1));
                    let parsed = usvg::Tree::from_data(&data, opts).ok();
                    SUB_SVG_DEPTH.with(|d| d.set(depth));
                    parsed.map(usvg::ImageKind::SVG)
                }
                _ => None,
            }
        });
    // Never read files from disk (absolute, CWD-relative, or resources_dir)
    // and never resolve network URLs.
    let resolve_string: usvg::ImageHrefStringResolverFn<'static> = Box::new(|_, _| None);

    usvg::Options {
        resources_dir: None,
        fontdb: shared_fontdb(),
        image_href_resolver: usvg::ImageHrefResolver {
            resolve_data,
            resolve_string,
        },
        ..Default::default()
    }
}

/// Converts premultiplied RGBA pixels from `tiny_skia::Pixmap` into straight-alpha
/// BGRA layout (matching the native renderer's expected pixel order).
fn rgba_premultiplied_to_bgra(bytes: &mut [u8]) {
    for pixel in bytes.chunks_exact_mut(4) {
        pixel.swap(0, 2);
        let alpha = pixel[3];
        if alpha > 0 && alpha < 255 {
            let a = alpha as f32 / 255.0;
            pixel[0] = ((pixel[0] as f32 / a).round().min(255.0)) as u8;
            pixel[1] = ((pixel[1] as f32 / a).round().min(255.0)) as u8;
            pixel[2] = ((pixel[2] as f32 / a).round().min(255.0)) as u8;
        }
    }
}

fn rasterize_tree(tree: &usvg::Tree, scale: f32) -> Result<RasterizedSvg, String> {
    let svg_size = tree.size();
    let logical_width = svg_size.width();
    let logical_height = svg_size.height();
    if !logical_width.is_finite()
        || !logical_height.is_finite()
        || logical_width <= 0.0
        || logical_height <= 0.0
    {
        return Err("SVG has invalid dimensions".into());
    }

    let eff_scale = scale.max(0.1);
    let max_edge = MAX_SVG_RASTER_EDGE as f32;
    let raw_w = logical_width * eff_scale;
    let raw_h = logical_height * eff_scale;
    let clamp = (max_edge / raw_w).min(max_edge / raw_h).min(1.0);
    let pixel_width = (raw_w * clamp).round().max(1.0) as u32;
    let pixel_height = (raw_h * clamp).round().max(1.0) as u32;

    let mut pixmap = tiny_skia::Pixmap::new(pixel_width, pixel_height)
        .ok_or_else(|| "Failed to allocate SVG raster pixmap".to_owned())?;
    let transform = tiny_skia::Transform::from_scale(
        pixel_width as f32 / logical_width,
        pixel_height as f32 / logical_height,
    );
    resvg::render(tree, transform, &mut pixmap.as_mut());

    let mut bgra = pixmap.take();
    rgba_premultiplied_to_bgra(&mut bgra);
    Ok(RasterizedSvg {
        bgra,
        pixel_width,
        pixel_height,
        logical_width,
        logical_height,
    })
}

/// Parses and rasterizes SVG bytes at `scale` using restricted `usvg::Options`
/// that forbid all local-filesystem and external resource reads.
pub fn rasterize_svg(bytes: &[u8], scale: f32) -> Result<RasterizedSvg, String> {
    let options = restricted_options();
    let tree = usvg::Tree::from_data(bytes, &options).map_err(|e| e.to_string())?;
    rasterize_tree(&tree, scale)
}

/// Decodes an `.svg` file for the Image Viewer into a bounded straight-BGRA
/// `DecodedImage`, keeping intrinsic SVG dimensions while forbidding external
/// file reads.
pub fn decode_svg_for_viewer(
    bytes: &[u8],
    target_max_px: u32,
) -> Result<DecodedImage, DecodeError> {
    let options = restricted_options();
    let tree =
        usvg::Tree::from_data(bytes, &options).map_err(|e| DecodeError::Failed(e.to_string()))?;
    let svg_size = tree.size();
    let natural_w = svg_size.width();
    let natural_h = svg_size.height();
    if !natural_w.is_finite() || !natural_h.is_finite() || natural_w <= 0.0 || natural_h <= 0.0 {
        return Err(DecodeError::Failed("SVG has invalid dimensions".into()));
    }

    let capped_target = target_max_px.clamp(64, MAX_SVG_RASTER_EDGE) as f32;
    let longest = natural_w.max(natural_h);
    let scale = (capped_target / longest).clamp(0.1, 8.0);
    let raster = rasterize_tree(&tree, scale).map_err(DecodeError::Failed)?;

    Ok(DecodedImage {
        natural_width: natural_w.round().max(1.0) as u32,
        natural_height: natural_h.round().max(1.0) as u32,
        decoded_max_px: raster.pixel_width.max(raster.pixel_height),
        frames: vec![DecodedFrame {
            width: raster.pixel_width,
            height: raster.pixel_height,
            bgra: raster.bgra,
            delay_ms: 0,
        }],
    })
}
