//! A `mermaid` fence drawn as a diagram.
use super::*;

/// `AgentMarkdownMermaidBlock`: the diagram in a captioned figure, drawn by
/// the render service in the application's colours and fitted to the
/// answer's width; the source block when it cannot be drawn.
pub(super) fn mermaid(source: &str, cx: &mut Context<'_>, path: &str) -> AnyElement {
    use crate::render_service::{self, Kind, MermaidTheme, Request, State};
    let t = cx.t;
    let a = super::super::agent_theme::AgentTheme::new(&t);
    let tokens = crate::editor::tokens::Tokens::get(t.dark, Default::default());
    let theme = MermaidTheme {
        background: t.canvas,
        panel: t.panel,
        text: t.text,
        muted: t.muted,
        accent: t.accent,
        border: t.divider,
        success: t.success,
        warning: t.warning,
        danger: t.danger,
        font_family: tokens.raw("--po-editor-content-font"),
        font_size: tokens.len("--po-md-content-size", 15.),
    };
    let request = Request {
        kind: Kind::Mermaid {
            config: render_service::mermaid_config(&theme),
        },
        source: source.to_owned(),
        background: render_service::hex(crate::editor::tokens::over(
            a.code_header_surface,
            a.canvas,
        )),
        scale: 1.,
    };
    // `.desktop-agent-mermaid-stage { padding: 12px }`, inside the border.
    let available = (cx.width - 26.).max(1.);
    let mut state = render_service::get(&request, cx.window, cx.app);
    // `svg { max-width: 100% }`: a wider diagram is drawn smaller.
    if let State::Ready(r) = &state
        && r.width > available
    {
        let scale = ((available / r.width * 4.).ceil() / 4.).max(0.25);
        if scale < 1. {
            state = render_service::get(&Request { scale, ..request }, cx.window, cx.app);
        }
    }
    let stage = div()
        .id(SharedString::from(format!("{}:{path}:mermaid", cx.key)))
        .w_full()
        .min_h(px(92.))
        .p(px(12.))
        .flex()
        .items_center()
        .justify_center()
        .overflow_scroll();
    let stage = match state {
        State::Failed(_) | State::Unavailable => return code_block("mermaid", source, cx, path),
        State::Ready(r) => {
            let fit = (available / r.width).min(1.);
            stage.child(
                img(ImageSource::Render(r.image.clone()))
                    .w(px(r.width * fit))
                    .h(px(r.height * fit))
                    .flex_none(),
            )
        }
        State::Pending => stage.child(
            crate::ui::loading::LoadingMark::new(SharedString::from(format!(
                "{}:{path}:mermaid-loading",
                cx.key
            )))
            .size(crate::ui::loading::LoaderSize::Xs)
            .tone(crate::ui::loading::Tone::Neutral),
        ),
    };
    let caption = theme::ty().right.caption;
    div()
        .w_full()
        .min_w_0()
        .overflow_hidden()
        .border_1()
        .border_color(a.border_subtle)
        .rounded(px(8.))
        .bg(a.code_header_surface)
        .child(
            div()
                .min_h(px(theme::control()))
                .px(px(10.))
                .py(px(6.))
                .border_b_1()
                .border_color(a.border_subtle)
                .text_color(a.text_subtle)
                .font_family(theme::MONO)
                .text_size(px(caption))
                .child(crate::localization::t("agent.markdown.diagram")),
        )
        .child(stage)
        .into_any_element()
}
