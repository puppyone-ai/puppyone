//! The pane around the native editor (EditorPaneShell + EditorFindHost):
//! what the editor contributes to the pane menu, running its actions, and
//! routing the find widget to the editor's adapter.
use super::DocumentEditor;
use crate::{
    documents::ClientMessage,
    editor::workbench::{
        find::{FindBar, FindEvent},
        pane::{Action, Contribution},
    },
};
use gpui::{prelude::*, *};

impl DocumentEditor {
    /// `EditorPaneMenuContribution`: what the open viewer contributes (its
    /// segments, items and find adapter) plus the external opener.
    pub(super) fn contribution(&self, cx: &App) -> Contribution {
        let (Some(session), Some(surface)) = (&self.session, &self.surface) else {
            return Contribution::default();
        };
        let mut entries = surface.pane(cx);
        if self.workbench {
            for (id, key) in [
                ("split-left", "editor.panes.splitLeft"),
                ("split-right", "editor.panes.splitRight"),
                ("split-up", "editor.panes.splitUp"),
                ("split-down", "editor.panes.splitDown"),
            ] {
                entries.items.push(crate::editor::workbench::pane::Item {
                    id,
                    label: crate::localization::t(key).into(),
                    kind: crate::editor::workbench::pane::ItemKind::Command { disabled: false },
                });
            }
        }
        // The live / source toggle is the contribution's to declare.
        let segmented = entries
            .segmented
            .filter(|_| session.viewer.policy.source_toggle);
        Contribution {
            segmented,
            items: entries.items,
            find: entries.find,
            open_external: true,
        }
    }

    pub(super) fn toggle_pane_menu(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.chrome.open = !self.chrome.open;
        if self.chrome.open {
            // The first item takes focus (not visibly, after a click).
            self.chrome.selected = 0;
            self.chrome.keyboard = false;
            self.chrome.focus.focus(window, cx);
        } else {
            self.focus_document(window, cx);
        }
        cx.notify();
    }

    pub(super) fn close_pane_menu(
        &mut self,
        restore_focus: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if !self.chrome.open {
            return;
        }
        self.chrome.open = false;
        if restore_focus {
            self.focus_document(window, cx);
        }
        cx.notify();
    }

    pub(super) fn pane_menu_key(
        &mut self,
        event: &KeyDownEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let key = event.keystroke.key.as_str();
        if key == "escape" {
            cx.stop_propagation();
            self.close_pane_menu(true, window, cx);
            return;
        }
        let entries = self.contribution(cx).entries();
        let selected = self.chrome.selected;
        if let Some(run) = self.chrome.key(key, entries.len()) {
            cx.stop_propagation();
            if let Some(action) = entries.get(run).cloned() {
                self.run_pane_action(action, window, cx);
            }
        } else if self.chrome.selected != selected || self.chrome.keyboard {
            cx.stop_propagation();
            cx.notify();
        }
    }

    /// Run a pane menu entry (`runAndClose` for commands).
    #[cfg(feature = "dev-capture")]
    pub fn lab_pane_segment(
        &mut self,
        id: &'static str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.run_pane_action(Action::Segment(id), window, cx);
    }
    pub(super) fn run_pane_action(
        &mut self,
        action: Action,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let contribution = self.contribution(cx);
        if contribution.closes(&action) {
            self.close_pane_menu(false, window, cx);
        }
        match action {
            Action::Segment(id) => {
                if let Some(surface) = &self.surface {
                    surface.pane_segment(id, window, cx);
                    self.chrome.focus.focus(window, cx);
                }
            }
            Action::Find => self.open_find(window, cx),
            Action::OpenExternal => cx.emit(ClientMessage::Action {
                action: "open-external".into(),
            }),
            Action::Close => cx.emit(ClientMessage::Action {
                action: "close-file".into(),
            }),
            Action::Item(id)
                if self.workbench
                    && matches!(id, "split-left" | "split-right" | "split-up" | "split-down") =>
            {
                cx.emit(ClientMessage::Action { action: id.into() })
            }
            Action::Item(id) => {
                if let Some(surface) = &self.surface {
                    surface.pane_item(id, window, cx);
                }
            }
        }
        cx.notify();
    }

    // --- find -------------------------------------------------------------------

    /// `openFind` (⌘F or the menu), when the editor has a find adapter.
    pub(super) fn open_find(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.blocked || !self.contribution(cx).find {
            return;
        }
        let bar = match &self.find {
            Some(bar) => bar.clone(),
            None => {
                let dark = self.dark;
                let bar = cx.new(|cx| FindBar::new(dark, window, cx));
                let subscription = cx.subscribe_in(
                    &bar,
                    window,
                    |this: &mut Self, _, event: &FindEvent, window, cx| {
                        this.find_event(event.clone(), window, cx)
                    },
                );
                self.find = Some(bar.clone());
                self.find_subscription = Some(subscription);
                bar
            }
        };
        bar.update(cx, |b, cx| b.show(window, cx));
        cx.notify();
    }

    fn find_event(&mut self, event: FindEvent, window: &mut Window, cx: &mut Context<Self>) {
        let Some(surface) = &self.surface else { return };
        let close = matches!(event, FindEvent::Close);
        let result = surface.find(event, window, cx);
        if let Some(bar) = &self.find {
            match result {
                Some((current, total)) => bar.update(cx, |b, cx| b.set_result(current, total, cx)),
                None if close => bar.update(cx, |b, cx| b.hide(cx)),
                None => {}
            }
        }
        cx.notify();
    }

    /// The find bar, while open.
    pub(super) fn find_bar(&self, cx: &App) -> Option<Entity<FindBar>> {
        self.find.clone().filter(|b| b.read(cx).open)
    }
}
