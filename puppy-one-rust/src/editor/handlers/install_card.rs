//! Stub install card surface for uninstalled on-demand plugins (Step 3).
//!
//! Step 4/5 wires this card into `platform::plugins::install` so confirming
//! installs the plugin and re-resolves the pane in place.

use super::external::FallbackCallback;
use crate::{
    editor::{registry::ViewerSurface, viewers::placeholder::format_file_size},
    localization::tf,
    plugin_contract::HandlerId,
    theme,
    ui::{
        appearance::ActiveAppearance,
        components::{Button, ButtonVariant},
    },
};
use gpui::{prelude::*, *};

pub struct InstallCardOptions {
    pub name: String,
    pub handler_id: HandlerId,
    pub handler_label: String,
    pub size_bytes: Option<u64>,
    pub fallback_label: String,
    pub on_fallback: Option<FallbackCallback>,
}

/// Opens a placeholder install card for an uninstalled plugin handler until
/// Step 4/5 connects package installation.
pub fn open(options: InstallCardOptions, cx: &mut App) -> Box<dyn ViewerSurface> {
    let view = cx.new(|_| InstallCardView { options });
    Box::new(InstallCardSurface { view })
}

struct InstallCardSurface {
    view: Entity<InstallCardView>,
}

impl ViewerSurface for InstallCardSurface {
    fn element(&self) -> AnyElement {
        self.view.clone().into_any_element()
    }

    fn rebind_name(&self, name: &str, cx: &mut App) {
        let name = name.to_owned();
        self.view.update(cx, |card, cx| {
            card.options.name = name;
            cx.notify();
        });
    }
}

struct InstallCardView {
    options: InstallCardOptions,
}

fn display_name(name: &str) -> String {
    name.rsplit(['/', '\\']).next().unwrap_or(name).to_owned()
}

impl Render for InstallCardView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let palette = cx.palette();
        let data_size = theme::ty().editor.data;
        let title = tf(
            "native.editor.installCardTitle",
            &[("name", self.options.handler_label.clone().into())],
        );
        let detail = tf(
            "native.editor.installCardDescription",
            &[("fallback", self.options.fallback_label.clone().into())],
        );
        let fallback_button_label = tf(
            "native.editor.openWithFallback",
            &[("name", self.options.fallback_label.clone().into())],
        );
        let meta = match self.options.size_bytes {
            Some(bytes) => format!("{} · {}", self.options.handler_id, format_file_size(bytes)),
            None => self.options.handler_id.to_string(),
        };

        div()
            .id("plugin-install-card-surface")
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .overflow_hidden()
            .p(px(32.))
            .bg(palette.canvas)
            .child(
                div()
                    .flex()
                    .flex_col()
                    .items_center()
                    .gap(px(12.))
                    .max_w(px(460.))
                    .px(px(28.))
                    .py(px(22.))
                    .rounded(px(theme::metric::CARD_RADIUS))
                    .border_1()
                    .border_color(palette.border_subtle)
                    .bg(palette.panel_raised)
                    .child(
                        div()
                            .max_w_full()
                            .truncate()
                            .text_size(px(theme::ty().ui.body))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(palette.text)
                            .child(display_name(&self.options.name)),
                    )
                    .child(
                        div()
                            .text_size(px(data_size))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(palette.muted)
                            .child(title),
                    )
                    .child(
                        div()
                            .text_size(px(theme::ty().ui.meta))
                            .text_color(palette.subtle)
                            .child(meta),
                    )
                    .child(
                        div()
                            .text_size(px(data_size))
                            .line_height(relative(1.45))
                            .text_color(palette.subtle)
                            .text_center()
                            .child(detail),
                    )
                    .when_some(self.options.on_fallback.clone(), |d, on_fallback| {
                        d.child(
                            Button::new("install-card-fallback")
                                .variant(ButtonVariant::Secondary)
                                .label(fallback_button_label)
                                .on_click(move |_, window, cx| on_fallback(window, cx)),
                        )
                    }),
            )
    }
}
