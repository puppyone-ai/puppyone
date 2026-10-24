//! Port of `FileSettingsViews.tsx` ("Git Ignore"): Explorer visibility —
//! show hidden files, and newline-separated exclude patterns with Apply/Reset.
use super::super::{
    components::*,
    preference_types::{FilesVisibility, normalize_patterns},
    settings_workspace_surface::SettingsWorkspaceSurface,
};
use super::Page;
use crate::{
    localization::{t as tr, tf},
    theme::{self, Theme},
    ui::{Tone, action_button, column, row, switch},
};
use gpui::{prelude::*, *};
impl SettingsWorkspaceSurface {
    pub(super) fn files(&self, t: Theme, cx: &mut Context<Self>) -> Div {
        let state = self.preferences.read(cx).state.files.clone();
        let draft = normalize_patterns(self.patterns.read(cx).text());
        let dirty = draft != state.exclude_patterns;
        let dark = self.dark();
        self.patterns.update(cx, |i, _| i.dark = dark);
        let prefs = self.preferences.clone();
        let show_hidden = setting_row(
            tr("settings.files.showHidden"),
            switch(
                "show-hidden-files",
                tr("settings.files.showHidden"),
                state.show_hidden_files,
                false,
                t,
                move |on, _, cx| {
                    prefs.update(cx, |p, cx| p.change(|p| p.files.show_hidden_files = on, cx))
                },
            ),
            t,
        );
        let apply = action_button(
            "apply-patterns",
            tr("common.action.apply"),
            Some("check"),
            Tone::Default,
            !dirty,
            t,
        )
        .on_click(cx.listener(|s, _, _, cx| {
            let patterns = normalize_patterns(s.patterns.read(cx).text());
            s.preferences.update(cx, |p, cx| {
                p.change(|p| p.files.exclude_patterns = patterns, cx)
            });
        }));
        let reset = action_button(
            "reset-patterns",
            tr("common.action.reset"),
            Some("refresh-cw"),
            Tone::Default,
            false,
            t,
        )
        .on_click(cx.listener(|s, _, _, cx| {
            s.preferences.update(cx, |p, cx| {
                p.change(
                    |p| p.files.exclude_patterns = FilesVisibility::default().exclude_patterns,
                    cx,
                )
            });
            s.sync_patterns(cx);
        }));
        let editor = row()
            .w_full()
            .items_start()
            .gap(px(18.))
            .px(px(10.))
            .py(px(8.))
            .child(
                div()
                    .flex_shrink_0()
                    .pt(px(6.))
                    .text_size(px(theme::ty().ui.label))
                    .text_color(t.subtle)
                    .child(tr("settings.files.excludePatterns")),
            )
            .child(
                column()
                    .flex_1()
                    .min_w_0()
                    .gap(px(6.))
                    .child(
                        div()
                            .w_full()
                            .font_family("Menlo")
                            .text_size(px(theme::ty().ui.meta))
                            .child(self.patterns.clone()),
                    )
                    .child(
                        row()
                            .justify_between()
                            .gap(px(6.))
                            .child(
                                div()
                                    .text_size(px(theme::ty().ui.caption))
                                    .text_color(t.subtle)
                                    .child(tf(
                                        "settings.files.patternCount",
                                        &[("count", draft.len().into())],
                                    )),
                            )
                            .child(row().gap(px(6.)).child(apply).child(reset)),
                    ),
            );
        section(tr(Page::Files.title()), t).child(subsection(
            None,
            None,
            true,
            vec![show_hidden.into_any_element(), editor.into_any_element()],
            t,
        ))
    }
}
