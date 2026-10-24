//! Port of `AppearanceSettingsView.tsx` with `InterfacePaletteSettings`,
//! `ThemePreview`, `SubThemeSettingsSection` and `InterfaceStyleSetting`.
use super::super::{
    components::*,
    preference_types::{GitSidebarLayout, ThemeMode},
    settings_workspace_surface::SettingsWorkspaceSurface,
};
use super::Page;
use crate::{
    localization::{t as tr, tf},
    theme::{self, Theme},
    ui::{
        SegmentLayout, SegmentOption, column, icon_stroke, pulse_grid, row, segment_with, switch,
        tooltip,
    },
};
use gpui::{prelude::*, *};
use gpui_kit::component::menu::PopupMenuItem;

/// `ThemePreviewSurface`: a miniature window drawn with one pack/mode palette.
/// `(left, right)` round the outer corners: GPUI clips children to the
/// preview's rectangle, not its 5px corners, so each edge owns its 4px radius.
fn preview_surface(pack: &str, dark: bool, (left, right): (bool, bool)) -> Div {
    const R: f32 = 4.;
    let p = theme::pack_theme(pack, dark);
    let bar = move |width: f32, accent: bool| {
        div()
            .w(relative(width))
            .h(px(if accent { 4. } else { 3. }))
            .rounded_full()
            .bg(if accent {
                p.accent
            } else {
                theme::alpha(p.muted, 0.28)
            })
    };
    row()
        .flex_1()
        .min_w_0()
        .h_full()
        .items_stretch()
        .bg(p.canvas)
        .when(left, |d| d.rounded_l(px(R)))
        .when(right, |d| d.rounded_r(px(R)))
        .child(
            column()
                .when(left, |d| d.rounded_l(px(R)))
                .w(relative(0.31))
                .gap(px(3.))
                .px(px(4.))
                .py(px(6.))
                .bg(p.sidebar)
                .border_r_1()
                .border_color(p.divider)
                .child(bar(0.78, false))
                .child(bar(0.58, false))
                .child(bar(0.78, false)),
        )
        .child(
            column()
                .when(right, |d| d.rounded_r(px(R)))
                .flex_1()
                .gap(px(3.))
                .px(px(4.))
                .py(px(6.))
                .bg(p.panel)
                .child(bar(0.42, true))
                .child(bar(0.78, false))
                .child(bar(0.58, false)),
        )
}

impl SettingsWorkspaceSurface {
    pub(super) fn appearance(&self, t: Theme, cx: &mut Context<Self>) -> Div {
        let state = self.preferences.read(cx).state.clone();
        let prefs = self.preferences.clone();

        // Theme mode cards (`desktop-theme-choice`).
        let mut modes = row().flex_wrap().justify_end().gap(px(6.)).max_w(px(520.));
        for mode in [ThemeMode::System, ThemeMode::Light, ThemeMode::Dark] {
            let active = state.theme_mode == mode;
            let preview = row()
                .w_full()
                .h(px(38.))
                .overflow_hidden()
                .rounded(px(5.))
                .border_1()
                .border_color(theme::alpha(t.border, 0.72))
                .bg(t.inset);
            let preview = match mode {
                ThemeMode::System => preview
                    .child(
                        preview_surface(&state.theme_pack, false, (true, false))
                            .border_r_1()
                            .border_color(theme::alpha(t.border_strong, 0.72)),
                    )
                    .child(preview_surface(&state.theme_pack, true, (false, true))),
                ThemeMode::Light => {
                    preview.child(preview_surface(&state.theme_pack, false, (true, true)))
                }
                ThemeMode::Dark => {
                    preview.child(preview_surface(&state.theme_pack, true, (true, true)))
                }
            };
            let prefs = prefs.clone();
            let hover_border = theme::mix(t.accent, t.border, 0.42);
            let hover_bg = theme::mix(t.selected, t.panel, 0.72);
            // `.desktop-theme-choice.active`: `0 0 0 1px` accent ring at 26%,
            // drawn as an outline because a GPUI shadow would also show
            // through the card's translucent fill.
            let ring = div()
                .absolute()
                .top(px(-2.))
                .left(px(-2.))
                .right(px(-2.))
                .bottom(px(-2.))
                .rounded(px(9.))
                .border_1()
                .border_color(theme::alpha(t.accent, 0.26));
            modes = modes.child(
                gpui_kit::base::Button::new(SharedString::from(format!("theme-mode-{mode:?}")))
                    .accessibility_label(tr(mode.label_key()))
                    .selected(active)
                    .flex()
                    .flex_col()
                    .gap(px(5.))
                    .w(px(102.))
                    .p(px(5.))
                    .border_1()
                    .rounded(px(8.))
                    .cursor(theme::clickable_cursor())
                    .text_size(px(theme::ty().ui.hint))
                    .relative()
                    .items_stretch()
                    .when(active, |b| {
                        b.border_color(hover_border)
                            .bg(hover_bg)
                            .child(ring)
                            .text_color(t.text)
                            .font_weight(FontWeight::MEDIUM)
                    })
                    .when(!active, |b| {
                        b.border_color(t.border_subtle)
                            .bg(theme::alpha(t.panel_raised, 0.82))
                            .text_color(t.muted)
                            .hover(move |s| {
                                s.border_color(hover_border).bg(hover_bg).text_color(t.text)
                            })
                    })
                    .child(preview)
                    .child(
                        // `.desktop-theme-choice-label`: 13px icon, 17px line.
                        row()
                            .gap(px(5.))
                            .px(px(2.))
                            .h(px(17.))
                            .line_height(px(17.))
                            .child(icon_stroke(
                                mode.icon(),
                                13.,
                                2.,
                                if active { t.text } else { t.muted },
                            ))
                            .child(tr(mode.label_key())),
                    )
                    .on_click(move |_, _, cx| {
                        prefs.update(cx, |p, cx| {
                            p.change(
                                |p| {
                                    p.theme_mode = mode;
                                    if mode != ThemeMode::System {
                                        p.dark = mode == ThemeMode::Dark;
                                    }
                                },
                                cx,
                            )
                        })
                    }),
            );
        }

        // Theme pack (`SubThemeSettingsSection`).
        let current_pack = state.theme_pack.clone();
        let pack_name = theme::pack_choices()
            .find(|(id, _)| *id == current_pack)
            .map(|(_, n)| n)
            .unwrap_or("Neutral");
        let pack_prefs = prefs.clone();
        // `.desktop-theme-pack-controls`: the select hugs its value between
        // 124 and 156px; two 28px icon actions follow, 4px apart.
        let pack_control = row()
            .gap(px(4.))
            .child(select_sized(
                "theme-pack",
                pack_name,
                false,
                (124., 156.),
                t,
                move || {
                    theme::pack_choices()
                        .map(|(id, name)| {
                            let prefs = pack_prefs.clone();
                            PopupMenuItem::new(name)
                                .checked(id == current_pack)
                                .on_click(move |_, _, cx| {
                                    prefs.update(cx, |p, cx| {
                                        p.change(|p| p.theme_pack = id.into(), cx)
                                    })
                                })
                        })
                        .collect()
                },
            ))
            .children(["folder-open", "plus"].into_iter().map(|icon| {
                let label = tr(if icon == "plus" {
                    "settings.appearance.themes.add"
                } else {
                    "settings.appearance.themes.openFolder"
                });
                // `.desktop-theme-pack-icon-action:disabled`: 14px glyph in
                // `--po-text-disabled` at 58%.
                div()
                    .id(SharedString::from(format!("theme-pack-{icon}")))
                    .size(px(theme::control_compact()))
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(px(6.))
                    .opacity(0.58)
                    .child(icon_stroke(icon, 14., 2., t.text_disabled))
                    .tooltip(tooltip(tf(
                        "settings.sidebar.notAvailable",
                        &[("section", label.into())],
                    )))
            }));

        // File icons.
        let icon_options = crate::file_kind::themes()
            .map(|id| {
                let prefs = prefs.clone();
                SegmentOption {
                    label: tr(&format!("settings.appearance.fileIcons.{id}.label")).into(),
                    leading: Some(
                        img(SharedString::from(crate::file_kind::asset_path(
                            id,
                            "document.md",
                            false,
                            t.dark,
                        )))
                        .size(px(14.))
                        .into_any_element(),
                    ),
                    active: state.file_icon_theme == id,
                    disabled: false,
                    on_select: Box::new(move |_, cx| {
                        prefs.update(cx, |p, cx| p.change(|p| p.file_icon_theme = id.into(), cx))
                    }),
                }
            })
            .collect();

        // Git sidebar layout.
        let layout_options = [GitSidebarLayout::Cards, GitSidebarLayout::Dividers]
            .into_iter()
            .map(|layout| {
                let prefs = prefs.clone();
                let key = match layout {
                    GitSidebarLayout::Cards => "settings.appearance.gitSidebarLayout.cards.label",
                    GitSidebarLayout::Dividers => {
                        "settings.appearance.gitSidebarLayout.dividers.label"
                    }
                };
                SegmentOption {
                    label: tr(key).into(),
                    leading: None,
                    active: state.git_sidebar_layout == layout,
                    disabled: false,
                    on_select: Box::new(move |_, cx| {
                        prefs.update(cx, |p, cx| p.change(|p| p.git_sidebar_layout = layout, cx))
                    }),
                }
            })
            .collect();

        // Loading animation.
        let loading_options = pulse_grid::presets()
            .map(|id| {
                let prefs = prefs.clone();
                SegmentOption {
                    label: tr(&format!("settings.appearance.loadingAnimation.{id}.label")).into(),
                    leading: Some(
                        pulse_grid::pulse_grid(
                            SharedString::from(format!("loading-preview-{id}")),
                            id,
                            pulse_grid::PulseSize::Sm,
                            t.subtle,
                        )
                        .into_any_element(),
                    ),
                    active: state.loading_animation == id,
                    disabled: false,
                    on_select: Box::new(move |_, cx| {
                        prefs.update(cx, |p, cx| {
                            p.change(|p| p.loading_animation = id.into(), cx)
                        })
                    }),
                }
            })
            .collect();

        // Header elements (`HeaderElementsSetting`, `.desktop-settings-tool-list`):
        // 32px items, 8px start padding, a 14px subtle glyph 7px before the
        // 13px label, the switch 8px after it.
        let mut tools = column().gap(px(2.));
        for (id, icon, enabled) in [
            ("changes", "version-control", state.header_changes),
            ("terminal", "agent-entry", state.header_terminal),
        ] {
            let prefs = prefs.clone();
            let label = tr(&format!("settings.appearance.headerElements.{id}"));
            tools = tools.child(
                row()
                    .h(px(theme::control()))
                    .pl(px(8.))
                    .justify_between()
                    .gap(px(8.))
                    .child(
                        row()
                            .gap(px(7.))
                            .text_size(px(theme::ty().ui.meta))
                            .line_height(px(17.))
                            .text_color(t.muted)
                            .child(crate::ui::icon_sized(icon, 14., t.subtle))
                            .child(label),
                    )
                    .child(switch(
                        SharedString::from(format!("header-{id}")),
                        label,
                        enabled,
                        false,
                        t,
                        move |on, _, cx| {
                            prefs.update(cx, |p, cx| {
                                p.change(
                                    |p| {
                                        if id == "changes" {
                                            p.header_changes = on
                                        } else {
                                            p.header_terminal = on
                                        }
                                    },
                                    cx,
                                )
                            })
                        },
                    )),
            );
        }

        // Interface style: only the Default skin exists natively.
        let xp_label = tr("settings.appearance.interfaceStyle.windowsXp");
        let style_options = vec![
            SegmentOption {
                label: tr("settings.appearance.interfaceStyle.default").into(),
                leading: None,
                active: true,
                disabled: false,
                on_select: Box::new(|_, _| {}),
            },
            SegmentOption {
                label: xp_label.into(),
                leading: None,
                active: false,
                disabled: true,
                on_select: Box::new(|_, _| {}),
            },
        ];
        let pointer_prefs = prefs.clone();
        // `.desktop-theme-mode-row`: the label and cards align to the top,
        // 7px inside the row.
        let theme_row = setting_row(tr("settings.appearance.theme.title"), modes, t)
            .items_start()
            .py(px(7.));
        // `.desktop-theme-settings-section` (`SubThemeSettingsSection`) opens
        // 20px below the theme row and owns its own list.
        section(tr(Page::Appearance.title()), t).child(lead_list(vec![
            theme_row.into_any_element(),
            setting_row(tr("settings.appearance.themes.pack"), pack_control, t)
                .mt(px(20.))
                .into_any_element(),
            setting_row(
                tr("settings.appearance.fileIcons.title"),
                segment_with("file-icons", icon_options, SegmentLayout::Grid(360.), t),
                t,
            )
            .into_any_element(),
            setting_row(
                tr("settings.appearance.gitSidebarLayout.title"),
                segment_with("git-layout", layout_options, SegmentLayout::Hug, t),
                t,
            )
            .into_any_element(),
            setting_row(
                tr("settings.appearance.loadingAnimation.title"),
                segment_with("loading-animation", loading_options, SegmentLayout::Hug, t),
                t,
            )
            .into_any_element(),
            // `.desktop-settings-tools-row`: top-aligned, 5px block padding.
            setting_row(tr("settings.appearance.headerElements.title"), tools, t)
                .items_start()
                .py(px(5.))
                .into_any_element(),
            setting_row(
                tr("settings.appearance.pointerCursors.title"),
                switch(
                    "pointer-cursors",
                    tr("settings.appearance.pointerCursors.title"),
                    state.pointer_cursors,
                    false,
                    t,
                    move |on, _, cx| {
                        pointer_prefs.update(cx, |p, cx| p.change(|p| p.pointer_cursors = on, cx))
                    },
                )
                .tooltip(tooltip(tr("settings.appearance.pointerCursors.detail"))),
                t,
            )
            .into_any_element(),
            setting_row(
                tr("settings.appearance.interfaceStyle.title"),
                segment_with(
                    "interface-style",
                    style_options,
                    SegmentLayout::MinWidth(104.),
                    t,
                )
                .id("interface-style-segment")
                .tooltip(tooltip(tf(
                    "settings.sidebar.notAvailable",
                    &[("section", xp_label.into())],
                ))),
                t,
            )
            .into_any_element(),
        ]))
    }
}
