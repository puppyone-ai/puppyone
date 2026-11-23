//! Toolbar, deferred offer, source fallback, and visible error banner helpers
//! for [`super::widget::MermaidBlockWidget`] (`TODO-31`, `TA-52`, `TODO-37`).
use super::{Action, ID, MermaidBlock};
use crate::{
    editor::{
        markdown::{platform::render as render_broker, shared::widgets::fallback::action_pill},
        view::{
            command::Command,
            widget::{CommandSender, WidgetCx},
        },
    },
    localization::{t, tf},
    render_service::Request,
    theme::{self, Theme},
};
use gpui::{prelude::*, *};

pub(super) const MIN_SCALE: f32 = 0.1;
pub(super) const MAX_SCALE: f32 = 2.;
const STEP: f32 = 0.1;
pub(super) const ERROR_BANNER_HEIGHT: f32 = 34.;

pub(super) fn h_row() -> Div {
    div().flex().flex_row().items_center()
}

pub(super) fn zoom_controls(
    at: usize,
    scale: f32,
    fit: f32,
    cx: &WidgetCx,
    app: &Theme,
) -> AnyElement {
    let send = cx.sender();
    let percent = (scale * 100.).round() as u16;
    let ty = theme::ty().ui;
    let divider = theme::alpha(app.divider, 0.68);
    let button = |id: &'static str, label: SharedString, enabled: bool, target: f32| {
        let send = send.clone();
        div()
            .id(cx.id(id))
            .debug_selector(move || format!("md-{id}"))
            .h(px(22.))
            .min_w(px(26.))
            .px(px(6.))
            .flex()
            .items_center()
            .justify_center()
            .border_r_1()
            .border_color(divider)
            .text_size(px(ty.meta))
            .text_color(if enabled {
                app.muted
            } else {
                theme::alpha(app.muted, 0.42)
            })
            .when(enabled, |d| {
                d.cursor(theme::clickable_cursor())
                    .hover(|d| d.bg(app.control_hover).text_color(app.text))
                    .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                    .on_click(move |_, window, cx| {
                        cx.stop_propagation();
                        let percent = (target.clamp(MIN_SCALE, MAX_SCALE) * 100.).round() as u16;
                        send(Command::new(ID, Action::Zoom { at, percent }), window, cx);
                    })
            })
            .child(label)
    };
    h_row()
        .h(px(24.))
        .rounded(px(5.))
        .overflow_hidden()
        .border_1()
        .border_color(theme::mix(app.divider, app.muted, 0.96))
        .bg(theme::alpha(app.panel_raised, 0.94))
        .child(button(
            "mermaid-zoom-out",
            "−".into(),
            scale > MIN_SCALE + 0.001,
            scale - STEP,
        ))
        .child(
            div()
                .debug_selector(move || format!("md-mermaid-zoom:{percent}%"))
                .min_w(px(42.))
                .px(px(5.))
                .text_size(px(ty.micro))
                .line_height(px(22.))
                .text_center()
                .text_color(app.muted)
                .child(format!("{percent}%")),
        )
        .child(button(
            "mermaid-zoom-in",
            "+".into(),
            scale < MAX_SCALE - 0.001,
            scale + STEP,
        ))
        .child(
            button(
                "mermaid-fit",
                t("editor.markdown.mermaid.fit").into(),
                true,
                fit,
            )
            .min_w(px(38.))
            .border_r_0()
            .text_size(px(ty.caption))
            .font_weight(FontWeight(650.)),
        )
        .into_any_element()
}

pub(super) fn edit_button(
    at: usize,
    editing: bool,
    send: CommandSender,
    cx: &WidgetCx,
    app: &Theme,
) -> AnyElement {
    let ty = theme::ty().ui;
    let (label, action) = if editing {
        (t("editor.markdown.mermaid.done"), Action::Done { at })
    } else {
        (t("editor.markdown.mermaid.edit"), Action::Edit { at })
    };
    div()
        .id(cx.id("mermaid-edit"))
        .debug_selector(move || {
            if editing {
                "md-mermaid-done"
            } else {
                "md-mermaid-edit"
            }
            .into()
        })
        .h(px(24.))
        .px(px(9.))
        .rounded(px(5.))
        .border_1()
        .border_color(theme::mix(app.divider, app.muted, 0.96))
        .bg(theme::alpha(app.panel_raised, 0.92))
        .text_size(px(ty.caption))
        .font_weight(FontWeight(650.))
        .line_height(px(22.))
        .text_color(app.muted)
        .cursor(theme::clickable_cursor())
        .hover(|d| d.bg(app.control_hover).text_color(app.text))
        .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
        .on_click(move |_, window, cx| {
            cx.stop_propagation();
            send(Command::new(ID, action), window, cx);
        })
        .child(label)
        .into_any_element()
}

pub(super) fn deferred_offer(
    at: usize,
    send: CommandSender,
    cx: &WidgetCx,
    app: &Theme,
) -> AnyElement {
    let ty = theme::ty().ui;
    h_row()
        .size_full()
        .justify_between()
        .gap(px(16.))
        .text_size(px(ty.meta))
        .text_color(app.muted)
        .child(t("editor.markdown.mermaid.largePreviewPaused"))
        .child(
            div()
                .id(cx.id("mermaid-render"))
                .h(px(24.))
                .px(px(9.))
                .rounded(px(5.))
                .border_1()
                .border_color(theme::mix(app.divider, app.muted, 0.96))
                .text_size(px(ty.caption))
                .font_weight(FontWeight(650.))
                .line_height(px(22.))
                .cursor(theme::clickable_cursor())
                .hover(|d| d.bg(app.control_hover).text_color(app.text))
                .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                .on_click(move |_, window, cx| {
                    cx.stop_propagation();
                    send(Command::new(ID, Action::Activate { at }), window, cx);
                })
                .child(t("editor.markdown.mermaid.renderDiagram")),
        )
        .into_any_element()
}

/// Visible error / unavailable strip with `Retry` and `Source code` controls (`TA-52`).
pub(super) fn error_banner(
    block: &MermaidBlock,
    message: &str,
    request: &Request,
    zoomed_request: Option<Request>,
    dark: bool,
    (width, top_y): (f32, f32),
    cx: &WidgetCx,
) -> AnyElement {
    let app = Theme::new(dark);
    let ty = theme::ty().ui;
    let text = if message.is_empty() {
        t("editor.markdown.mermaid.renderFailed").to_owned()
    } else {
        tf(
            "editor.markdown.mermaid.renderFailedDetail",
            &[("detail", crate::localization::bidi_isolate(message).into())],
        )
    };
    let primary_req = request.clone();
    let send = cx.sender();
    let show_action = Action::ShowSource {
        start: block.range.start,
        end: block.range.end,
        caret: block.code.start,
    };
    let danger = app.danger;
    div()
        .absolute()
        .left_0()
        .top(px(top_y))
        .w(px(width))
        .h(px(ERROR_BANNER_HEIGHT))
        .px(px(9.))
        .flex()
        .items_center()
        .justify_between()
        .gap(px(8.))
        .rounded(px(5.))
        .border_1()
        .border_color(theme::mix(danger, app.divider, 0.28))
        .bg(theme::alpha(danger, 0.08))
        .text_size(px(ty.meta))
        .text_color(theme::mix(danger, app.text, 0.58))
        .child(div().min_w_0().truncate().child(SharedString::from(text)))
        .child(
            h_row()
                .flex_none()
                .gap(px(6.))
                .child(action_pill(
                    cx.id("mermaid-retry"),
                    t("common.action.retry"),
                    dark,
                    move |_, app_cx| {
                        render_broker::retry(&primary_req, app_cx);
                        if let Some(zoom_req) = &zoomed_request {
                            render_broker::retry(zoom_req, app_cx);
                        }
                    },
                ))
                .child(action_pill(
                    cx.id("mermaid-show-source"),
                    t("editor.mode.source"),
                    dark,
                    move |window, app_cx| {
                        send(Command::new(ID, show_action), window, app_cx);
                    },
                )),
        )
        .into_any_element()
}

/// `createMermaidSourceFallback`: the source as monospace text.
pub(super) fn source_fallback(source: &str, mono: SharedString, app: &Theme) -> Div {
    div()
        .size_full()
        .overflow_hidden()
        .font_family(mono)
        .text_size(px(theme::ty().ui.meta))
        .text_color(app.muted)
        .child(if source.trim().is_empty() {
            t("editor.markdown.mermaid.empty").to_owned()
        } else {
            source.to_owned()
        })
}
