//! Port of `FileSettingsViews.tsx` ("Git Ignore"): Explorer visibility —
//! show hidden files, and newline-separated exclude patterns with Apply/Reset.
use super::super::{
    preference_types::{FilesVisibility, normalize_patterns},
    settings_workspace_surface::SettingsWorkspaceSurface,
};
use super::Page;
use crate::{
    localization::t as tr,
    theme::{self, Theme},
    ui::components::{Button, Icon, SettingRow, SettingsSection, SettingsSubsection, Switch},
};
use gpui::{prelude::*, *};
use gpui_kit::{
    base::{Disableable as _, h_flex, v_flex},
    component::Sizable as _,
};
impl SettingsWorkspaceSurface {
    pub(super) fn files(&self, t: Theme, cx: &mut Context<Self>) -> AnyElement {
        let state = self.preferences.read(cx).state.files.clone();
        let draft = normalize_patterns(self.patterns.read(cx).text());
        let dirty = draft != state.exclude_patterns;
        self.patterns.update(cx, |i, _| {
            i.appearance = false;
            i.prompt_text = Some((theme::ty().ui.meta, 17.));
            // Kit centres a textarea's lines in any extra height; the box
            // below owns the 148px minimum so lines start at the top inset.
            i.min_height = 0.;
        });
        let prefs = self.preferences.clone();
        let show_hidden = SettingRow::new(tr("settings.files.showHidden")).control(
            Switch::new("show-hidden-files", tr("settings.files.showHidden"))
                .checked(state.show_hidden_files)
                .on_change(move |on, _, cx| {
                    prefs.update(cx, |p, cx| p.change(|p| p.files.show_hidden_files = on, cx))
                }),
        );
        // `.desktop-settings-row-action`.
        let apply = Button::new("apply-patterns")
            .icon("check")
            .label(tr("common.action.apply"))
            .disabled(!dirty)
            .on_click(cx.listener(|s, _, _, cx| {
                let patterns = normalize_patterns(s.patterns.read(cx).text());
                s.preferences.update(cx, |p, cx| {
                    p.change(|p| p.files.exclude_patterns = patterns, cx)
                });
            }));
        let reset = Button::new("reset-patterns")
            .icon("refresh-cw")
            .label(tr("common.action.reset"))
            .on_click(cx.listener(|s, _, _, cx| {
                s.preferences.update(cx, |p, cx| {
                    p.change(
                        |p| p.files.exclude_patterns = FilesVisibility::default().exclude_patterns,
                        cx,
                    )
                });
                s.sync_patterns(cx);
            }));
        // `.desktop-settings-pattern-editor`: top-aligned, 7px block padding,
        // the control `min(100%, 520px)` at the end; the textarea is Geist Mono
        // 13/17 with 9px/10px padding over `--po-input`. The pattern count is
        // only the textarea's description in the product.
        let editor = h_flex()
            .w_full()
            .min_h(px(184.))
            .items_start()
            .justify_between()
            .gap(px(18.))
            .px(px(10.))
            .py(px(7.))
            .child(
                div()
                    .flex_shrink_0()
                    .text_size(px(theme::ty().ui.label))
                    .line_height(px(18.))
                    .text_color(t.subtle)
                    .child(tr("settings.files.excludePatterns")),
            )
            .child(
                v_flex()
                    .w(px(520.))
                    .max_w_full()
                    .min_w_0()
                    .gap(px(6.))
                    .child(
                        div()
                            .id("exclude-patterns-box")
                            .relative()
                            .w_full()
                            .min_h(px(148.))
                            .py(px(9.))
                            .px(px(6.))
                            .border_1()
                            .border_color(t.divider)
                            .rounded(px(6.))
                            .bg(t.input)
                            .font_family(theme::MONO)
                            .cursor_text()
                            .on_click({
                                let focus = self.patterns.focus_handle(cx);
                                move |_, window, cx| focus.focus(window, cx)
                            })
                            .child(self.patterns.clone())
                            .child(resize_grip(t)),
                    )
                    .child(h_flex().justify_end().gap(px(6.)).child(apply).child(reset)),
            );
        SettingsSection::new(tr(Page::Files.title()))
            .child(
                SettingsSubsection::new()
                    .lead(true)
                    .child(show_hidden)
                    .child(editor),
            )
            .into_any_element()
    }
}
/// Chromium's `resize: vertical` grip in the textarea's inner corner: an
/// 8px pair of diagonals, embossed with a highlight in dark schemes.
fn resize_grip(t: Theme) -> Div {
    let layer = |name: &'static str, stroke: f32, color: Rgba| {
        Icon::new(name)
            .with_size(px(8.))
            .stroke(stroke)
            .color(color)
            .absolute()
            .top_0()
            .left_0()
    };
    let grip = div().absolute().right_0().bottom_0().size(px(8.));
    match theme::native_resize_grip(t.dark) {
        (shadow, Some(highlight)) => grip
            .child(layer("textarea-resizer", 1., shadow))
            .child(layer("textarea-resizer-highlight", 1.4, highlight)),
        (shadow, None) => grip.child(layer("textarea-resizer", 1.5, shadow)),
    }
}
