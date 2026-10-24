//! Port of `CreateNewSettingsView.tsx`: Main menu tree with the nested custom
//! submenu, Hidden list, drag to reorder and Restore defaults. A context menu
//! offers the same moves without a pointer drag.
use super::super::{components::*, settings_workspace_surface::SettingsWorkspaceSurface};
use super::Page;
use crate::{
    features::create_new::create_entry_menu_registry::{Entry, MenuSettings, Placement},
    localization::{t as tr, tf},
    theme::{self, Theme},
    ui::{Tone, action_button, column, menu_icon, row, tooltip},
};
use gpui::{prelude::*, *};
use gpui_kit::component::menu::{ContextMenuExt, PopupMenuItem};
#[derive(Clone)]
struct DragEntry(Entry, SharedString);

/// `.desktop-create-new-glyph`: a 20px slot holding the 18px file glyph (or
/// the 15px Workflow mark of the custom submenu).
fn glyph(entry: Entry, icon_theme: &str, dark: bool) -> AnyElement {
    let slot = div()
        .size(px(20.))
        .flex_shrink_0()
        .flex()
        .items_center()
        .justify_center();
    if entry == Entry::CustomFiles {
        return slot
            .child(crate::ui::icon_stroke(
                "workflow",
                15.,
                2.,
                theme::Theme::new(dark).muted,
            ))
            .into_any_element();
    }
    let (name, folder) = match entry {
        Entry::Folder => ("folder".to_owned(), true),
        e => (format!("x{}", e.extension()), false),
    };
    slot.child(
        img(SharedString::from(crate::file_kind::asset_path(
            icon_theme, &name, folder, dark,
        )))
        .size(px(18.)),
    )
    .into_any_element()
}
/// `isCreateNewItemAvailable`: only experiment-gated entries are unavailable
/// in this list (PuppyFlow files behind `enablePuppyFlowFiles`).
fn listed_available(
    entry: Entry,
    experimental: &super::super::preference_types::Experimental,
) -> bool {
    entry != Entry::Puppyflow || experimental.puppy_flow_files
}

impl SettingsWorkspaceSurface {
    fn create_row(
        &self,
        entry: Entry,
        placement: Placement,
        index: usize,
        icon_theme: &str,
        experimental: &super::super::preference_types::Experimental,
        t: Theme,
    ) -> AnyElement {
        let label: SharedString = tr(entry.label_key()).into();
        let prefs = self.preferences.clone();
        let drop_prefs = self.preferences.clone();
        let menu_prefs = self.preferences.clone();
        let submenu = entry == Entry::CustomFiles;
        let unavailable = !submenu && !listed_available(entry, experimental);
        let drag_label = tf(
            "settings.createNew.dragToReorder",
            &[("type", label.to_string().into())],
        );
        let _ = prefs;
        // `.desktop-create-new-row`: `24px 20px 1fr auto`, 7px gaps, 34px.
        row()
            .id(SharedString::from(format!("create-new-{entry:?}")))
            .w_full()
            .min_w_0()
            .min_h(px(theme::control_large()))
            .gap(px(7.))
            .px(px(8.))
            .rounded(px(6.))
            .text_size(px(theme::ty().ui.label))
            .line_height(px(18.))
            .text_color(t.muted)
            .when(unavailable, |d| d.opacity(0.52))
            .hover(move |s| s.bg(t.hover))
            .drag_over::<DragEntry>(move |s, _, _, _| s.bg(theme::alpha(t.accent, 0.14)))
            .child(
                div()
                    .id(SharedString::from(format!("create-new-grip-{entry:?}")))
                    .size(px(24.))
                    .flex()
                    .items_center()
                    .justify_center()
                    .flex_shrink_0()
                    .rounded(px(5.))
                    .opacity(0.62)
                    .cursor_grab()
                    .hover(move |s| s.bg(t.hover).opacity(1.))
                    .tooltip(tooltip(drag_label))
                    .child(crate::ui::icon_stroke("grip-vertical", 14., 2., t.subtle))
                    .on_drag(DragEntry(entry, label.clone()), |drag, _, _, cx| {
                        let text = drag.1.clone();
                        cx.new(move |_| DragLabel(text))
                    }),
            )
            .child(glyph(entry, icon_theme, t.dark))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .truncate()
                    .text_color(t.text)
                    .child(label.clone()),
            )
            .when(submenu, |d| {
                d.child(
                    row()
                        .gap(px(5.))
                        .child(
                            div()
                                .px(px(7.))
                                .rounded_full()
                                .border_1()
                                .border_color(t.border_subtle)
                                .bg(t.control)
                                .text_size(px(theme::ty().ui.caption))
                                .line_height(px(19.))
                                .text_color(t.subtle)
                                .child(tr("settings.createNew.submenu.badge")),
                        )
                        .child(crate::ui::icon_stroke("chevron-right", 14., 2., t.muted)),
                )
            })
            .on_drop(move |drag: &DragEntry, _, cx| {
                let target = if submenu && drag.0 != Entry::CustomFiles {
                    (Placement::Submenu, usize::MAX)
                } else {
                    (placement, index)
                };
                drop_prefs.update(cx, |s, cx| {
                    s.change(
                        |s| {
                            let len = s.create_new.group(target.0).len();
                            s.create_new.move_entry(drag.0, target.0, target.1.min(len))
                        },
                        cx,
                    )
                })
            })
            .context_menu(move |mut menu, _, _| {
                for (place, key) in [
                    (Placement::Main, "settings.createNew.location.main"),
                    (Placement::Submenu, "settings.createNew.submenu.title"),
                    (Placement::Hidden, "settings.createNew.hidden.title"),
                ] {
                    let prefs = menu_prefs.clone();
                    menu = menu.item(
                        PopupMenuItem::new(tr(key))
                            .checked(place == placement)
                            .disabled(entry == Entry::CustomFiles && place != Placement::Main)
                            .on_click(move |_, _, cx| {
                                prefs.update(cx, |s, cx| {
                                    s.change(
                                        |s| {
                                            let len = s.create_new.group(place).len();
                                            s.create_new.move_entry(entry, place, len)
                                        },
                                        cx,
                                    )
                                })
                            }),
                    );
                }
                menu
            })
            .into_any_element()
    }
    fn drop_zone(
        &self,
        placement: Placement,
        end: usize,
        empty: Option<&'static str>,
        t: Theme,
    ) -> Stateful<Div> {
        let prefs = self.preferences.clone();
        // `.desktop-create-new-drop-zone`: a 6px strip inset 8px, or the
        // 38px empty-state line.
        div()
            .id(SharedString::from(format!("create-new-drop-{placement:?}")))
            .min_h(px(if empty.is_some() { 38. } else { 6. }))
            .flex()
            .items_center()
            .justify_center()
            .when(empty.is_some(), |d| d.px(px(10.)).py(px(5.)))
            .when(empty.is_none(), |d| d.mx(px(8.)))
            .rounded(px(5.))
            .text_size(px(theme::ty().ui.hint))
            .line_height(px(16.))
            .text_color(t.subtle)
            .drag_over::<DragEntry>(move |s, _, _, _| s.bg(theme::alpha(t.accent, 0.14)))
            .when_some(empty, |d, key| d.child(tr(key)))
            .on_drop(move |drag: &DragEntry, _, cx| {
                prefs.update(cx, |s, cx| {
                    s.change(|s| s.create_new.move_entry(drag.0, placement, end), cx)
                })
            })
    }
    pub(super) fn create_new(&self, t: Theme, cx: &mut Context<Self>) -> Div {
        let state = self.preferences.read(cx).state.clone();
        let experimental = state.experimental.clone();
        let settings = state.create_new.clone();
        let icon_theme = state.file_icon_theme.clone();
        let tree = |children: Vec<AnyElement>| {
            column()
                .w_full()
                .p(px(4.))
                .border_1()
                .border_color(t.border_subtle)
                .rounded(px(7.))
                .bg(t.panel)
                .children(children)
        };
        let mut main: Vec<AnyElement> = vec![
            // `.desktop-create-new-row-fixed`: a 20px lock marker at 58% in
            // the 24px handle column, the folder and its Fixed label.
            row()
                .min_h(px(theme::control_large()))
                .gap(px(7.))
                .px(px(8.))
                .text_size(px(theme::ty().ui.label))
                .line_height(px(18.))
                .text_color(t.subtle)
                .child(
                    div().w(px(24.)).flex_shrink_0().child(
                        div()
                            .size(px(20.))
                            .flex()
                            .items_center()
                            .justify_center()
                            .opacity(0.58)
                            .child(crate::ui::icon_stroke("lock-keyhole", 12., 2., t.subtle)),
                    ),
                )
                .child(glyph(Entry::Folder, &icon_theme, t.dark))
                .child(
                    div()
                        .flex_1()
                        .text_color(t.text)
                        .child(tr(Entry::Folder.label_key())),
                )
                .child(
                    div()
                        .px(px(7.))
                        .text_size(px(theme::ty().ui.caption))
                        .text_color(t.subtle)
                        .child(tr("settings.createNew.fixed")),
                )
                .into_any_element(),
            div()
                .h(px(1.))
                .mx(px(8.))
                .my(px(3.))
                .bg(t.divider)
                .into_any_element(),
        ];
        for (index, entry) in settings.main.iter().copied().enumerate() {
            main.push(self.create_row(
                entry,
                Placement::Main,
                index,
                &icon_theme,
                &experimental,
                t,
            ));
            if entry == Entry::CustomFiles {
                let mut children = column()
                    .ml(px(20.))
                    .mr(px(6.))
                    .mt(px(1.))
                    .mb(px(3.))
                    .py(px(3.))
                    .pl(px(9.))
                    .border_l_1()
                    .border_color(t.divider)
                    .rounded_r(px(5.))
                    .bg(theme::alpha(t.panel_raised, 0.34));
                for (child_index, child) in settings.submenu.iter().copied().enumerate() {
                    children = children.child(self.create_row(
                        child,
                        Placement::Submenu,
                        child_index,
                        &icon_theme,
                        &experimental,
                        t,
                    ));
                }
                children = children.child(
                    self.drop_zone(
                        Placement::Submenu,
                        settings.submenu.len(),
                        settings
                            .submenu
                            .is_empty()
                            .then_some("settings.createNew.submenu.empty"),
                        t,
                    ),
                );
                main.push(children.into_any_element());
            }
        }
        main.push(
            self.drop_zone(Placement::Main, settings.main.len(), None, t)
                .into_any_element(),
        );
        let mut hidden: Vec<AnyElement> = settings
            .hidden
            .iter()
            .copied()
            .enumerate()
            .map(|(i, e)| self.create_row(e, Placement::Hidden, i, &icon_theme, &experimental, t))
            .collect();
        hidden.push(
            self.drop_zone(
                Placement::Hidden,
                settings.hidden.len(),
                settings
                    .hidden
                    .is_empty()
                    .then_some("settings.createNew.hidden.empty"),
                t,
            )
            .into_any_element(),
        );
        let defaults = settings == MenuSettings::default();
        let restore = action_button(
            "restore-create-new",
            tr("settings.createNew.restoreDefaults"),
            Some("rotate-ccw"),
            Tone::Default,
            defaults,
            t,
        )
        .on_click(cx.listener(|s, _, _, cx| {
            s.preferences.update(cx, |p, cx| {
                p.change(|p| p.create_new = MenuSettings::default(), cx)
            })
        }));
        let _ = menu_icon;
        // `.desktop-settings-lead-categories`; the footer right-aligns Restore.
        section(tr(Page::CreateNew.title()), t).child(
            category_list(vec![
                category_body(tr("settings.createNew.location.main"), None, tree(main), t),
                category_body(tr("settings.createNew.hidden.title"), None, tree(hidden), t),
            ])
            .child(
                row()
                    .min_h(px(theme::control_large()))
                    .justify_end()
                    .child(restore),
            ),
        )
    }
}
struct DragLabel(SharedString);
impl Render for DragLabel {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let t = Theme::new(true);
        div()
            .px(px(10.))
            .py(px(6.))
            .rounded(px(6.))
            .bg(t.menu_bg)
            .text_color(t.text)
            .child(self.0.clone())
    }
}
