//! Callout icon asset paths and title-bar chrome constants (`calloutIcons.ts`).

pub const ICON: f32 = 18.;
pub const ICON_GAP: f32 = 8.;
pub const TITLE_PADDING: f32 = 8.;
pub const HEADER_DEPTH: f32 = 0.25;
pub const FOLD_GAP: f32 = 6.;
pub const CHEVRON_ICON: &str = "icons/callout-chevron.svg";

/// Returns the bundled SVG asset path for a normalized callout appearance key.
pub fn icon_path(appearance: &str) -> String {
    format!("icons/callout-{appearance}.svg")
}
