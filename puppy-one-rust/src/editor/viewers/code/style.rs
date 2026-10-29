//! `code-editor.css` projected into Kit's public syntax-theme schema.
use crate::{
    editor::tokens::Tokens,
    theme::{self, Theme},
    typography::Scale,
};
use gpui::*;
use gpui_kit::component::{Theme as KitTheme, highlighter::HighlightTheme};
use std::sync::Arc;

/// `.cm-lineNumbers .cm-gutterElement` (36 px border box, 8 / 9 px paddings,
/// the hint size, 34% text; the active one in the text colour at 500), the
/// 16 px `.cm-foldGutter` and `.cm-line`'s 8 px inset, outside which the
/// active line's background never reaches.
pub fn gutter(dark: bool, scale: Scale) -> gpui_base::input::GutterMetrics {
    let p = Theme::new(dark);
    gpui_base::input::GutterMetrics {
        number_width: px(36.),
        number_padding_left: px(8.),
        number_padding_right: px(9.),
        number_font_size: px(scale.metrics().ui.hint),
        number_color: Hsla::from(theme::alpha(p.text, 0.34)),
        active_number_color: Hsla::from(p.text),
        active_number_weight: FontWeight::MEDIUM,
        fold_width: px(16.),
        text_inset: px(8.),
    }
}

pub fn project(dark: bool, scale: Scale, cx: &mut App) {
    theme::sync_kit(dark, None, cx);
    let p = Theme::new(dark);
    let bg = Tokens::get(dark, scale).color("--po-editor-bg");
    let mut syntax = serde_json::Map::new();
    for (names, color) in [
        (
            &["comment", "comment_doc"][..],
            theme::mix(p.muted, bg, 0.88),
        ),
        (&["keyword"][..], p.purple),
        (&["string"][..], theme::mix(p.success, p.text, 0.82)),
        (
            &["constant", "number", "boolean"][..],
            theme::mix(p.warning, p.text, 0.80),
        ),
        (
            &["string.escape", "string.regex", "string.special"][..],
            theme::mix(p.notification, p.text, 0.76),
        ),
        (&["type", "tag", "constructor"][..], p.info),
        (&["function"][..], p.accent_text),
        (
            &["property", "attribute"][..],
            theme::mix(p.accent, p.text, 0.72),
        ),
        (&["operator"][..], theme::mix(p.text, p.accent, 0.82)),
        (
            &["preproc", "label"][..],
            theme::mix(p.purple, p.text, 0.72),
        ),
    ] {
        // `.cm-code-keyword { font-weight: 600 }`, `.cm-code-function
        // { font-weight: 550 }`: the code family's SemiBold and Medium
        // (550) faces.
        let weight = match names[0] {
            "keyword" => Some(600),
            "function" => Some(500),
            _ => None,
        };
        for name in names {
            let mut style = serde_json::json!({"color": Hsla::from(color)});
            if let Some(weight) = weight {
                style["font_weight"] = weight.into();
            }
            syntax.insert((*name).into(), style);
        }
    }
    let projected: HighlightTheme = serde_json::from_value(serde_json::json!({
        "name": "PuppyOne code", "style": {
            "editor.background": Hsla::from(bg),
            "editor.foreground": Hsla::from(p.text),
            "editor.active_line.background": Hsla::from(theme::alpha(p.text, 0.04)),
            "editor.gutter.background": Hsla::from(bg),
            "editor.line_number": Hsla::from(theme::alpha(p.text, 0.34)),
            "editor.active_line_number": Hsla::from(p.text),
            "editor.invisible": Hsla::from(theme::alpha(p.text, 0.10)),
            "syntax": syntax
        }
    }))
    .expect("product code theme schema");
    if *KitTheme::global(cx).highlight_theme != projected {
        KitTheme::update(cx, |t| t.highlight_theme = Arc::new(projected));
    }
}
