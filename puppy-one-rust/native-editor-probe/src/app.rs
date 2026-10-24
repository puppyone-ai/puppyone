use crate::{
    buffer,
    input::{InputEvent, TextInput},
    model::*,
};
use gpui::{prelude::*, *};
use std::collections::HashMap;
#[derive(Clone, PartialEq, serde::Deserialize, Action)]
#[action(no_json)]
pub struct LabAction {
    pub name: String,
}
impl LabAction {
    pub fn new(name: &str) -> Self {
        Self { name: name.into() }
    }
}
pub fn bind_keys(cx: &mut App) {
    for modifier in ["cmd", "ctrl"] {
        for (key, name) in [
            ("b", "bold"),
            ("i", "italic"),
            ("z", "undo"),
            ("shift-z", "redo"),
            ("y", "redo"),
            ("q", "quit"),
            ("w", "quit"),
        ] {
            cx.bind_keys([KeyBinding::new(
                &format!("{modifier}-{key}"),
                LabAction::new(name),
                Some("NativeLab"),
            )]);
        }
    }
    cx.bind_keys([KeyBinding::new(
        "escape",
        LabAction::new("cancel"),
        Some("NativeLab"),
    )]);
}
pub struct Probe {
    state: Snapshot,
    initial: Document,
    history: History,
    pending_ime: Option<Snapshot>,
    fields: HashMap<u64, Entity<TextInput>>,
    subscriptions: HashMap<u64, Subscription>,
    show_source: bool,
    closing: bool,
    status: String,
    focus: FocusHandle,
}
impl Probe {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let document = Document::demo();
        let focus = cx.focus_handle();
        focus.focus(window, cx);
        let weak = cx.weak_entity();
        window.on_window_should_close(cx, move |w, cx| {
            weak.update(cx, |s, cx| {
                if s.state.document == s.initial {
                    true
                } else {
                    s.closing = true;
                    s.focus.focus(w, cx);
                    cx.notify();
                    false
                }
            })
            .unwrap_or(true)
        });
        let mut s = Self {
            state: Snapshot {
                document: document.clone(),
                selection: Selection::caret(2),
            },
            initial: document,
            history: History::default(),
            pending_ime: None,
            fields: HashMap::new(),
            subscriptions: HashMap::new(),
            show_source: false,
            closing: false,
            status: "GPUI 原生富文本 / 表格 · 仅内存 · 不读写真实文件".into(),
            focus,
        };
        s.sync_fields(window, cx);
        s
    }
    fn sync_fields(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let nodes: Vec<_> = [
            &self.state.document.title,
            &self.state.document.before,
            &self.state.document.after,
        ]
        .into_iter()
        .chain(self.state.document.cells.iter().flatten())
        .cloned()
        .collect();
        self.fields
            .retain(|id, _| nodes.iter().any(|n| n.id == *id));
        self.subscriptions
            .retain(|id, _| self.fields.contains_key(id));
        for node in nodes {
            let id = node.id;
            let table = self.state.document.cell_position(id).is_some();
            let selected = if self.state.selection.node == id {
                self.state.selection
            } else {
                Selection::caret(id)
            };
            let snapshot = buffer::input_snapshot(&node, selected);
            if let Some(field) = self.fields.get(&id) {
                field.update(cx, |i, cx| i.restore(snapshot, cx));
            } else {
                let field = cx.new(|cx| {
                    let mut input = TextInput::new("", true, MAX_TEXT, cx);
                    input.external_history = true;
                    input.table_cell = table;
                    input.font_size = if id == 1 {
                        28.
                    } else if table {
                        15.
                    } else {
                        17.
                    };
                    input.heading = id == 1;
                    input.restore(snapshot, cx);
                    input
                });
                let subscription =
                    cx.subscribe_in(&field, window, move |s, field, event, w, cx| {
                        s.input_event(id, field, event, w, cx)
                    });
                self.fields.insert(id, field);
                self.subscriptions.insert(id, subscription);
            }
        }
    }
    fn input_event(
        &mut self,
        id: u64,
        field: &Entity<TextInput>,
        event: &InputEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.closing {
            return;
        }
        match event {
            InputEvent::Adornment(_) => {}
            InputEvent::Changed | InputEvent::Selection => {
                let input = field.read(cx);
                let value = input.snapshot();
                let composing = input.composing();
                let before = self.state.clone();
                self.state.selection = buffer::selection(id, &value);
                if matches!(event, InputEvent::Changed) {
                    if composing && self.pending_ime.is_none() {
                        self.pending_ime = Some(before.clone());
                    }
                    if let Some(node) = self.state.document.get_mut(id) {
                        node.content = RichText {
                            text: value.text,
                            marks: value.marks,
                        };
                    }
                    if !composing {
                        self.history
                            .record(self.pending_ime.take().unwrap_or(before), &self.state);
                    }
                }
            }
            InputEvent::Undo => self.command("undo", window, cx),
            InputEvent::Redo => self.command("redo", window, cx),
            InputEvent::Next {
                backwards,
                vertical,
            } => {
                if self.pending_ime.is_none()
                    && let Some(next) = self.state.document.next_cell(id, *backwards, *vertical)
                {
                    self.state.selection = Selection::caret(next);
                    self.sync_fields(window, cx);
                    self.focus_selected(window, cx);
                }
            }
            InputEvent::PasteTable(text) => {
                if self.pending_ime.is_none() {
                    let before = self.state.clone();
                    match self.state.document.paste_tsv(id, text) {
                        Ok(()) => {
                            self.state.selection = Selection::caret(id);
                            self.history.record(before, &self.state);
                            self.sync_fields(window, cx);
                            self.focus_selected(window, cx);
                            self.status = "TSV 已整体粘贴，可一次撤销".into();
                        }
                        Err(e) => self.status = e.into(),
                    }
                }
            }
        }
        cx.notify();
    }
    fn focus_selected(&self, window: &mut Window, cx: &mut App) {
        if let Some(field) = self.fields.get(&self.state.selection.node) {
            field.focus_handle(cx).focus(window, cx);
        }
    }
    pub fn command(&mut self, name: &str, window: &mut Window, cx: &mut Context<Self>) {
        if name == "cancel" {
            self.closing = false;
            self.focus_selected(window, cx);
            cx.notify();
            return;
        }
        if name == "discard" && self.closing {
            window.remove_window();
            return;
        }
        if name == "quit" {
            if self.state.document == self.initial {
                window.remove_window();
            } else {
                self.closing = true;
                self.focus.focus(window, cx);
                cx.notify();
            }
            return;
        }
        if self.closing || self.pending_ime.is_some() {
            return;
        }
        let before = self.state.clone();
        let id = self.state.selection.node;
        let mut next = None;
        let mut synchronize = true;
        match name {
            "bold" | "italic" => {
                if let Some(node) = self.state.document.get_mut(id) {
                    node.content.toggle(
                        self.state.selection.range(),
                        if name == "bold" {
                            Format::Bold
                        } else {
                            Format::Italic
                        },
                    );
                }
            }
            "undo" => {
                self.history.undo(&mut self.state);
            }
            "redo" => {
                self.history.redo(&mut self.state);
            }
            "add-row" => next = self.state.document.add_row(),
            "add-column" => next = self.state.document.add_column(),
            "delete-row" => next = self.state.document.delete_row(id),
            "delete-column" => next = self.state.document.delete_column(id),
            "source" => {
                self.show_source = !self.show_source;
                synchronize = false;
            }
            "copy" => {
                cx.write_to_clipboard(ClipboardItem::new_string(self.state.document.markdown()));
                self.status = "已复制有限 Markdown 投影".into();
                synchronize = false;
            }
            _ => {}
        }
        if let Some(next) = next {
            self.state.selection = Selection::caret(next);
        }
        if name != "undo" && name != "redo" {
            self.history.record(before, &self.state);
        }
        if synchronize {
            self.sync_fields(window, cx);
            self.focus_selected(window, cx);
        }
        cx.notify();
    }
    fn button(
        &self,
        label: &'static str,
        action: &'static str,
        enabled: bool,
        cx: &mut Context<Self>,
    ) -> Stateful<Div> {
        div()
            .id(action)
            .px(px(10.))
            .py(px(6.))
            .rounded(px(5.))
            .bg(rgb(0x303034))
            .text_color(if enabled {
                rgb(0xfafafa)
            } else {
                rgb(0x71717a)
            })
            .child(label)
            .when(enabled, |d| {
                d.cursor_pointer()
                    .hover(|s| s.bg(rgb(0x45454a)))
                    .on_click(cx.listener(move |s, _, w, cx| s.command(action, w, cx)))
            })
    }
}
impl Render for Probe {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let selected = !self.state.selection.range().is_empty()
            && self.state.document.get(self.state.selection.node).is_some();
        let active = !self.closing && self.pending_ime.is_none();
        let cell = self.state.document.cell_position(self.state.selection.node);
        let toolbar = div().flex().flex_wrap().gap(px(6.)).children([
            self.button("B", "bold", active && selected, cx),
            self.button("I", "italic", active && selected, cx),
            self.button("撤销", "undo", active && self.history.can_undo(), cx),
            self.button("重做", "redo", active && self.history.can_redo(), cx),
            self.button(
                "＋行",
                "add-row",
                active && self.state.document.cells.len() < MAX_ROWS,
                cx,
            ),
            self.button(
                "＋列",
                "add-column",
                active && self.state.document.cells[0].len() < MAX_COLS,
                cx,
            ),
            self.button(
                "删行",
                "delete-row",
                active && cell.is_some_and(|(r, _)| r > 0) && self.state.document.cells.len() > 2,
                cx,
            ),
            self.button(
                "删列",
                "delete-column",
                active && cell.is_some() && self.state.document.cells[0].len() > 1,
                cx,
            ),
            self.button("Markdown 投影", "source", active, cx),
            self.button("复制 Markdown", "copy", active, cx),
        ]);
        let rows = self.state.document.cells.iter().map(|cells| {
            div()
                .flex()
                .gap(px(8.))
                .items_start()
                .children(cells.iter().map(|n| {
                    div()
                        .flex_1()
                        .min_w(px(130.))
                        .child(self.fields[&n.id].clone())
                }))
        });
        let document=div().font_family("Open Sans").id("document-scroll").flex_1().min_h_0().overflow_y_scroll().p(px(24.)).flex().flex_col().gap(px(20.))
            .child(self.fields[&1].clone()).child(self.fields[&2].clone())
            .child(div().id("table-scroll").overflow_x_scroll().child(div().flex().flex_col().gap(px(6.)).p(px(8.)).border_1().border_color(rgb(0x444444)).rounded(px(8.)).children(rows)))
            .child(self.fields[&3].clone()).child(div().text_size(px(12.)).text_color(rgb(0xa1a1aa)).child("单块选择、粗体/斜体、可编辑表格、TSV 粘贴与统一撤销。只在内存运行，不保存真实文件。"))
            .when(self.show_source,|d|d.child(div().p(px(16.)).bg(rgb(0x222222)).text_size(px(13.)).child(self.state.document.markdown())));
        div()
            .relative()
            .size_full()
            .flex()
            .flex_col()
            .key_context("NativeLab")
            .track_focus(&self.focus)
            .font_family("Geist")
            .text_size(px(14.))
            .bg(rgb(0x181818))
            .text_color(rgb(0xfafafa))
            .on_action(cx.listener(|s, a: &LabAction, w, cx| s.command(&a.name, w, cx)))
            .child(
                div()
                    .p(px(12.))
                    .flex_shrink_0()
                    .flex()
                    .flex_col()
                    .gap(px(10.))
                    .child("GPUI Native Editor Lab · 原生富文本 / 表格验证")
                    .child(toolbar),
            )
            .child(document)
            .child(
                div()
                    .p(px(8.))
                    .text_size(px(12.))
                    .text_color(rgb(0xa1a1aa))
                    .child(if self.pending_ime.is_some() {
                        "输入法组合中：结构操作与撤销暂缓".to_owned()
                    } else {
                        self.status.clone()
                    }),
            )
            .when(self.closing, |d| {
                d.child(
                    div()
                        .id("close-backdrop")
                        .absolute()
                        .size_full()
                        .bg(rgba(0x00000099))
                        .flex()
                        .items_center()
                        .justify_center()
                        .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                        .child(
                            div()
                                .bg(rgb(0x303030))
                                .p(px(24.))
                                .rounded(px(10.))
                                .flex()
                                .flex_col()
                                .gap(px(18.))
                                .child("丢弃内存中的改动并退出？")
                                .child("此实验没有文件保存；退出后无法恢复。")
                                .child(
                                    div()
                                        .flex()
                                        .gap(px(8.))
                                        .child(self.button("继续编辑", "cancel", true, cx))
                                        .child(self.button("丢弃并退出", "discard", true, cx)),
                                ),
                        ),
                )
            })
    }
}

#[cfg(test)]
mod tests;
