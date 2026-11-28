//! Native Rust visual & geometry style-contract tests (T3), replacing the
//! product-meaningful CSS-text assertions from `markdownEditorLayout.test.ts`
//! (#0–#9, #11–#17, #19–#24, #26–#27) and `markdownMathTypographyContract.test.ts`
//! (#0, plus a native guard for #1).
//!
//! Every contract exercises `MarkdownTheme::resolve(dark, scale)` across both
//! Light and Dark appearances and all three text scales (`Small`, `Medium`,
//! `Large`), together with real `decorations::decorate`, `DocLayout`, and
//! `debug_bounds` measurements.
use super::blocks;
use crate::{
    editor::{
        markdown::{MarkdownExtension, SetLivePreview, style::MarkdownTheme},
        text::state::{EditorState, StateEffect},
        tokens::over,
        view::{
            EditorView,
            decoration::Decorations,
            extension::{DecorateInput, EditorExtension},
        },
    },
    typography::Scale,
};
use gpui::{Entity, Rgba, VisualTestContext};

mod blocks_and_tables;
mod layout_and_widgets;
mod typography_and_theme;

pub(super) const ALL_SCALES: [Scale; 3] = [Scale::Small, Scale::Medium, Scale::Large];
pub(super) const ALL_THEMES: [bool; 2] = [false, true];

pub(super) fn settle(view: &Entity<EditorView>, cx: &mut VisualTestContext) {
    for _ in 0..4 {
        let _ = blocks(view, cx);
        cx.run_until_parked();
    }
}

pub(super) fn displayed(view: &Entity<EditorView>, cx: &mut VisualTestContext) -> String {
    let _ = blocks(view, cx);
    view.read_with(cx, |v, _| {
        v.layout()
            .expect("settled layout")
            .leaves
            .iter()
            .map(|leaf| leaf.entry.text.text.as_str())
            .collect::<Vec<_>>()
            .join("\n")
    })
}

pub(super) fn decorate_markdown(source: &str, dark: bool, scale: Scale, live: bool) -> Decorations {
    let state = EditorState::new(source);
    let mut ext = MarkdownExtension::new(dark, scale);
    if !live {
        ext.apply_effects(&[StateEffect::new(SetLivePreview(false))], &state, false);
    }
    ext.decorate(&DecorateInput {
        state: &state,
        focused: false,
        pointer_selecting: false,
        dark,
    })
}

fn srgb_to_linear(channel: f32) -> f32 {
    if channel <= 0.03928 {
        channel / 12.92
    } else {
        ((channel + 0.055) / 1.055).powf(2.4)
    }
}

/// Relative luminance contrast ratio per WCAG 2.1 after compositing `fg` over `bg`.
pub(super) fn contrast_ratio(fg: Rgba, bg: Rgba) -> f32 {
    let composite = over(fg, bg);
    let lum = |c: Rgba| {
        0.2126 * srgb_to_linear(c.r) + 0.7152 * srgb_to_linear(c.g) + 0.0722 * srgb_to_linear(c.b)
    };
    let l1 = lum(composite);
    let l2 = lum(bg);
    let (hi, lo) = if l1 >= l2 { (l1, l2) } else { (l2, l1) };
    (hi + 0.05) / (lo + 0.05)
}

pub(super) fn all_variants() -> impl Iterator<Item = (bool, Scale, MarkdownTheme)> {
    ALL_THEMES.into_iter().flat_map(|dark| {
        ALL_SCALES
            .into_iter()
            .map(move |scale| (dark, scale, MarkdownTheme::resolve(dark, scale)))
    })
}
