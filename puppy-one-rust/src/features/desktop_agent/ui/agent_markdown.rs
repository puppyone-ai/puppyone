//! Agent content uses the same upstream Markdown renderer as the native editor.
use crate::{theme::Theme, ui::column};
use gpui::{prelude::*, *};
use gpui_kit::base::{TextView, TextViewStyle};
pub fn render(text: &str, t: Theme, id: usize, cx: &App) -> Div {
    column().w_full().text_color(t.sidebar_text).child(
        TextView::markdown(("agent-markdown", id), text.to_owned())
            // `.desktop-agent-markdown`: muted reading colour, agent code surface.
            .style(
                TextViewStyle::from_theme(&gpui_kit::base::Theme::global(cx))
                    .with_foreground(t.sidebar_text.into())
                    .with_muted_foreground(t.subtle.into())
                    .with_link(t.accent.into())
                    .with_code_background(crate::theme::mix(t.panel_raised, t.agent(), 0.88).into())
                    .with_border(t.divider.into())
                    .with_dark(t.dark),
            )
            .selectable(true)
            // Transcript rendering must not fetch model-supplied URLs or local paths.
            .image_source(|_| "icons/image-plus.svg".into())
            .on_link_click(|url, _, _, cx| {
                if url.starts_with("https://")
                    || url.starts_with("http://")
                    || url.starts_with("mailto:")
                {
                    cx.open_url(url);
                }
            })
            .code_block_actions(move |code, _, _| {
                let copy = code.code().to_string();
                crate::ui::icon_button("copy-code", "copy", t)
                    .size(px(22.))
                    .accessibility_label(crate::localization::t("common.action.copy"))
                    .tooltip(crate::ui::tooltip(crate::localization::t(
                        "common.action.copy",
                    )))
                    .on_click(move |_, _, cx| {
                        cx.write_to_clipboard(ClipboardItem::new_string(copy.clone()))
                    })
            }),
    )
}
