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
    ui::{appearance::ActiveAppearance, scroll_edge},
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

    /// Active document's icon and name in the headerless editor top bar,
    /// matching `FileWindow::file_title`'s quiet theme style. Hidden while
    /// opening a project, showing the Cloud Computer screen, or showing
    /// header editor tabs.
    fn document_title(&self, left_pad: f32, cx: &App) -> Option<AnyElement> {
        if self.session.opening || self.owners.cloud.read(cx).screen_shown(cx) {
            return None;
        }
        let (_, relative) = self.owners.docs.read(cx).opened()?;
        let name = relative
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| relative.to_string_lossy().into_owned());
        if name.is_empty() {
            return None;
        }
        let full = relative.to_string_lossy().into_owned();
        let t = cx.palette();
        let ty = theme::ty().header;
        let conventions = crate::platform::conventions::Conventions::current();
        Some(
            h_flex()
                .id("header-document-title")
                .debug_selector(|| "header-document-title".into())
                .window_control_area(WindowControlArea::Drag)
                .cursor(CursorStyle::Arrow)
                .h_full()
                .min_w_0()
                .flex_shrink(1.)
                .pl(px(left_pad))
                .pr(px(6.))
                .text_color(t.muted)
                .text_size(px(ty.content))
                .line_height(px(ty.line_height))
                .when(!conventions.native_nonclient_window_controls, |d| {
                    d.on_mouse_down(MouseButton::Left, |e, window, _| {
                        if e.click_count == 2 {
                            window.zoom_window();
                        } else {
                            window.start_window_move();
                        }
                    })
                    .on_mouse_down(MouseButton::Right, |e, window, _| {
                        window.show_window_menu(e.position);
                    })
                })
                .when(full != name, |d| {
                    d.tooltip(crate::ui::components::tooltip(full))
                })
                .child(
                    div()
                        .id("header-document-name")
                        .debug_selector(|| "header-document-name".into())
                        .min_w_0()
                        .truncate()
                        .child(name),
                )
                .into_any_element(),
        )
    }

    /// The main pane's top 40px bar when the window has no Header: leading
    /// controls while the Explorer is collapsed (`leading`), active document
    /// name (or optional editor tabs), window-drag space, project actions, and
    /// trailing window caption buttons while the right sidebar is closed
    /// (`captions`).
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
        let doc_title = (!with_tabs)
            .then(|| self.document_title(if leading { 6. } else { 14. }, cx))
            .flatten();
        let (leading_doc, editor_doc) = if leading {
            (doc_title, None)
        } else {
            (None, doc_title)
        };
        let actions = self.project_actions(cx);
        let menu = (leading && rail == 0.)
            .then(|| app_menu::render(cx))
            .flatten();
        let t = cx.palette();
        let ty = theme::ty().header;
        let shows_project = self.shows_project();
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
                        .flex_shrink(1.)
                        .pl(px(title_bar::leading_inset(rail)))
                        .gap(px(2.))
                        .children(menu)
                        .child(self.expand_explorer())
                        .when(shows_project, |d| {
                            d.child(self.project_context(self.rail, true, cx))
                        })
                        .when_some(leading_doc, |d, title| {
                            d.when(shows_project, |d| {
                                d.child(
                                    div()
                                        .flex_none()
                                        .text_size(px(ty.content))
                                        .line_height(px(ty.line_height))
                                        .text_color(t.text_disabled)
                                        .child("/"),
                                )
                            })
                            .child(title)
                        }),
                )
            })
            .when_some(editor_doc, |d, title| d.child(title))
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

    /// The main pane without a Header: `content` runs full-height from
    /// `y = 0` so documents scroll seamlessly underneath a bottom-transparent
    /// gradient scrim and floating transparent 40px top bar. (Cloud Computer
    /// screen sits below 40px since its own toolbar occupies the top edge.)
    pub(in crate::app) fn main_pane(
        self,
        leading: bool,
        content: AnyElement,
        front: Option<Entity<DocumentEditor>>,
        window: &Window,
        cx: &App,
    ) -> AnyElement {
        let is_cloud_screen = front.is_none();
        let scrim = front.map(|front| header_scrim(front, cx));
        let body = if is_cloud_screen {
            div().size_full().pt(px(theme::HEADER)).child(content)
        } else {
            div().size_full().child(content)
        };
        div()
            .relative()
            .size_full()
            .bg(cx.palette().canvas)
            .child(body)
            .children(scrim)
            .child(
                div()
                    .absolute()
                    .top_0()
                    .left_0()
                    .right_0()
                    .h(px(theme::HEADER))
                    .occlude()
                    .cursor(CursorStyle::Arrow)
                    .child(self.chrome.read(cx).main_bar(
                        leading,
                        !self.end_open,
                        self.rail,
                        window,
                        cx,
                    )),
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

/// Smooth top-to-bottom floating header scrim over the document: completely
/// transparent at the bottom (`y = 64px`), easing upward into `canvas` toward
/// the top edge so scrolled text melts softly behind the floating controls.
/// Skipped over pinned table headers (e.g. CSV), which already own `y = 40`.
fn header_scrim(front: Entity<DocumentEditor>, cx: &App) -> impl IntoElement {
    let canvas_ground = cx.palette().canvas;
    let height = scroll_edge::FLOATING_HEADER_SCRIM;
    gpui::canvas(
        |_, _, _| {},
        move |bounds, _, window, cx| {
            let (_, pinned) = front.read(cx).scroll_state(cx);
            if !pinned {
                scroll_edge::paint_header_scrim(window, bounds, canvas_ground);
            }
        },
    )
    .absolute()
    .left_0()
    .right_0()
    .top_0()
    .h(px(height))
}
