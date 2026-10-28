//! Port of `AppearanceSettingsView.tsx` with `InterfacePaletteSettings`,
//! `ThemePreview`, `SubThemeSettingsSection` and `InterfaceStyleSetting`.
use super::super::{
    preference_types::ThemeMode, settings_workspace_surface::SettingsWorkspaceSurface,
};
use super::Page;
use crate::{
    localization::{t as tr, tf},
    theme::{self, Theme},
    ui::{
        components::{
            FileIcon, Icon, Segment, SegmentLayout, SegmentedControl, Select, SelectOption,
            SettingRow, SettingsList, SettingsSection, Switch, tooltip,
        },
        loading::{self, LoadingMark, LoadingStyle, model::Shape},
    },
};
use gpui::{prelude::*, *};
use gpui_kit::{
    base::{Disableable as _, h_flex, v_flex},
    component::Sizable as _,
};

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
    h_flex()
        .flex_1()
        .min_w_0()
        .h_full()
        .items_stretch()
        .bg(p.canvas)
        .when(left, |d| d.rounded_l(px(R)))
        .when(right, |d| d.rounded_r(px(R)))
        .child(
            v_flex()
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
            v_flex()
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
    pub(super) fn appearance(&self, t: Theme, cx: &mut Context<Self>) -> AnyElement {
        let state = self.preferences.read(cx).state.clone();
        let prefs = self.preferences.clone();

        // Theme mode cards (`desktop-theme-choice`).
        let mut modes = h_flex()
            .flex_wrap()
            .justify_end()
            .gap(px(6.))
            .max_w(px(520.));
        for mode in [ThemeMode::System, ThemeMode::Light, ThemeMode::Dark] {
            let active = state.theme_mode == mode;
            let preview = h_flex()
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
                        h_flex()
                            .gap(px(5.))
                            .px(px(2.))
                            .h(px(17.))
                            .line_height(px(17.))
                            .child(
                                Icon::new(mode.icon())
                                    .with_size(px(13.))
                                    .stroke(2.)
                                    .color(if active { t.text } else { t.muted }),
                            )
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
        let pack_control = h_flex()
            .gap(px(4.))
            .child(
                Select::new("theme-pack", pack_name, move |_| {
                    theme::pack_choices()
                        .map(|(id, name)| {
                            let prefs = pack_prefs.clone();
                            SelectOption::new(name)
                                .selected(id == current_pack)
                                .on_select(move |_, cx| {
                                    prefs.update(cx, |p, cx| {
                                        p.change(|p| p.theme_pack = id.into(), cx)
                                    })
                                })
                        })
                        .collect()
                })
                .width_range(124., 156.),
            )
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
                    .child(Icon::new(icon).small().stroke(2.).color(t.text_disabled))
                    .tooltip(tooltip(tf(
                        "settings.sidebar.notAvailable",
                        &[("section", label.into())],
                    )))
            }));

        // File icons.
        let icon_options = crate::file_kind::themes()
            .map(|id| {
                let prefs = prefs.clone();
                Segment::new(tr(&format!("settings.appearance.fileIcons.{id}.label")))
                    .leading(FileIcon::file("document.md", id).size_px(14.))
                    .selected(state.file_icon_theme == id)
                    .on_select(move |_, cx| {
                        prefs.update(cx, |p, cx| p.change(|p| p.file_icon_theme = id.into(), cx))
                    })
            })
            .collect::<Vec<_>>();

        let file_icon_preferences = prefs.clone();

        // One loading material; each option previews the actual mark and
        // placeholder primitives (`desktop-loading-style-preview`).
        let loading_options = LoadingStyle::ALL
            .into_iter()
            .map(|style| {
                let prefs = prefs.clone();
                let id = style.id();
                Segment::new(tr(&format!("settings.appearance.loadingStyle.{id}.label")))
                    .leading(
                        h_flex()
                            .gap(px(7.))
                            .child(
                                LoadingMark::new(SharedString::from(format!(
                                    "loading-preview-{id}"
                                )))
                                .loading_style(style),
                            )
                            .child(loading::placeholder(
                                SharedString::from(format!("placeholder-preview-{id}")),
                                34.,
                                14.,
                                vec![
                                    Shape {
                                        x: 0.,
                                        y: 2.,
                                        width: 10.,
                                        height: 10.,
                                        radius: 3.,
                                    },
                                    Shape {
                                        x: 14.,
                                        y: 4.,
                                        width: 20.,
                                        height: 6.,
                                        radius: 3.,
                                    },
                                ],
                                style,
                            )),
                    )
                    .selected(state.loading_style == style)
                    .on_select(move |_, cx| {
                        prefs.update(cx, |p, cx| p.change(|p| p.loading_style = style, cx))
                    })
            })
            .collect::<Vec<_>>();

        // Header elements (`HeaderElementsSetting`, `.desktop-settings-tool-list`):
        // 32px items, 8px start padding, a 14px subtle glyph 7px before the
        // 13px label, the switch 8px after it.
        let mut tools = v_flex().gap(px(2.));
        for (id, icon, enabled) in [
            ("changes", "version-control", state.header_changes),
            ("terminal", "agent-entry", state.header_terminal),
        ] {
            let prefs = prefs.clone();
            let label = tr(&format!("settings.appearance.headerElements.{id}"));
            tools = tools.child(
                h_flex()
                    .h(px(theme::control()))
                    .pl(px(8.))
                    .justify_between()
                    .gap(px(8.))
                    .child(
                        h_flex()
                            .gap(px(7.))
                            .text_size(px(theme::ty().ui.meta))
                            .line_height(px(17.))
                            .text_color(t.muted)
                            .child(Icon::new(icon).small().color(t.subtle))
                            .child(label),
                    )
                    .child(
                        Switch::new(SharedString::from(format!("header-{id}")), label)
                            .checked(enabled)
                            .on_change(move |on, _, cx| {
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
                            }),
                    ),
            );
        }

        // Interface style: only the Default skin exists natively.
        let xp_label = tr("settings.appearance.interfaceStyle.windowsXp");
        let style_options = [
            Segment::new(tr("settings.appearance.interfaceStyle.default")).selected(true),
            Segment::new(xp_label).disabled(true),
        ];
        let pointer_prefs = prefs.clone();
        // `.desktop-theme-mode-row`: the label and cards align to the top,
        // 7px inside the row.
        let theme_row = SettingRow::new(tr("settings.appearance.theme.title"))
            .control(modes)
            .items_start()
            .py(px(7.));
        // `.desktop-theme-settings-section` (`SubThemeSettingsSection`) opens
        // 20px below the theme row and owns its own list.
        SettingsSection::new(tr(Page::Appearance.title()))
            .child(
                SettingsList::new()
                    .lead(true)
                    .child(theme_row)
                    .child(
                        SettingRow::new(tr("settings.appearance.themes.pack"))
                            .control(pack_control)
                            .mt(px(20.)),
                    )
                    .when(icon_options.len() > 1, |list| {
                        list.child(
                            SettingRow::new(tr("settings.appearance.fileIcons.title")).control(
                                SegmentedControl::new("file-icons")
                                    .layout(SegmentLayout::Equal(360.))
                                    .segments(icon_options),
                            ),
                        )
                    })
                    .child(
                        SettingRow::new(tr("settings.appearance.showFileIcons.title")).control(
                            Switch::new(
                                "show-file-icons",
                                tr("settings.appearance.showFileIcons.title"),
                            )
                            .checked(state.show_file_icons)
                            .on_change(move |on, _, cx| {
                                file_icon_preferences
                                    .update(cx, |p, cx| p.change(|p| p.show_file_icons = on, cx));
                            }),
                        ),
                    )
                    .child(
                        SettingRow::new(tr("settings.appearance.loadingStyle.title")).control(
                            SegmentedControl::new("loading-style")
                                .layout(SegmentLayout::Hug)
                                .segments(loading_options),
                        ),
                    )
                    // `.desktop-settings-tools-row`: top-aligned, 5px block padding.
                    .child(
                        SettingRow::new(tr("settings.appearance.headerElements.title"))
                            .control(tools)
                            .items_start()
                            .py(px(5.)),
                    )
                    .child(
                        SettingRow::new(tr("settings.appearance.pointerCursors.title")).control(
                            Switch::new(
                                "pointer-cursors",
                                tr("settings.appearance.pointerCursors.title"),
                            )
                            .checked(state.pointer_cursors)
                            .tooltip(tr("settings.appearance.pointerCursors.detail"))
                            .on_change(move |on, _, cx| {
                                pointer_prefs
                                    .update(cx, |p, cx| p.change(|p| p.pointer_cursors = on, cx))
                            }),
                        ),
                    )
                    .child(
                        SettingRow::new(tr("settings.appearance.interfaceStyle.title")).control(
                            SegmentedControl::new("interface-style")
                                .layout(SegmentLayout::MinWidth(104.))
                                .segments(style_options)
                                .tooltip(tf(
                                    "settings.sidebar.notAvailable",
                                    &[("section", xp_label.into())],
                                )),
                        ),
                    ),
            )
            .into_any_element()
    }
}
