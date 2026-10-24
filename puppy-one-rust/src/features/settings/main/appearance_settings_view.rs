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
    ui::{SegmentOption, column, icon_sized, pulse_grid, row, segment, switch, tooltip},
};
use gpui::{prelude::*, *};
use gpui_kit::component::menu::PopupMenuItem;

/// `ThemePreviewSurface`: a miniature window drawn with one pack/mode palette.
fn preview_surface(pack: &str, dark: bool) -> Div {
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
        .child(
            column()
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
                        preview_surface(&state.theme_pack, false)
                            .border_r_1()
                            .border_color(theme::alpha(t.border_strong, 0.72)),
                    )
                    .child(preview_surface(&state.theme_pack, true)),
                ThemeMode::Light => preview.child(preview_surface(&state.theme_pack, false)),
                ThemeMode::Dark => preview.child(preview_surface(&state.theme_pack, true)),
            };
            let prefs = prefs.clone();
            let hover_border = theme::mix(t.accent, t.border, 0.42);
            let hover_bg = theme::mix(t.selected, t.panel, 0.72);
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
                    .when(active, |b| {
                        b.border_color(hover_border)
                            .bg(hover_bg)
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
                        row()
                            .gap(px(5.))
                            .px(px(2.))
                            .child(icon_sized(
                                mode.icon(),
                                13.,
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
        let pack_control = row()
            .gap(px(4.))
            .child(select("theme-pack", pack_name, false, t, move || {
                theme::pack_choices()
                    .map(|(id, name)| {
                        let prefs = pack_prefs.clone();
                        PopupMenuItem::new(name)
                            .checked(id == current_pack)
                            .on_click(move |_, _, cx| {
                                prefs.update(cx, |p, cx| p.change(|p| p.theme_pack = id.into(), cx))
                            })
                    })
                    .collect()
            }))
            .children(["folder-open", "plus"].into_iter().map(|icon| {
                let label = tr(if icon == "plus" {
                    "settings.appearance.themes.add"
                } else {
                    "settings.appearance.themes.openFolder"
                });
                crate::ui::icon_button(SharedString::from(format!("theme-pack-{icon}")), icon, t)
                    .accessibility_label(label)
                    .disabled(true)
                    .opacity(0.5)
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

        // Header elements (`HeaderElementsSetting`): Changes and the Agent entry.
        let mut tools = column().gap(px(2.)).min_w(px(220.));
        for (id, icon, enabled) in [
            ("changes", "git-branch", state.header_changes),
            ("terminal", "agent-entry", state.header_terminal),
        ] {
            let prefs = prefs.clone();
            let label = tr(&format!("settings.appearance.headerElements.{id}"));
            tools = tools.child(
                row()
                    .h(px(theme::control()))
                    .justify_between()
                    .gap(px(12.))
                    .child(
                        row()
                            .gap(px(6.))
                            .text_color(t.muted)
                            .child(icon_sized(icon, 14., t.muted))
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
        section(tr(Page::Appearance.title()), t).child(lead_list(vec![
            setting_row(tr("settings.appearance.theme.title"), modes, t).into_any_element(),
            setting_row(tr("settings.appearance.themes.pack"), pack_control, t).into_any_element(),
            setting_row(
                tr("settings.appearance.fileIcons.title"),
                segment("file-icons", icon_options, t),
                t,
            )
            .into_any_element(),
            setting_row(
                tr("settings.appearance.gitSidebarLayout.title"),
                segment("git-layout", layout_options, t),
                t,
            )
            .into_any_element(),
            setting_row(
                tr("settings.appearance.loadingAnimation.title"),
                segment("loading-animation", loading_options, t),
                t,
            )
            .into_any_element(),
            setting_row(tr("settings.appearance.headerElements.title"), tools, t)
                .items_start()
                .py(px(6.))
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
                segment("interface-style", style_options, t)
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
