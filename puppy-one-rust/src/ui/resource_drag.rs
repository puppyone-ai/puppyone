//! Workspace entries being dragged (the Explorer's drag payload,
//! `EXPLORER_REFERENCE_DRAG_TYPE`). Its own type so that drop targets outside
//! the Explorer (editor panes, terminals, the Agent composer) can admit it
//! without depending on the shell.
use crate::{theme, ui::appearance::ActiveAppearance, workspace::Workspace};
use gpui::{prelude::*, *};
use std::{path::PathBuf, sync::Arc};

#[derive(Clone)]
pub struct ResourceDrag {
    pub single_file: bool,
    /// Workspace-relative paths.
    pub paths: Vec<PathBuf>,
    pub label: SharedString,
    pub workspace: Option<Arc<Workspace>>,
}
impl ResourceDrag {
    pub fn belongs_to(&self, workspace: &Option<Arc<Workspace>>) -> bool {
        self.workspace
            .as_ref()
            .zip(workspace.as_ref())
            .is_some_and(|(a, b)| Arc::ptr_eq(a, b))
    }
    /// The entries' local paths (`resolveResourceReferences`); `None` for a
    /// workspace without a local root (a Cloud project).
    pub fn local_paths(&self) -> Option<Vec<PathBuf>> {
        let root = self.workspace.as_ref()?.local_root()?;
        Some(self.paths.iter().map(|p| root.join(p)).collect())
    }
}
impl Render for ResourceDrag {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.palette();
        div()
            .px(px(10.))
            .py(px(6.))
            .rounded(px(6.))
            .bg(t.menu_bg)
            .border_1()
            .border_color(t.border)
            .text_color(t.text)
            .text_size(px(theme::ty().left.content))
            .child(self.label.clone())
    }
}
