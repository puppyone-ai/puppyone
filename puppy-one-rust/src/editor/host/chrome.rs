//! The pane around the native editor (EditorPaneShell + EditorFindHost):
//! what the editor contributes to the pane menu, running its actions, and
//! routing the find widget to the editor's adapter.
use super::{DocumentEditor, Surface};
use gpui::Focusable as _;
use crate::{
    documents::ClientMessage,
    editor::{
        csv::CsvEditor,
        markdown::MarkdownExtension,
        workbench::{
            find::{FindBar, FindEvent},
            pane::{Action, Contribution, Item, ItemKind, Segment, Segmented},
        },
    },
    localization::t,
};
use gpui::{prelude::*, *};

impl DocumentEditor {
    fn csv(&self) -> Option<Entity<CsvEditor>> {
        match &self.editor {
            Some(Surface::Csv(e)) => Some(e.clone()),
            _ => None,
        }
    }

    fn markdown_live(&self, cx: &App) -> Option<bool> {
        match &self.editor {
            Some(Surface::Text(e)) => e.read(cx).extension::<MarkdownExtension>().map(|m| m.live),
            _ => None,
        }
    }

    /// `EditorPaneMenuContribution`: Markdown contributes its live / source
    /// segments to the menu (CSV keeps its inline toggle); CSV its view
    /// items; editors with a find adapter the find command.
    pub(super) fn contribution(&self, cx: &App) -> Contribution {
        if self.session.is_none() {
            return Contribution::default();
        }
        let segmented = self.markdown_live(cx).map(|live| Segmented {
            label: t("editor.mode.label").into(),
            options: vec![
                Segment { id: "live", icon: "editor-mode-edit", label: t("editor.mode.live").into() },
                Segment { id: "source", icon: "editor-mode-source", label: t("editor.mode.source").into() },
            ],
            value: if live { "live" } else { "source" },
        });
        let items = self
            .csv()
            .map(|csv| {
                csv.read(cx)
                    .view_items()
                    .into_iter()
                    .map(|i| Item { id: i.id, label: i.label.into(), kind: i.checked.map_or(ItemKind::Command { disabled: false }, ItemKind::Toggle) })
                    .collect()
            })
            .unwrap_or_default();
        Contribution { segmented, items, find: true, open_external: true }
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

    pub(super) fn close_pane_menu(&mut self, restore_focus: bool, window: &mut Window, cx: &mut Context<Self>) {
        if !self.chrome.open {
            return;
        }
        self.chrome.open = false;
        if restore_focus {
            self.focus_document(window, cx);
        }
        cx.notify();
    }

    pub(super) fn pane_menu_key(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
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
    pub(super) fn run_pane_action(&mut self, action: Action, window: &mut Window, cx: &mut Context<Self>) {
        let contribution = self.contribution(cx);
        if contribution.closes(&action) {
            self.close_pane_menu(false, window, cx);
        }
        match action {
            Action::Segment(id) => {
                if self.markdown_live(cx).is_some_and(|live| live != (id == "live")) {
                    self.command("source", window, cx);
                    self.chrome.focus.focus(window, cx);
                }
            }
            Action::Find => self.open_find(window, cx),
            Action::OpenExternal => cx.emit(ClientMessage::Action { action: "open-external".into() }),
            Action::Close => cx.emit(ClientMessage::Action { action: "close-file".into() }),
            Action::Item(id) => {
                if let Some(csv) = self.csv() {
                    csv.update(cx, |c, cx| c.view_command(id, window, cx));
                }
            }
        }
        cx.notify();
    }

    // --- find -------------------------------------------------------------------

    /// `openFind` (⌘F or the menu), when the editor has a find adapter.
    pub(super) fn open_find(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.contribution(cx).find {
            return;
        }
        let bar = match &self.find {
            Some(bar) => bar.clone(),
            None => {
                let dark = self.dark;
                let bar = cx.new(|cx| FindBar::new(dark, window, cx));
                let subscription = cx.subscribe_in(&bar, window, |this: &mut Self, _, event: &FindEvent, window, cx| this.find_event(event.clone(), window, cx));
                self.find = Some(bar.clone());
                self.find_subscription = Some(subscription);
                bar
            }
        };
        bar.update(cx, |b, cx| b.show(window, cx));
        cx.notify();
    }

    fn find_event(&mut self, event: FindEvent, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(Surface::Text(editor)) = self.editor.clone() {
            // The CodeMirror adapter: the view searches and marks.
            let result = match event {
                FindEvent::Query(query) => Some(editor.update(cx, |e, cx| e.find_query(&query, cx))),
                FindEvent::Move { forward } => Some(editor.update(cx, |e, cx| e.find_move(forward, cx))),
                FindEvent::Close => {
                    editor.update(cx, |e, cx| e.find_clear(cx));
                    let handle = editor.read(cx).focus_handle(cx);
                    handle.focus(window, cx);
                    if let Some(bar) = &self.find {
                        bar.update(cx, |b, cx| b.hide(cx));
                    }
                    None
                }
            };
            if let (Some((current, total)), Some(bar)) = (result, &self.find) {
                bar.update(cx, |b, cx| b.set_result(current, total, cx));
            }
            cx.notify();
            return;
        }
        let Some(csv) = self.csv() else { return };
        let result = match event {
            FindEvent::Query(query) => Some(csv.update(cx, |c, cx| c.find_query(&query, cx))),
            FindEvent::Move { forward } => Some(csv.update(cx, |c, cx| c.find_move(forward, cx))),
            FindEvent::Close => {
                // `closeFind`: focus the current match's cell, then clear.
                csv.update(cx, |c, cx| {
                    c.find_focus_editor(window, cx);
                    c.find_clear(cx);
                });
                if let Some(bar) = &self.find {
                    bar.update(cx, |b, cx| b.hide(cx));
                }
                None
            }
        };
        if let (Some(result), Some(bar)) = (result, &self.find) {
            bar.update(cx, |b, cx| b.set_result(result.current, result.total, cx));
        }
        cx.notify();
    }

    /// The find bar, while open.
    pub(super) fn find_bar(&self, cx: &App) -> Option<Entity<FindBar>> {
        self.find.clone().filter(|b| b.read(cx).open)
    }
}
