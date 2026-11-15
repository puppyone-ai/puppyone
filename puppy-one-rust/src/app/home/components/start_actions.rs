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

/// `OnboardingCreateProjectAction`: "New project", the default first-run path.
#[derive(IntoElement)]
pub(in crate::app::home) struct OnboardingCreateProjectAction {
    prominent: bool,
    busy: bool,
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
            on_click: Rc::new(on_click),
        }
    }
}

impl RenderOnce for OnboardingCreateProjectAction {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let on_click = self.on_click;
        Button::new("home-create-project")
            .variant(if self.prominent {
                ButtonVariant::PatternPrimary
            } else {
                ButtonVariant::Pattern
            })
            .icon(Icon::new("file-plus-2").small().stroke(1.85))
            .label(tr("onboarding.action.createLocalProject"))
            .accessibility_label(tr("onboarding.action.createLocalProject"))
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
    on_open_folder: ActionHandler,
    on_import: ActionHandler,
}

impl OnboardingEntryActions {
    pub fn new(
        busy: bool,
        dragging_folder: bool,
        on_open_folder: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
        on_import: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        Self {
            busy,
            dragging_folder,
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
                    .variant(ButtonVariant::Pattern)
                    .icon(Icon::new("download").small().stroke(1.85))
                    .label(tr("onboarding.action.importFromApps"))
                    .disabled(self.busy)
                    .flex_1()
                    .min_w_0()
                    .text_size(px(body))
                    .font_weight(FontWeight::NORMAL)
                    .trailing(project_entry::import_badges(t, t.canvas, self.busy))
                    .on_click(move |ev, w, cx| on_import(ev, w, cx)),
            )
    }
}

/// `OnboardingStartActions`: `New project` (`PatternDeep` filled key),
/// `Open a folder`, and `Import` in compact toolbar geometry (`28px` tall,
/// `10px` inline pad, `13px` medium) on the left of Projects Home's header.
#[derive(IntoElement)]
pub(in crate::app::home) struct OnboardingStartActions {
    busy: bool,
    on_create: ActionHandler,
    on_open_folder: ActionHandler,
    on_import: ActionHandler,
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
            on_create: Rc::new(on_create),
            on_open_folder: Rc::new(on_open_folder),
            on_import: Rc::new(on_import),
        }
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

        let create = Button::new("home-create-project")
            .variant(ButtonVariant::PatternDeep)
            .icon(Icon::new("file-plus-2").small().stroke(1.85))
            .label(tr("onboarding.action.createLocalProject"))
            .accessibility_label(tr("onboarding.action.createLocalProject"))
            .disabled(busy)
            .on_click(move |ev, w, cx| on_create(ev, w, cx));

        let open_folder = Button::new("home-open-folder")
            .variant(ButtonVariant::Ghost)
            .icon(Icon::product(ProductIcon::Folder).small().stroke(1.85))
            .label(tr("onboarding.action.openFolder"))
            .disabled(busy)
            .h(px(theme::control_compact()))
            .px(px(10.))
            .rounded(px(metric::CONTROL_RADIUS))
            .text_size(px(meta))
            .font_weight(FontWeight::MEDIUM)
            .when(busy, |b| {
                b.bg(t.control).text_color(t.text_disabled).opacity(1.)
            })
            .on_click(move |ev, w, cx| on_open(ev, w, cx));

        let import = Button::new("home-import")
            .variant(ButtonVariant::Ghost)
            .icon(Icon::new("download").small().stroke(1.85))
            .label(tr("onboarding.action.importFromApps"))
            .disabled(busy)
            .h(px(theme::control_compact()))
            .px(px(10.))
            .rounded(px(metric::CONTROL_RADIUS))
            .text_size(px(meta))
            .font_weight(FontWeight::MEDIUM)
            .when(busy, |b| {
                b.bg(t.control).text_color(t.text_disabled).opacity(1.)
            })
            .on_click(move |ev, w, cx| on_import(ev, w, cx));

        h_flex()
            .debug_selector(|| "home-start-actions".into())
            .flex_none()
            .items_center()
            .gap(px(6.))
            .child(create)
            .child(open_folder)
            .child(import)
    }
}
