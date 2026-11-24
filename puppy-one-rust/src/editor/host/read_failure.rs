//! A pane whose file could not be read, or is still being read
//! (`ViewerHost` error and loading states, `FilePreview` error): the pane
//! says it cannot open the file in the editor, why, and offers its default
//! app (a file on this computer) and to read it again. Loading draws
//! nothing and is announced as a status.
use crate::{
    documents::ClientMessage,
    editor::workbench::runtime::ReadFailure,
    localization::t,
    theme,
    ui::{
        appearance::ActiveAppearance as _,
        components::{Button, ButtonVariant},
    },
};
use gpui::{prelude::*, *};

/// `role="status"` with the loading words, and no visible text.
pub(super) fn loading() -> AnyElement {
    div()
        .id("editor-loading")
        .role(Role::Status)
        .aria_label(t("editor.loadingFile"))
        .absolute()
        .size_full()
        .test_support()
        .into_any_element()
}

/// The failure card for `failure`; `opening` is why its default app could
/// not open it, when it tried.
pub(super) fn card(
    failure: &ReadFailure,
    opening: Option<SharedString>,
    owner: WeakEntity<super::DocumentEditor>,
    cx: &App,
) -> AnyElement {
    let p = cx.palette();
    let mut actions: Vec<AnyElement> = Vec::new();
    if let Some(path) = failure.local.clone() {
        let owner = owner.clone();
        actions.push(
            Button::new("editor-read-failure-open")
                .debug_selector(|| "editor-read-failure-open".into())
                .variant(ButtonVariant::Secondary)
                .label(t("editor.openDefaultApp"))
                .on_click(move |_, window, cx| {
                    let owner = owner.clone();
                    crate::editor::question::open_external(
                        Some(window.window_handle()),
                        path.clone(),
                        move |error: String, cx: &mut App| {
                            let _ = owner.update(cx, |editor, cx| {
                                editor.opening_failure = Some(error.into());
                                cx.notify();
                            });
                        },
                        cx,
                    );
                })
                .into_any_element(),
        );
    }
    {
        actions.push(
            Button::new("editor-read-failure-retry")
                .debug_selector(|| "editor-read-failure-retry".into())
                .variant(ButtonVariant::Solid)
                .label(t("common.action.retry"))
                .on_click(move |_, _, cx| {
                    let _ = owner.update(cx, |_, cx| cx.emit(ClientMessage::RetryRead));
                })
                .into_any_element(),
        );
    }
    let line = |text: SharedString| {
        div()
            .max_w_full()
            .text_size(px(theme::ty().ui.meta))
            .line_height(relative(1.45))
            .text_color(p.muted)
            .text_center()
            .child(text)
    };
    div()
        .id("editor-read-failure")
        .debug_selector(|| "editor-read-failure".into())
        .absolute()
        .size_full()
        .flex()
        .items_center()
        .justify_center()
        .p(px(32.))
        .bg(p.canvas)
        .child(
            div()
                .flex()
                .flex_col()
                .items_center()
                .gap(px(12.))
                .max_w(px(460.))
                .child(
                    div()
                        .text_size(px(theme::ty().ui.body))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(p.text)
                        .child(t("editor.unavailable.title")),
                )
                .child(line(failure.error.clone().into()))
                .children(opening.map(line))
                .when(!actions.is_empty(), |d| {
                    d.child(div().flex().gap(px(8.)).children(actions))
                }),
        )
        .into_any_element()
}
