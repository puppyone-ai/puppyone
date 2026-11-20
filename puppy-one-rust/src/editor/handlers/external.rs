//! External OS application handler (`app:default`, backed by
//! `platform::desktop::open`).
//!
//! Never manufactures a local path for non-local (Cloud / RemoteDevice) files.

use crate::{
    editor::registry::ViewerSurface,
    localization::{t, tf},
    theme,
    ui::{
        appearance::ActiveAppearance,
        components::{Button, ButtonVariant},
    },
};
use gpui::{prelude::*, *};
use std::{
    path::{Path, PathBuf},
    rc::Rc,
};

/// Injectable OS launcher so tests can assert launch behavior deterministically
/// without spawning an external OS application.
pub type ExternalLauncher = Rc<dyn Fn(&Path) -> Result<(), String>>;

/// Callback invoked when the user asks to switch to the fallback handler.
pub type FallbackCallback = Rc<dyn Fn(&mut Window, &mut App)>;

pub struct ExternalOpenOptions {
    pub name: String,
    /// Absolute local path, `Some` only when `SourceKind::Local`.
    pub local_path: Option<PathBuf>,
    pub fallback_label: String,
    pub launcher: Option<ExternalLauncher>,
    pub on_fallback: Option<FallbackCallback>,
}

/// Opens the in-pane external app handler surface and (when a local path and
/// launcher are available) triggers the OS default app.
pub fn open(options: ExternalOpenOptions, cx: &mut App) -> Box<dyn ViewerSurface> {
    let initial_error = match (&options.local_path, &options.launcher) {
        (Some(path), Some(launcher)) => launcher(path).err(),
        #[cfg(not(test))]
        (Some(path), None) => crate::platform::desktop::open(path).err(),
        #[cfg(test)]
        (Some(_), None) => None,
        (None, _) => Some(t("native.editor.externalAppUnavailable").into()),
    };

    let view = cx.new(|_| ExternalAppCard {
        name: options.name,
        local_path: options.local_path,
        fallback_label: options.fallback_label,
        launcher: options.launcher,
        on_fallback: options.on_fallback,
        last_error: initial_error,
    });
    Box::new(ExternalAppSurface { view })
}

struct ExternalAppSurface {
    view: Entity<ExternalAppCard>,
}

impl ViewerSurface for ExternalAppSurface {
    fn element(&self) -> AnyElement {
        self.view.clone().into_any_element()
    }

    fn rebind_name(&self, name: &str, cx: &mut App) {
        let name = name.to_owned();
        self.view.update(cx, |card, cx| {
            card.name = name;
            cx.notify();
        });
    }
}

struct ExternalAppCard {
    name: String,
    local_path: Option<PathBuf>,
    fallback_label: String,
    launcher: Option<ExternalLauncher>,
    on_fallback: Option<FallbackCallback>,
    last_error: Option<String>,
}

impl ExternalAppCard {
    fn launch_now(&mut self, cx: &mut Context<Self>) {
        let Some(path) = &self.local_path else {
            self.last_error = Some(t("native.editor.externalAppUnavailable").into());
            cx.notify();
            return;
        };
        let result = match &self.launcher {
            Some(launcher) => launcher(path),
            None => crate::platform::desktop::open(path),
        };
        self.last_error = result.err();
        cx.notify();
    }
}

fn display_name(name: &str) -> String {
    name.rsplit(['/', '\\']).next().unwrap_or(name).to_owned()
}

impl Render for ExternalAppCard {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let palette = cx.palette();
        let data_size = theme::ty().editor.data;
        let has_local = self.local_path.is_some();
        let fallback_label = tf(
            "native.editor.openWithFallback",
            &[("name", self.fallback_label.clone().into())],
        );

        let mut actions: Vec<AnyElement> = Vec::new();
        if has_local {
            actions.push(
                Button::new("external-handler-relaunch")
                    .variant(ButtonVariant::OutlinePrimary)
                    .label(t("editor.openDefaultApp"))
                    .on_click(cx.listener(|card, _, _, cx| card.launch_now(cx)))
                    .into_any_element(),
            );
        }
        if let Some(on_fallback) = self.on_fallback.clone() {
            actions.push(
                Button::new("external-handler-fallback")
                    .variant(ButtonVariant::Secondary)
                    .label(fallback_label)
                    .on_click(move |_, window, cx| on_fallback(window, cx))
                    .into_any_element(),
            );
        }

        div()
            .id("external-app-handler-surface")
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
                            .child(display_name(&self.name)),
                    )
                    .child(
                        div()
                            .text_size(px(data_size))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(palette.muted)
                            .child(t("native.editor.externalAppTitle")),
                    )
                    .child(
                        div()
                            .text_size(px(data_size))
                            .line_height(relative(1.45))
                            .text_color(palette.subtle)
                            .text_center()
                            .child(t("native.editor.externalAppDescription")),
                    )
                    .when_some(self.last_error.clone(), |d, err| {
                        d.child(
                            div()
                                .text_size(px(theme::ty().ui.meta))
                                .line_height(relative(1.4))
                                .text_color(palette.danger)
                                .text_center()
                                .child(err),
                        )
                    })
                    .when(!actions.is_empty(), |d| {
                        d.child(
                            div()
                                .flex()
                                .flex_wrap()
                                .items_center()
                                .justify_center()
                                .gap(px(8.))
                                .children(actions),
                        )
                    }),
            )
    }
}
