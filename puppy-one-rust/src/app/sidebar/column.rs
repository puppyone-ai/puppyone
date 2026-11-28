//! The left sidebar as its frame holds it (`DataWorkspaceFrame`'s
//! `explorer()` and `explorerFooter()`): the Explorer, embedded as a cached
//! view, over the footer navigation. Only files live here: a hosted
//! project's computer is a workspace tool in the Header.
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
    footer: Option<SidebarFooter>,
}
impl ExplorerColumn {
    pub fn new(explorer: Entity<Explorer>) -> Self {
        Self {
            header: None,
            explorer,
            footer: None,
        }
    }
    /// Top bar inside the column when the window runs without a Header.
    pub fn header(mut self, header: Option<AnyElement>) -> Self {
        self.header = header;
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
            .child(
                div()
                    .relative()
                    .flex_1()
                    .min_h_0()
                    .child(self.explorer.cached(fill()))
                    .when_some(self.header, |d, header| {
                        d.child(
                            div()
                                .absolute()
                                .top_0()
                                .left_0()
                                .occlude()
                                .cursor(CursorStyle::Arrow)
                                .child(header),
                        )
                    }),
            )
            .when(footer > 0., |d| {
                d.child(div().flex_shrink_0().h(px(footer)).children(self.footer))
            })
    }
}
