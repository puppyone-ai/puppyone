//! Mermaid diagram viewport scaling and height clamping (`mermaidViewportController.ts`).

pub const PREVIEW_PAD: f32 = 16.;
pub const PREVIEW_MIN: f32 = 132.;
pub const PREVIEW_MAX: f32 = 720.;
pub const DEFAULT_MIN_SCALE: f32 = 0.7;

/// Quantizes zoom scale to 0.25x render-cache buckets (minimum 0.25x).
pub fn bucket(scale: f32) -> f32 {
    ((scale * 4.).ceil() / 4.).max(0.25)
}

/// Computes `(fit_scale, effective_scale)` for an optional intrinsic width and explicit zoom %.
pub fn compute_scale(
    inner_width: f32,
    intrinsic_width: Option<f32>,
    zoom: Option<u16>,
) -> (f32, f32) {
    let fit = intrinsic_width.map_or(1., |w| (inner_width / w).min(1.));
    let scale = zoom.map_or(fit.clamp(DEFAULT_MIN_SCALE, 1.), |p| p as f32 / 100.);
    (fit, scale)
}

/// Clamps the preview panel height to `[PREVIEW_MIN, min(PREVIEW_MAX, 68% viewport)]`.
pub fn clamped_preview_height(scaled_height: f32, viewport_h: f32) -> f32 {
    let max_height = if viewport_h > 0. {
        PREVIEW_MAX.min(viewport_h * 0.68).max(PREVIEW_MIN)
    } else {
        PREVIEW_MAX
    };
    (scaled_height + 2. * PREVIEW_PAD + 2.).clamp(PREVIEW_MIN, max_height)
}
