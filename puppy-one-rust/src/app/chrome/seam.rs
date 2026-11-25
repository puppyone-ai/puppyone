//! Without the Header (experimental): the window has no Header strip at all
//! (`layout.header.h == 0`). Every pane and its resize edge runs from the
//! window's top (`y = 0`) to its bottom, and each pane holds its own top
//! controls:
//! - Explorer column: leading controls (`collapse-explorer`, place, project)
//!   and sidebar window-drag area.
//! - Main pane: leading controls when the Explorer is collapsed, optional
//!   editor tabs, window-drag area, project actions, and trailing caption
//!   buttons when no right sidebar is open — over the document with a top
//!   scroll-edge fade.
//! - Right sidebar: its surface runs straight from `y = 0` on macOS, or sits
//!   below a 40px drag + caption strip on Windows / Linux CSD.
use super::{
    WindowChrome,
    window_frame::{app_menu, title_bar, window_controls},
};
use crate::{
    app::{
        panes::{PaneFrames, PaneLayout},
        right_sidebar::RightSidebar,
    },
    editor::host::DocumentEditor,
    geometry::Rect,
    theme::{self, metric},
    ui::{
        appearance::ActiveAppearance,
        scroll_edge::{self, Edge},
    },
};
use gpui::{prelude::*, *};
use gpui_kit::base::{h_flex, v_flex};

impl WindowChrome {
    /// The Explorer column's top 40px bar when the window has no Header:
    /// native leading inset, optional in-window app menu, compact place /
    /// project switchers, and remaining drag space. No collapse toggle while
    /// open; sized to the Explorer's visible `width`.
    pub(in crate::app) fn sidebar_bar(&self, width: f32, rail: f32, cx: &App) -> AnyElement {
        let menu = (rail == 0.).then(|| app_menu::render(cx)).flatten();
        h_flex()
            .h(px(theme::HEADER))
            .w(px(width))
            .flex_shrink_0()
            .overflow_hidden()
            .items_center()
            .pl(px(title_bar::leading_inset(rail)))
            .pr(px(metric::TITLEBAR_CONTENT_END))
            .gap(px(2.))
            .children(menu)
            .when(self.shows_project(), |d| {
                d.child(self.project_context(self.rail, true, cx))
            })
            .child(
                title_bar::drag_area("header-drag-sidebar")
                    .flex_1()
                    .min_w_0(),
            )
            .into_any_element()
    }

    /// The main pane's top 40px bar when the window has no Header: leading
    /// controls while the Explorer is collapsed (`leading`), optional editor
    /// tabs, window-drag space, project actions, and trailing window caption
    /// buttons while the right sidebar is closed (`captions`).
    pub(in crate::app) fn main_bar(
        &self,
        leading: bool,
        captions: bool,
        rail: f32,
        window: &Window,
        cx: &App,
    ) -> AnyElement {
        let trailing_controls = captions
            .then(|| window_controls::render(window, cx))
            .flatten();
        let has_trailing_controls = trailing_controls.is_some();
        let tabs = self.project_tabs(cx);
        let with_tabs = tabs.is_some();
        let actions = self.project_actions(cx);
        let menu = (leading && rail == 0.)
            .then(|| app_menu::render(cx))
            .flatten();
        let drag = title_bar::drag_area("header-drag")
            .when(!with_tabs, |d| d.flex_1())
            .when(with_tabs, |d| {
                d.w(px(metric::TITLEBAR_DRAG_MIN_WIDTH)).flex_shrink_0()
            })
            .min_w(px(metric::TITLEBAR_DRAG_MIN_WIDTH));
        h_flex()
            .h(px(theme::HEADER))
            .w_full()
            .flex_shrink_0()
            .items_center()
            .when(leading, |d| {
                d.child(
                    h_flex()
                        .h_full()
                        .min_w_0()
                        .pl(px(title_bar::leading_inset(rail)))
                        .gap(px(2.))
                        .children(menu)
                        .child(self.expand_explorer())
                        .when(self.shows_project(), |d| {
                            d.child(self.project_context(self.rail, true, cx))
                        }),
                )
            })
            .when_some(tabs, |d, tabs| {
                d.child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .h_full()
                        .when(!leading, |d| d.pl(px(metric::TITLEBAR_CONTENT_END)))
                        .child(tabs),
                )
            })
            .child(drag)
            .child(
                h_flex()
                    .h_full()
                    .gap(px(2.))
                    .pr(px(if has_trailing_controls {
                        metric::TITLEBAR_CAPTION_ACTIONS_GAP
                    } else {
                        metric::TITLEBAR_CONTENT_END
                    }))
                    .children(actions),
            )
            .children(trailing_controls)
            .into_any_element()
    }
}

/// Per-frame pane chrome context when a project window runs without a Header.
#[derive(Clone, Copy)]
pub(in crate::app) struct PaneChrome<'a> {
    pub chrome: &'a Entity<WindowChrome>,
    pub panes: &'a Entity<PaneLayout>,
    pub start: Option<Rect>,
    pub end_open: bool,
    pub rail: f32,
}

impl<'a> PaneChrome<'a> {
    pub(in crate::app) fn new(
        chrome: &'a Entity<WindowChrome>,
        panes: &'a Entity<PaneLayout>,
        frames: &PaneFrames,
        rail: f32,
    ) -> Self {
        Self {
            chrome,
            panes,
            start: frames.start,
            end_open: frames.end.is_some(),
            rail,
        }
    }

    /// The Explorer column's top bar: sized to the visible frame width while
    /// open so narrowing drags shrink the place live, and held at the plane
    /// width while sliding closed.
    pub(in crate::app) fn sidebar_bar(self, plane: Rect, cx: &App) -> AnyElement {
        let visible = if self.panes.read(cx).explorer().open {
            self.start.map_or(plane.w, |r| r.w)
        } else {
            plane.w
        };
        self.chrome.read(cx).sidebar_bar(visible, self.rail, cx)
    }

    /// The main pane without a Header: its 40px top bar over `content`, with
    /// the scrolled document fading smoothly into the canvas ground at the
    /// boundary.
    pub(in crate::app) fn main_pane(
        self,
        leading: bool,
        content: AnyElement,
        front: Option<Entity<DocumentEditor>>,
        window: &Window,
        cx: &App,
    ) -> AnyElement {
        let fade = front.map(|front| document_fade(front, cx));
        v_flex()
            .size_full()
            .bg(cx.palette().canvas)
            .child(
                self.chrome
                    .read(cx)
                    .main_bar(leading, !self.end_open, self.rail, window, cx),
            )
            .child(
                div()
                    .relative()
                    .flex_1()
                    .min_h_0()
                    .child(content)
                    .children(fade),
            )
            .into_any_element()
    }

    /// The right sidebar pane without a Header: straight from `y = 0` on
    /// macOS, or below a 40px drag + window-caption bar on Windows / Linux CSD
    /// so caption controls never overlap sidebar actions.
    pub(in crate::app) fn end_pane(
        self,
        sidebar: Entity<RightSidebar>,
        window: &Window,
        cx: &App,
    ) -> AnyElement {
        let Some(controls) = window_controls::render(window, cx) else {
            return sidebar.into_any_element();
        };
        v_flex()
            .size_full()
            .bg(cx.palette().auxiliary())
            .child(
                h_flex()
                    .h(px(theme::HEADER))
                    .w_full()
                    .flex_shrink_0()
                    .child(title_bar::drag_area("header-drag-end").flex_1().min_w_0())
                    .child(controls),
            )
            .child(div().flex_1().min_h_0().child(sidebar))
            .into_any_element()
    }
}

/// The content region of the main pane below its 40px top bar when running
/// without a Header (where notices and the Cloud Computer screen's stage sit).
pub(in crate::app) fn editor_body(editor: Rect, headerless: bool) -> Rect {
    if !headerless {
        return editor;
    }
    Rect::new(
        editor.x,
        editor.y + theme::HEADER,
        editor.w,
        (editor.h - theme::HEADER).max(0.),
    )
}

/// The front document scrolled up under the main pane's tools fades into the
/// canvas ground instead of being cut off; never a pinned table header row,
/// which is the edge already. Read at paint time so it follows every frame.
fn document_fade(front: Entity<DocumentEditor>, cx: &App) -> impl IntoElement {
    let canvas_ground = cx.palette().canvas;
    let height = metric::DOCUMENT_TOP_FADE;
    gpui::canvas(
        |_, _, _| {},
        move |bounds, _, window, cx| {
            let (scroll, pinned) = front.read(cx).scroll_state(cx);
            let strength = if pinned {
                0.
            } else {
                scroll_edge::strength(scroll)
            };
            scroll_edge::paint(window, bounds, Edge::Top, canvas_ground, height, strength);
        },
    )
    .absolute()
    .left_0()
    .right_0()
    .top_0()
    .h(px(height))
}
