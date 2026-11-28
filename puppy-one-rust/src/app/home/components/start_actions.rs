//! `OnboardingStartActions`, `OnboardingCreateProjectAction`, and
//! `OnboardingEntryActions` (`OnboardingEntryActions.tsx`).
use super::super::project_entry;
use crate::{
    localization::t as tr,
    theme::{self, metric},
    ui::{
        appearance::ActiveAppearance as _,
        components::{Button, ButtonVariant, Icon, ProductIcon},
    },
};
use gpui::{prelude::*, *};
use gpui_kit::{
    base::{Disableable as _, h_flex},
    component::Sizable as _,
};
use std::rc::Rc;

type ActionHandler = Rc<dyn Fn(&ClickEvent, &mut Window, &mut App)>;

/// `New project`, or in Computer Mode `New computer` with a monitor.
pub(in crate::app::home) fn create_action(computer_mode: bool) -> (&'static str, &'static str) {
    if computer_mode {
        ("monitor", "onboarding.computerMode.createAction")
    } else {
        ("file-plus-2", "onboarding.action.createLocalProject")
    }
}

/// `OnboardingCreateProjectAction`: "New project", the default first-run path.
#[derive(IntoElement)]
pub(in crate::app::home) struct OnboardingCreateProjectAction {
    prominent: bool,
    busy: bool,
    computer_mode: bool,
    on_click: ActionHandler,
}

impl OnboardingCreateProjectAction {
    pub fn new(
        prominent: bool,
        busy: bool,
        on_click: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        Self {
            prominent,
            busy,
            computer_mode: false,
            on_click: Rc::new(on_click),
        }
    }
    pub fn computer_mode(mut self, on: bool) -> Self {
        self.computer_mode = on;
        self
    }
}

impl RenderOnce for OnboardingCreateProjectAction {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let on_click = self.on_click;
        let (icon, label) = create_action(self.computer_mode);
        Button::new("home-create-project")
            .variant(if self.prominent {
                ButtonVariant::PatternPrimary
            } else {
                ButtonVariant::Pattern
            })
            .icon(Icon::new(icon).small().stroke(1.85))
            .label(tr(label))
            .accessibility_label(tr(label))
            .disabled(self.busy)
            .w_full()
            .text_size(px(theme::ty().ui.body))
            .font_weight(FontWeight::NORMAL)
            .on_click(move |ev, w, cx| on_click(ev, w, cx))
    }
}

/// `OnboardingEntryActions`: first-run `Open a folder` and `Import` (with
/// source brand badges) side by side under `New project`.
#[derive(IntoElement)]
pub(in crate::app::home) struct OnboardingEntryActions {
    busy: bool,
    dragging_folder: bool,
    other_apps: bool,
    on_open_folder: ActionHandler,
    on_import: ActionHandler,
}

impl OnboardingEntryActions {
    pub fn new(
        busy: bool,
        dragging_folder: bool,
        other_apps: bool,
        on_open_folder: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
        on_import: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        Self {
            busy,
            dragging_folder,
            other_apps,
            on_open_folder: Rc::new(on_open_folder),
            on_import: Rc::new(on_import),
        }
    }
}

impl RenderOnce for OnboardingEntryActions {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.palette();
        let body = theme::ty().ui.body;
        let on_open = self.on_open_folder;
        let on_import = self.on_import;
        h_flex()
            .w_full()
            .gap(px(8.))
            .pb(px(18.))
            .child(
                Button::new("home-open-folder")
                    .variant(ButtonVariant::Pattern)
                    .icon(Icon::product(ProductIcon::Folder).small().stroke(1.85))
                    .label(tr("onboarding.action.openFolder"))
                    .disabled(self.busy)
                    .flex_1()
                    .min_w_0()
                    .text_size(px(body))
                    .font_weight(FontWeight::NORMAL)
                    .when(self.dragging_folder, |b| b.bg(t.control_hover))
                    .on_click(move |ev, w, cx| on_open(ev, w, cx)),
            )
            .child(
                Button::new("home-import")
                    .debug_selector(|| "home-import".to_owned())
                    .variant(ButtonVariant::Pattern)
                    .leading(
                        div()
                            .debug_selector(|| "home-import-icon".to_owned())
                            .flex()
                            .items_center()
                            .child(Icon::new("download").small().stroke(1.85)),
                    )
                    .accessibility_label(tr("onboarding.action.importFromApps"))
                    .disabled(self.busy)
                    .flex_1()
                    .min_w_0()
                    .text_size(px(body))
                    .font_weight(FontWeight::NORMAL)
                    .trailing(
                        h_flex()
                            .gap(px(6.))
                            .min_w_0()
                            .child(
                                div()
                                    .debug_selector(|| "home-import-label".to_owned())
                                    .min_w_0()
                                    .truncate()
                                    .child(tr("onboarding.action.importFromApps")),
                            )
                            .child(project_entry::import_badges(
                                t,
                                t.canvas,
                                self.busy,
                                self.other_apps,
                            )),
                    )
                    .on_click(move |ev, w, cx| on_import(ev, w, cx)),
            )
    }
}

/// `OnboardingStartActions`: `New project` (`PatternDeep` filled key, split
/// with the menu of Agents that can start one), `Open a folder`, and `Import`
/// in compact toolbar geometry (`28px` tall, `10px` inline pad, `13px`
/// medium) at the start of Projects Home's toolbar.
#[derive(IntoElement)]
pub(in crate::app::home) struct OnboardingStartActions {
    busy: bool,
    computer_mode: bool,
    on_create: ActionHandler,
    on_open_folder: ActionHandler,
    on_import: ActionHandler,
    agents_menu: Option<AnyElement>,
}

impl OnboardingStartActions {
    pub fn new(
        busy: bool,
        on_create: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
        on_open_folder: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
        on_import: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        Self {
            busy,
            computer_mode: false,
            on_create: Rc::new(on_create),
            on_open_folder: Rc::new(on_open_folder),
            on_import: Rc::new(on_import),
            agents_menu: None,
        }
    }

    /// The second half of `New project`: its own trigger and menu, square
    /// where the two halves meet.
    pub fn agents_menu(mut self, menu: impl IntoElement) -> Self {
        self.agents_menu = Some(menu.into_any_element());
        self
    }
    pub fn computer_mode(mut self, on: bool) -> Self {
        self.computer_mode = on;
        self
    }
}

impl RenderOnce for OnboardingStartActions {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.palette();
        let meta = theme::ty().ui.meta;
        let busy = self.busy;
        let on_create = self.on_create;
        let on_open = self.on_open_folder;
        let on_import = self.on_import;
        let split = self.agents_menu.is_some();
        let (icon, label) = create_action(self.computer_mode);
        let create = Button::new("home-create-project")
            .variant(ButtonVariant::PatternDeep)
            .icon(Icon::new(icon).small().stroke(1.85))
            .label(tr(label))
            .accessibility_label(tr(label))
            .disabled(busy)
            .when(split, |b| b.rounded_r(px(0.)))
            .on_click(move |ev, w, cx| on_create(ev, w, cx));

        let quiet = |id: &'static str, icon: Icon, label: &'static str| {
            Button::new(id)
                .variant(ButtonVariant::Ghost)
                .icon(icon)
                .label(label)
                .disabled(busy)
                .h(px(theme::control_compact()))
                .px(px(10.))
                .rounded(px(metric::CONTROL_RADIUS))
                .text_size(px(meta))
                .font_weight(FontWeight::MEDIUM)
                .when(busy, |b| {
                    b.bg(t.control).text_color(t.text_disabled).opacity(1.)
                })
        };
        let open_folder = quiet(
            "home-open-folder",
            Icon::product(ProductIcon::Folder).small().stroke(1.85),
            tr("onboarding.action.openFolder"),
        )
        .on_click(move |ev, w, cx| on_open(ev, w, cx));
        let import = quiet(
            "home-import",
            Icon::new("download").small().stroke(1.85),
            tr("onboarding.action.importFromApps"),
        )
        .on_click(move |ev, w, cx| on_import(ev, w, cx));

        h_flex()
            .debug_selector(|| "home-start-actions".into())
            .flex_none()
            .items_center()
            .gap(px(6.))
            .child(
                h_flex()
                    .flex_none()
                    .items_center()
                    .gap(px(1.))
                    .child(create)
                    .children(self.agents_menu),
            )
            .child(open_folder)
            .child(import)
    }
}
