//! The left sidebar as its frame holds it (`DataWorkspaceFrame`'s
//! `explorer()` and `explorerFooter()`): the Explorer, embedded as a cached
//! view, and any companion on its bottom edge, over the footer navigation.
//! The pane stack places and moves the column; the column only stacks its
//! parts.
use super::{
    super::{explorer::Explorer, fill},
    footer::SidebarFooter,
};
use crate::{theme, ui::appearance::ActiveAppearance};
use gpui::{prelude::*, *};

#[derive(IntoElement)]
pub(in crate::app) struct ExplorerColumn {
    header: Option<AnyElement>,
    explorer: Entity<Explorer>,
    companion: Option<AnyElement>,
    footer: Option<SidebarFooter>,
}
impl ExplorerColumn {
    pub fn new(explorer: Entity<Explorer>) -> Self {
        Self {
            header: None,
            explorer,
            companion: None,
            footer: None,
        }
    }
    /// Top bar inside the column when the window runs without a Header.
    pub fn header(mut self, header: Option<AnyElement>) -> Self {
        self.header = header;
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
            .bg(cx.palette().sidebar)
            .flex()
            .flex_col()
            .when_some(self.header, |d, header| d.child(header))
            .child(div().flex_1().min_h_0().child(self.explorer.cached(fill())))
            .when_some(self.companion, |d, companion| {
                d.child(div().flex_shrink_0().child(companion))
            })
            .when(footer > 0., |d| {
                d.child(div().flex_shrink_0().h(px(footer)).children(self.footer))
            })
    }
}
