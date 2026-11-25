//! A fenced code block with its language toolbar.
use super::*;

/// `AgentMarkdownSourceBlock`: language toolbar with copy, then the source.
pub(super) fn code_block(
    language: &str,
    text: &str,
    cx: &mut Context<'_>,
    path: &str,
) -> AnyElement {
    let t = cx.t;
    let a = super::super::agent_theme::AgentTheme::new(&t);
    let copy = text.to_owned();
    let language = if language.is_empty() {
        "text".to_owned()
    } else {
        language.to_owned()
    };
    let code = theme::ty().right.code;
    let label: SharedString = crate::localization::t("common.action.copy").into();
    div()
        .w_full()
        .min_w_0()
        .overflow_hidden()
        .border_1()
        .border_color(a.border)
        .rounded(px(10.))
        .bg(a.code_surface)
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .gap(px(8.))
                .min_h(px(theme::control()))
                .pt(px(3.))
                .pr(px(6.))
                .pb(px(3.))
                .pl(px(11.))
                .border_b_1()
                .border_color(a.border_subtle)
                .text_color(a.text_subtle)
                .child({
                    let selector = format!("agent-code-language:{language}");
                    div()
                        .debug_selector(move || selector)
                        .min_w_0()
                        .truncate()
                        .font_family(theme::mono())
                        .text_size(px(theme::ty().right.caption))
                        .child(language)
                })
                .child(
                    gpui_kit::base::Button::new(SharedString::from(format!(
                        "{}:{path}:copy",
                        cx.key
                    )))
                    .accessibility_label(label.clone())
                    .debug_selector(|| "agent-code-copy".into())
                    .size(px(theme::control_small()))
                    .rounded(px(6.))
                    .text_color(a.text_subtle)
                    .cursor(theme::clickable_cursor())
                    .hover(move |s| s.bg(t.hover).text_color(a.text))
                    .tooltip(crate::ui::components::tooltip(label))
                    .child(Icon::new("copy").small().stroke(2.).color(a.text_subtle))
                    .on_click(move |_, _, cx| {
                        cx.write_to_clipboard(ClipboardItem::new_string(copy.clone()))
                    }),
                ),
        )
        .child(
            div()
                .id(SharedString::from(format!("{}:{path}:pre", cx.key)))
                .max_h(px(360.))
                .overflow_scroll()
                .px(px(12.))
                .py(px(10.))
                .font_family(theme::mono())
                .text_size(px(code))
                .line_height(px(code * 1.5))
                .text_color(a.text_muted)
                .whitespace_nowrap()
                .child(text.replace('\t', "  ")),
        )
        .into_any_element()
}
