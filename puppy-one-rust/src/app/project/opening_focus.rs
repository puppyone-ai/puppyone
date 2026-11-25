//! `ProjectOpeningSurface`'s keyboard: while a project is on its way in, the
//! wait has the keyboard; an open that ends without bringing one in gives
//! it back to what had it when the open started (the entry that started
//! it), unless something outside the wait has taken it since.
use super::ProjectLifecycle;
use gpui::*;

#[derive(Default)]
pub(in crate::app) struct OpeningFocus {
    /// The wait's own focus, which the preparation layer tracks.
    pub(super) wait: Option<FocusHandle>,
    /// While a project is on its way in: what had the keyboard when it
    /// started, and the project the window showed then.
    started: Option<(Option<FocusHandle>, Option<String>)>,
}

impl ProjectLifecycle {
    /// The project this window shows, by its storage.
    fn shown_project(&self, cx: &App) -> Option<String> {
        let workspace = self.files(cx).workspace.as_ref()?;
        let id = workspace.resource_id(std::path::Path::new("")).ok()?;
        Some(id.storage.as_str().to_owned())
    }
    /// After each pump: an open starting takes the keyboard into the wait;
    /// one ending without its project gives it back.
    pub(in crate::app) fn sync_opening_focus(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let opening = self.opening(cx) && !self.file_window;
        if opening && self.opening_focus.started.is_none() {
            let wait = self
                .opening_focus
                .wait
                .get_or_insert_with(|| cx.focus_handle())
                .clone();
            self.opening_focus.started = Some((window.focused(cx), self.shown_project(cx)));
            wait.focus(window, cx);
        } else if !opening && let Some((entry, project)) = self.opening_focus.started.take() {
            // The wait, or its Cancel, still has the keyboard.
            let waiting = self
                .opening_focus
                .wait
                .as_ref()
                .is_some_and(|wait| wait.contains_focused(window, cx))
                || window.focused(cx).is_none();
            if waiting
                && project == self.shown_project(cx)
                && let Some(entry) = entry
            {
                entry.focus(window, cx);
            }
        }
    }
    /// The wait's own focus.
    #[cfg(test)]
    pub(in crate::app) fn opening_wait(&self) -> Option<FocusHandle> {
        self.opening_focus.wait.clone()
    }
}
