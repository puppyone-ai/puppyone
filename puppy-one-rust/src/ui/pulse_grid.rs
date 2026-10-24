//! Port of `components/loading` PulseGrid: a 3×3 point loader whose frames
//! come from the product presets (`assets/pulse-grid.json`).
use gpui::{prelude::*, *};
use std::{sync::OnceLock, time::Duration};
#[derive(serde::Deserialize)]
struct Catalog {
    #[serde(rename = "frameDurationMs")]
    frame_ms: u64,
    order: Vec<String>,
    presets: std::collections::HashMap<String, Vec<[f32; 9]>>,
}
fn catalog() -> &'static Catalog {
    static DATA: OnceLock<Catalog> = OnceLock::new();
    DATA.get_or_init(|| {
        serde_json::from_str(include_str!("../../assets/pulse-grid.json")).expect("pulse grid")
    })
}
/// Preset ids in Settings order (`PULSE_GRID_PRESET_IDS`).
pub fn presets() -> impl Iterator<Item = &'static str> {
    catalog().order.iter().map(String::as_str)
}
/// `sm` → 3px cells with a 2px gap. The product's `xs` (2px) size is only
/// used by surfaces that are not ported yet.
#[derive(Clone, Copy)]
pub enum PulseSize {
    Sm,
}
const IDLE_OPACITY: f32 = 0.18;
pub fn pulse_grid(
    id: impl Into<ElementId>,
    preset: &str,
    size: PulseSize,
    color: Rgba,
) -> impl IntoElement {
    let frames = catalog()
        .presets
        .get(preset)
        .or_else(|| catalog().presets.get("ikun"))
        .cloned()
        .unwrap_or_default();
    let cell = match size {
        PulseSize::Sm => 3.,
    };
    let count = frames.len().max(1);
    let grid = div()
        .flex()
        .flex_wrap()
        .flex_shrink_0()
        .w(px(cell * 3. + 4.))
        .h(px(cell * 3. + 4.))
        .gap(px(2.));
    grid.with_animation(
        id,
        Animation::new(Duration::from_millis(catalog().frame_ms * count as u64)).repeat(),
        move |grid, delta| {
            let frame = frames
                .get(((delta * count as f32) as usize).min(count - 1))
                .copied()
                .unwrap_or([0.; 9]);
            grid.children(frame.into_iter().map(|brightness| {
                div()
                    .size(px(cell))
                    .rounded(px((cell / 2.).max(1.)))
                    .bg(color)
                    .opacity(if brightness > 0. {
                        brightness
                    } else {
                        IDLE_OPACITY
                    })
            }))
        },
    )
}
