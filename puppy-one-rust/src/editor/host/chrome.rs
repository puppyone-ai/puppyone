//! The pane around the native editor (EditorPaneShell + EditorFindHost):
//! what the editor contributes to the pane menu, running its actions, and
//! routing the find widget to the editor's adapter (`RG-21`, `RG-23`).
use super::{DocumentEditor, panic_payload_summary};
use crate::{
    documents::ClientMessage,
    editor::{
        registry::{PaneEntries, PaneItemId, PaneSegmentId},
        workbench::{
            find::{FindBar, FindEvent},
            pane::{Action, Contribution},
        },
    },
};
use gpui::{prelude::*, *};
use std::panic::{AssertUnwindSafe, catch_unwind};

impl DocumentEditor {
    /// `EditorPaneMenuContribution`: what the open viewer contributes (its
    /// segments, items and find adapter) plus the external opener.
    pub(super) fn contribution(&self, cx: &App) -> Contribution {
        let (Some(session), Some(surface)) = (&self.session, &self.surface) else {
            return Contribution::default();
        };
        if session.faulted {
            return Contribution {
                open_external: true,
                ..Contribution::default()
            };
        }
        let entries = catch_unwind(AssertUnwindSafe(|| surface.pane(cx)))
            .unwrap_or_else(|_| PaneEntries::default());
        let segmented = entries.segmented.filter(|segmented| {
            session.viewer.policy.source_toggle
                || !segmented.options.iter().any(|option| option.id == "source")
        });
        Contribution {
            segmented,
            toggles: entries.toggles,
            items: entries.items,
            find: entries.find,
            open_external: true,
        }
    }

    /// A file window's title bar controls (`FileControls`).
    pub fn title_controls(&self, cx: &App) -> Contribution {
        Contribution {
            find: false,
            open_external: false,
            ..self.contribution(cx)
        }
    }

    /// Runs a title bar control's action.
    pub fn run_title_action(
        &mut self,
        action: Action,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.run_pane_action(action, window, cx);
    }

    pub(super) fn toggle_pane_menu(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.chrome.open = !self.chrome.open;
        if self.chrome.open {
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

    /// Whether the pane menu is open.
    pub fn pane_menu_open(&self) -> bool {
        self.chrome.open
    }

    /// Escape for an open pane menu. The window's Escape binding runs
    /// before the menu's own key handler, so the shell routes it here:
    /// the menu closes and focus returns to the document.
    pub fn dismiss_pane_menu(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.close_pane_menu(true, window, cx);
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

    /// Dev-capture: the reference's `md-menu` (handle revealed, menu open)
    /// and `md-find` (find bar open, unfocused) states.
    #[cfg(any(feature = "dev-capture", feature = "test-support"))]
    pub fn lab_state(&mut self, state: &str, window: &mut Window, cx: &mut Context<Self>) {
        match state {
            "menu" => {
                self.chrome.hot = true;
                self.toggle_pane_menu(window, cx);
                self.chrome.keyboard = false;
            }
            "find" => self.open_find(window, cx),
            _ => {}
        }
        cx.notify();
    }

    /// Run a pane menu entry (`runAndClose` for commands).
    #[cfg(any(feature = "dev-capture", feature = "test-support"))]
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
        let mut panicked = None;
        match action {
            Action::Segment(id) => {
                let seg = PaneSegmentId::parse(id);
                if let Some(surface) = &self.surface {
                    if let Err(payload) =
                        catch_unwind(AssertUnwindSafe(|| surface.pane_segment(seg, window, cx)))
                    {
                        panicked = Some(("pane_segment", panic_payload_summary(payload)));
                    } else {
                        self.chrome.focus.focus(window, cx);
                    }
                }
            }
            Action::Find => self.open_find(window, cx),
            Action::OpenExternal => cx.emit(ClientMessage::Action {
                action: "open-external".into(),
            }),
            Action::Close => cx.emit(ClientMessage::Action {
                action: "close-file".into(),
            }),
            Action::Item(id) => {
                let item = PaneItemId::parse(id);
                if let Some(surface) = &self.surface
                    && let Err(payload) =
                        catch_unwind(AssertUnwindSafe(|| surface.pane_item(item, window, cx)))
                {
                    panicked = Some(("pane_item", panic_payload_summary(payload)));
                }
            }
        }
        if let Some((phase, msg)) = panicked {
            self.install_faulted_surface(phase, msg, cx);
        }
        cx.notify();
    }

    // --- find -------------------------------------------------------------------

    /// `openFind` (⌘F or the menu), when the editor has a find adapter.
    pub(super) fn open_find(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.blocked || self.is_faulted() || !self.contribution(cx).find {
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
        let top_inset = self.chrome_inset;
        bar.update(cx, |b, cx| {
            b.top_inset = top_inset;
            b.show(window, cx);
        });
        cx.notify();
    }

    fn find_event(&mut self, event: FindEvent, window: &mut Window, cx: &mut Context<Self>) {
        if self.is_faulted() {
            return;
        }
        let close = matches!(event, FindEvent::Close);
        let outcome = {
            let Some(surface) = &self.surface else { return };
            catch_unwind(AssertUnwindSafe(|| surface.find(event, window, cx)))
        };
        match outcome {
            Ok(result) => {
                if let Some(bar) = &self.find {
                    match result {
                        Some((current, total)) => {
                            bar.update(cx, |b, cx| b.set_result(current, total, cx))
                        }
                        None if close => bar.update(cx, |b, cx| b.hide(cx)),
                        None => {}
                    }
                }
            }
            Err(payload) => {
                self.install_faulted_surface("find", panic_payload_summary(payload), cx);
            }
        }
        cx.notify();
    }

    /// The find bar, while open.
    pub(super) fn find_bar(&self, cx: &App) -> Option<Entity<FindBar>> {
        self.find.clone().filter(|b| b.read(cx).open)
    }
}
