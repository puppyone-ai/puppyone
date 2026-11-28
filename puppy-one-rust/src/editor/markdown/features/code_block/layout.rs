//! Fenced code block layout math (`codeBlockLayout.ts`, `MA-04`: zero `gpui`).

/// `.cm-md-code-textarea { min-height: 44px }`.
pub const MIN_HEIGHT: f32 = 44.;

/// `tab-size: var(--cm-md-code-tab-size, 2)` (Python uses 4).
pub fn tab_size(language: &str) -> usize {
    if matches!(language.to_ascii_lowercase().as_str(), "py" | "python") {
        4
    } else {
        2
    }
}

/// Computes `(panel_height, total_widget_height)` from code height and rhythm gaps.
pub fn heights(
    pad_top: f32,
    pad_bottom: f32,
    code_height: f32,
    gap_before: f32,
    gap_after: f32,
) -> (f32, f32) {
    let panel_height = (pad_top + code_height + pad_bottom).max(MIN_HEIGHT);
    (panel_height, gap_before + panel_height + gap_after)
}
