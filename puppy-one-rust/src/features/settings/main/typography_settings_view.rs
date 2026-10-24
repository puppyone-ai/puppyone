//! Port of `TypographySettingsView.tsx`: `TypographyScaleSetting` + `TypographyPreview`.
use super::super::{components::*, settings_workspace_surface::SettingsWorkspaceSurface};
use super::Page;
use crate::{
    localization::t as tr,
    theme::{self, Theme},
    typography::Scale,
    ui::{SegmentOption, column, icon_sized, row, segment},
};
use gpui::{prelude::*, *};
impl SettingsWorkspaceSurface {
    pub(super) fn typography(&self, t: Theme, cx: &mut Context<Self>) -> Div {
        let selected = self.preferences.read(cx).state.text_scale;
        let options = [Scale::Small, Scale::Medium, Scale::Large]
            .into_iter()
            .map(|scale| {
                let prefs = self.preferences.clone();
                SegmentOption {
                    label: tr(scale.label_key()).into(),
                    leading: None,
                    active: scale == selected,
                    disabled: false,
                    on_select: Box::new(move |_, cx| {
                        prefs.update(cx, |p, cx| p.change(|p| p.text_scale = scale, cx))
                    }),
                }
            })
            .collect();
        section(tr(Page::Typography.title()), t).child(lead_list(vec![
            setting_row(
                tr("settings.typography.textSize.title"),
                segment("text-scale", options, t),
                t,
            )
            .into_any_element(),
            preview(t).into_any_element(),
        ]))
    }
}
/// `TypographyPreview`: static workspace sample on the live type roles.
fn preview(t: Theme) -> Div {
    let m = theme::ty();
    let file = |name: &'static str, selected: bool| {
        row()
            .gap(px(6.))
            .p(px(6.))
            .pl(px(26.))
            .rounded(px(5.))
            .when(selected, |d| d.bg(t.control))
            .child(icon_sized("file-text", 15., t.muted))
            .child(div().truncate().child(name))
    };
    // grid-template-columns: 1fr 2.1fr 1.15fr
    let left = column()
        .w(relative(1. / 4.25))
        .min_w_0()
        .py(px(12.))
        .px(px(8.))
        .bg(t.panel)
        .border_r_1()
        .border_color(t.divider)
        .text_size(px(m.left.content))
        .line_height(px(m.left.line_height))
        .text_color(t.sidebar_text)
        .child(
            div()
                .px(px(6.))
                .pb(px(10.))
                .text_size(px(m.left.meta))
                .text_color(t.subtle)
                .child(tr("shell.navigation.files")),
        )
        .child(
            row()
                .gap(px(6.))
                .p(px(6.))
                .child(icon_sized("chevron-down", 14., t.muted))
                .child(icon_sized("folder", 15., t.muted))
                .child("PuppyOne"),
        )
        .child(file("Notes.md", true))
        .child(file("Ideas.md", false));
    let editor = column()
        .w(relative(2.1 / 4.25))
        .min_w_0()
        .p(px(18.))
        .gap(px(8.))
        .bg(t.canvas)
        .text_color(t.text)
        .child(
            div()
                .text_size(px(m.editor.headings[0]))
                .font_weight(FontWeight::SEMIBOLD)
                .child(tr("settings.typography.preview.headingOne")),
        )
        .child(
            div()
                .text_size(px(m.editor.headings[1]))
                .font_weight(FontWeight::SEMIBOLD)
                .child(tr("settings.typography.preview.headingTwo")),
        )
        .child(
            div()
                .text_size(px(m.editor.headings[2]))
                .font_weight(FontWeight::SEMIBOLD)
                .child(tr("settings.typography.preview.headingThree")),
        )
        .child(
            div()
                .text_size(px(m.editor.content))
                .line_height(px(m.editor.line_height))
                .text_color(theme::mix(t.text, t.muted, 0.8))
                .child(format!(
                    "{} {}.",
                    tr("settings.typography.preview.body"),
                    tr("settings.typography.preview.bold")
                )),
        );
    let right = column()
        .w(relative(1.15 / 4.25))
        .min_w_0()
        .py(px(12.))
        .px(px(8.))
        .bg(t.panel)
        .border_l_1()
        .border_color(t.divider)
        .text_size(px(m.right.content))
        .line_height(px(m.right.control_line_height))
        .child(
            row()
                .gap(px(6.))
                .px(px(6.))
                .pb(px(10.))
                .text_color(t.muted)
                .child(icon_sized("message-square", 15., t.muted))
                .child(tr("settings.typography.preview.chat")),
        )
        .child(
            column()
                .px(px(6.))
                .py(px(4.))
                .gap(px(2.))
                .child(
                    div()
                        .text_size(px(m.right.meta))
                        .text_color(t.subtle)
                        .child(tr("agent.name")),
                )
                .child(
                    div()
                        .line_height(px(m.right.content + 8.))
                        .text_color(t.text)
                        .child(tr("settings.typography.preview.message")),
                ),
        );
    column()
        .w_full()
        .mt(px(8.))
        .rounded(px(10.))
        .border_1()
        .border_color(t.divider)
        .overflow_hidden()
        .bg(t.canvas)
        .child(
            row()
                .min_h(px(theme::control()))
                .px(px(12.))
                .py(px(6.))
                .gap(px(6.))
                .bg(t.panel)
                .border_b_1()
                .border_color(t.divider)
                .text_size(px(m.header.content))
                .text_color(t.text)
                .child(icon_sized("folder", 15., t.muted))
                .child("PuppyOne"),
        )
        .child(row().items_stretch().child(left).child(editor).child(right))
}
