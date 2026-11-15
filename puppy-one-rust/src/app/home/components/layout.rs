//! `OnboardingHomeLayout`, `OnboardingBrandLockup`, `OnboardingErrorBanner`,
//! and `OnboardingTelemetryDisclosure` (`OnboardingHomeLayout.tsx`,
//! `OnboardingBrandLockup.tsx`, and `styles/onboarding.css`).
use super::super::projects::ProjectDrag;
use crate::{
    app::at,
    geometry::Rect,
    localization::t as tr,
    theme::{self, metric},
    ui::{appearance::ActiveAppearance as _, components::Icon},
};
use gpui::{prelude::*, *};
use gpui_kit::{
    base::{h_flex, v_flex},
    component::Sizable as _,
};
use std::{path::PathBuf, rc::Rc};

/// `.onboarding-shell[data-onboarding-state="projects"] .onboarding-homepage`:
/// `width: min(760px, 100%)` for five Finder-proportioned folders across;
/// first run's picture and column share `min(900px, 100%)`.
const PAGE_WIDTH_PROJECTS: f32 = 760.;
const PAGE_WIDTH_EMPTY: f32 = 900.;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::app::home) enum OnboardingHomeState {
    Empty,
    Projects,
}

impl OnboardingHomeState {
    /// `.onboarding-homepage-shell[data-onboarding-state="projects"]`:
    /// `padding-inline: 40px` above `820px`, `28px` (`UTILITY_PADDING_INLINE`) otherwise.
    pub fn inline_padding(self, viewport_w: f32) -> f32 {
        if self == Self::Projects && viewport_w > 820. {
            40.
        } else {
            metric::UTILITY_PADDING_INLINE
        }
    }

    pub fn page_width(self, viewport_w: f32) -> f32 {
        let pad = self.inline_padding(viewport_w);
        let max_w = match self {
            Self::Projects => PAGE_WIDTH_PROJECTS,
            Self::Empty => PAGE_WIDTH_EMPTY,
        };
        max_w.min(viewport_w - pad * 2.).max(0.)
    }
}

/// `OnboardingBrandLockup`: on Projects Home, one non-wrapping toolbar with
/// `OnboardingStartActions` at its start and how the projects are shown at its
/// end; on first run, the active value moment's title and pitch.
#[derive(IntoElement)]
pub(in crate::app::home) struct OnboardingBrandLockup {
    state: OnboardingHomeState,
    leading: Option<AnyElement>,
    trailing: Option<AnyElement>,
}

impl OnboardingBrandLockup {
    pub fn projects(toolbar: impl IntoElement, trailing: Option<impl IntoElement>) -> Self {
        Self {
            state: OnboardingHomeState::Projects,
            leading: Some(toolbar.into_any_element()),
            trailing: trailing.map(IntoElement::into_any_element),
        }
    }

    pub fn empty(moment_copy: impl IntoElement) -> Self {
        Self {
            state: OnboardingHomeState::Empty,
            leading: Some(moment_copy.into_any_element()),
            trailing: None,
        }
    }
}

impl RenderOnce for OnboardingBrandLockup {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        match self.state {
            OnboardingHomeState::Projects => h_flex()
                .debug_selector(|| "home-header-row".into())
                .flex_none()
                .w_full()
                .min_w_0()
                .items_center()
                .justify_between()
                .gap(px(12.))
                .mb(px(18.))
                .children(self.leading)
                .children(self.trailing)
                .into_any_element(),
            OnboardingHomeState::Empty => v_flex()
                .flex_none()
                .w_full()
                .mb(px(28.))
                .children(self.leading)
                .children(self.trailing)
                .into_any_element(),
        }
    }
}

/// `.onboarding-error.onboarding-homepage-error`: why a drop or opening failed.
#[derive(IntoElement)]
pub(in crate::app::home) struct OnboardingErrorBanner {
    width: f32,
    message: SharedString,
}

impl OnboardingErrorBanner {
    pub fn new(width: f32, message: impl Into<SharedString>) -> Self {
        Self {
            width,
            message: message.into(),
        }
    }
}

impl RenderOnce for OnboardingErrorBanner {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.palette();
        h_flex()
            .flex_none()
            .w(px(self.width))
            .items_start()
            .gap(px(8.))
            .py(px(9.))
            .px(px(10.))
            .rounded(px(8.))
            .border_1()
            .border_color(theme::mix(t.danger, t.border_subtle, 0.18))
            .bg(theme::alpha(t.danger, 0.06))
            .text_color(t.danger)
            .text_size(px(theme::ty().ui.body))
            .line_height(relative(1.4))
            .child(Icon::new("triangle-alert").with_size(px(15.)).mt(px(1.)))
            .child(div().min_w_0().child(self.message))
    }
}

/// `.onboarding-telemetry-disclosure`: one caption line in the bottom-end
/// corner, with the Learn More link underlined at 45%.
#[derive(IntoElement)]
pub(in crate::app::home) struct OnboardingTelemetryDisclosure {
    viewport_w: f32,
}

impl OnboardingTelemetryDisclosure {
    pub fn new(viewport_w: f32) -> Self {
        Self { viewport_w }
    }
}

impl RenderOnce for OnboardingTelemetryDisclosure {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.palette();
        let (end, bottom) = if self.viewport_w <= 700. {
            (16., 12.)
        } else {
            (24., 16.)
        };
        h_flex()
            .debug_selector(|| "onboarding-telemetry-disclosure".into())
            .absolute()
            .right(px(end))
            .bottom(px(bottom))
            .max_w(px(self.viewport_w - end * 2.))
            .flex_wrap()
            .text_size(px(theme::ty().ui.caption))
            .line_height(px(15.))
            .text_color(t.subtle)
            .child(format!("{} ", tr("onboarding.telemetry.notice")))
            .child(
                div()
                    .id("onboarding-telemetry-learn-more")
                    .underline()
                    .text_decoration_color(theme::alpha(t.subtle, 0.45))
                    .cursor(theme::clickable_cursor())
                    .hover(move |s| s.text_color(t.muted).text_decoration_color(t.muted))
                    .on_click(|_, _, cx| cx.open_url(crate::platform::telemetry::DISCLOSURE_URL))
                    .child(tr("onboarding.telemetry.learnMore")),
            )
    }
}

type ProjectDragMoveHandler = Rc<dyn Fn(&DragMoveEvent<ProjectDrag>, &mut Window, &mut App)>;
type WindowActionHandler = Rc<dyn Fn(&mut Window, &mut App)>;
type FolderDropHandler = Rc<dyn Fn(&[PathBuf], &mut Window, &mut App)>;

/// Outer `.onboarding-homepage-shell` + `.onboarding-homepage` surface shared
/// by empty first-run and returning-user Projects Home.
#[derive(IntoElement)]
pub(in crate::app::home) struct OnboardingHomeLayout {
    state: OnboardingHomeState,
    viewport_w: f32,
    viewport_h: f32,
    error_width: f32,
    body: AnyElement,
    error: Option<SharedString>,
    intro_opacity: Option<f32>,
    show_telemetry_disclosure: bool,
    on_project_drag_move: Option<ProjectDragMoveHandler>,
    on_external_drag_enter: Option<WindowActionHandler>,
    on_external_drop: Option<FolderDropHandler>,
    on_external_drag_leave: Option<WindowActionHandler>,
}

impl OnboardingHomeLayout {
    pub fn new(
        state: OnboardingHomeState,
        viewport_w: f32,
        viewport_h: f32,
        error_width: f32,
        body: impl IntoElement,
    ) -> Self {
        Self {
            state,
            viewport_w,
            viewport_h,
            error_width,
            body: body.into_any_element(),
            error: None,
            intro_opacity: None,
            show_telemetry_disclosure: false,
            on_project_drag_move: None,
            on_external_drag_enter: None,
            on_external_drop: None,
            on_external_drag_leave: None,
        }
    }

    pub fn error(mut self, error: Option<String>) -> Self {
        self.error = error.map(SharedString::from);
        self
    }

    pub fn intro_opacity(mut self, opacity: Option<f32>) -> Self {
        self.intro_opacity = opacity;
        self
    }

    pub fn show_telemetry_disclosure(mut self, show: bool) -> Self {
        self.show_telemetry_disclosure = show;
        self
    }

    pub fn on_project_drag_move(
        mut self,
        handler: impl Fn(&DragMoveEvent<ProjectDrag>, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_project_drag_move = Some(Rc::new(handler));
        self
    }

    pub fn on_external_drag(
        mut self,
        on_enter: impl Fn(&mut Window, &mut App) + 'static,
        on_drop: impl Fn(&[PathBuf], &mut Window, &mut App) + 'static,
        on_leave: impl Fn(&mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_external_drag_enter = Some(Rc::new(on_enter));
        self.on_external_drop = Some(Rc::new(on_drop));
        self.on_external_drag_leave = Some(Rc::new(on_leave));
        self
    }
}

impl RenderOnce for OnboardingHomeLayout {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.palette();
        let has_projects = self.state == OnboardingHomeState::Projects;
        let pad = self.state.inline_padding(self.viewport_w);
        let page_w = self.state.page_width(self.viewport_w);
        let error = self
            .error
            .map(|msg| OnboardingErrorBanner::new(self.error_width.min(page_w), msg));

        let page = v_flex()
            .w(px(page_w))
            .when(has_projects, |d| d.h_full())
            .items_center()
            .gap(px(30.))
            .child(self.body)
            .children(error)
            .when_some(self.intro_opacity, |d, opacity| d.opacity(opacity));

        at(Rect::new(0., 0., self.viewport_w, self.viewport_h))
            .id("homepage")
            .bg(t.canvas)
            .flex()
            .flex_col()
            .items_center()
            .when(has_projects, |d| {
                d.justify_start().pt(px(metric::CHROME_HEIGHT + 24.))
            })
            .when(!has_projects, |d| d.justify_center().py(px(48.)))
            .px(px(pad))
            .child(page)
            .when_some(self.on_project_drag_move, |d, handler| {
                d.on_drag_move::<ProjectDrag>(move |event, window, cx| handler(event, window, cx))
            })
            .when_some(self.on_external_drag_enter, |d, handler| {
                d.on_drag_move::<ExternalPaths>(move |_, window, cx| handler(window, cx))
            })
            .when_some(self.on_external_drop, |d, handler| {
                d.on_drop(move |paths: &ExternalPaths, window, cx| {
                    handler(paths.paths(), window, cx)
                })
            })
            .when_some(self.on_external_drag_leave, |d, handler| {
                d.on_hover(move |hovered, window, cx| {
                    if !*hovered {
                        handler(window, cx);
                    }
                })
            })
            .when(!has_projects && self.show_telemetry_disclosure, |d| {
                d.child(OnboardingTelemetryDisclosure::new(self.viewport_w))
            })
    }
}
