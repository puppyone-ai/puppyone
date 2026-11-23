//! Safe SVG rasterization entry point (`platform/policy/svg.rs`, `MA-14`, `R15`,
//! puppy-issues#17): all Markdown SVG decoding routes through this policy gate,
//! delegating to `crate::platform::svg::rasterize_svg` which blocks local file
//! and network reads while allowing embedded `data:` payloads.
pub use crate::platform::svg::RasterizedSvg;

/// SVG rasterizes at Retina scale (`2.0x`).
pub const SVG_SCALE: f32 = 2.;

/// Rasterizes untrusted SVG bytes under the restricted `platform::svg`
/// resource policy (no local filesystem or remote URL fetches).
pub fn rasterize_svg(bytes: &[u8], scale: f32) -> Result<RasterizedSvg, String> {
    crate::platform::svg::rasterize_svg(bytes, scale)
}
