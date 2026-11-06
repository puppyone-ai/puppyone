//! The left sidebar as its frame holds it (`DataWorkspaceFrame`'s
//! `explorer()` and `explorerFooter()`): the Explorer, embedded as a cached
//! view, over the footer navigation. The pane stack places and moves the
//! column; the column only stacks its two parts.
use super::{explorer::Explorer, fill, footer::SidebarFooter};
use crate::theme;
use gpui::{prelude::*, *};

#[derive(IntoElement)]
pub(super) struct ExplorerColumn {
    explorer: Entity<Explorer>,
    footer: Option<SidebarFooter>,
}
impl ExplorerColumn {
    pub fn new(explorer: Entity<Explorer>) -> Self {
        Self {
            explorer,
            footer: None,
        }
    }
    /// The navigation below the tree. macOS has none: Settings and Help are
    /// in the app menu.
    pub fn footer(mut self, footer: SidebarFooter) -> Self {
        self.footer = Some(footer);
        self
    }
}
impl RenderOnce for ExplorerColumn {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let footer = theme::footer();
        div()
            .size_full()
            .flex()
            .flex_col()
            .child(div().flex_1().min_h_0().child(self.explorer.cached(fill())))
            .when(footer > 0., |d| {
                d.child(div().flex_shrink_0().h(px(footer)).children(self.footer))
            })
    }
}
