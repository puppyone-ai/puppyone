//! `code-editor.css` projected into Kit's public syntax-theme schema.
use crate::{
    editor::tokens::Tokens,
    theme::{self, Theme},
    typography::Scale,
};
use gpui::*;
use gpui_kit::component::{Theme as KitTheme, highlighter::HighlightTheme};
use std::sync::Arc;

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
        for name in names {
            syntax.insert(
                (*name).into(),
                serde_json::json!({"color": Hsla::from(color)}),
            );
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
