//! The left sidebar as its frame holds it (`DataWorkspaceFrame`'s
//! `explorer()` and `explorerFooter()`): the Explorer, embedded as a cached
//! view, and any companion on its bottom edge, over the place and the
//! project (without the Header) and the footer navigation. The pane stack
//! places and moves the column; the column only stacks its parts.
use super::{
    super::{explorer::Explorer, fill},
    footer::SidebarFooter,
};
use crate::{
    theme::{self, metric},
    ui::appearance::ActiveAppearance,
};
use gpui::{prelude::*, *};

#[derive(IntoElement)]
pub(in crate::app) struct ExplorerColumn {
    explorer: Entity<Explorer>,
    companion: Option<AnyElement>,
    place: Option<AnyElement>,
    footer: Option<SidebarFooter>,
}
impl ExplorerColumn {
    pub fn new(explorer: Entity<Explorer>) -> Self {
        Self {
            explorer,
            companion: None,
            place: None,
            footer: None,
        }
    }
    /// Without the Header (experimental): the place and the project, a
    /// Header-tall row at the column's bottom.
    pub fn place(mut self, place: Option<impl IntoElement>) -> Self {
        self.place = place.map(IntoElement::into_any_element);
        self
    }
    /// Optional companion control standing on the bottom edge under the
    /// file tree, over the footer (e.g. Cloud Computer Screen).
    pub fn companion(mut self, companion: Option<AnyElement>) -> Self {
        self.companion = companion;
        self
    }
    /// The navigation below the tree. macOS has none: Settings and Help are
    /// in the app menu.
    pub fn footer(mut self, footer: SidebarFooter) -> Self {
        self.footer = Some(footer);
        self
    }
}
impl RenderOnce for ExplorerColumn {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let footer = theme::footer();
        div()
            .size_full()
            .flex()
            .flex_col()
            .child(div().flex_1().min_h_0().child(self.explorer.cached(fill())))
            .when_some(self.companion, |d, companion| {
                d.child(div().flex_shrink_0().child(companion))
            })
            .when_some(self.place, |d, place| {
                d.child(
                    div()
                        .flex_shrink_0()
                        .h(px(theme::HEADER))
                        .px(px(metric::SIDEBAR_ROW_LEFT_GAP))
                        .flex()
                        .items_center()
                        .min_w_0()
                        .bg(cx.palette().sidebar)
                        .child(place),
                )
            })
            .when(footer > 0., |d| {
                d.child(div().flex_shrink_0().h(px(footer)).children(self.footer))
            })
    }
}
