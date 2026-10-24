//! Draft form; filesystem work belongs to the native creation port.
use super::{create_entry_draft::normalize_name, create_entry_menu_registry::Entry};
use crate::ui::appearance::ActiveAppearance;
use crate::ui::components::{Button, ButtonVariant};
use crate::{
    localization::{t as tr, tf},
    theme::Theme,
    ui::form_input::{InputEvent, TextInput},
    workspace::Workspace,
};
use gpui::{prelude::*, *};
use gpui_kit::base::{Disableable as _, h_flex, v_flex};
use std::{path::PathBuf, sync::Arc};
pub enum CreateEvent {
    Cancel,
    Created {
        workspace: Arc<Workspace>,
        parent: PathBuf,
        path: PathBuf,
        folder: bool,
        nodes: Result<Vec<crate::model::Node>, String>,
    },
}
pub struct CreateEntryDialog {
    workspace: Arc<Workspace>,
    parent: PathBuf,
    kind: Entry,
    input: Entity<TextInput>,
    busy: bool,
    error: Option<String>,
}
impl EventEmitter<CreateEvent> for CreateEntryDialog {}
impl CreateEntryDialog {
    pub fn new(
        workspace: Arc<Workspace>,
        parent: PathBuf,
        kind: Entry,
        w: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let input =
            cx.new(|cx| TextInput::new(format!("Untitled{}", kind.extension()), false, 255, w, cx));
        input.update(cx, |i, cx| {
            i.submit_on_enter = true;
            let text = format!("Untitled{}", kind.extension());
            i.restore(
                crate::ui::form_input::InputSnapshot {
                    cursor: "Untitled".len(),
                    anchor: 0,
                    marks: vec![],
                    text,
                },
                cx,
            );
        });
        cx.subscribe_in(&input, w, |s, _, event, w, cx| {
            if matches!(event, InputEvent::Submit) {
                s.create(w, cx)
            }
        })
        .detach();
        input.focus_handle(cx).focus(w, cx);
        Self {
            workspace,
            parent,
            kind,
            input,
            busy: false,
            error: None,
        }
    }
    pub fn busy(&self) -> bool {
        self.busy
    }
    fn create(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.busy || self.input.update(cx, |i, cx| i.composing(window, cx)) {
            return;
        }
        let name = match normalize_name(self.kind, self.input.read(cx).text()) {
            Ok(name) => name,
            Err(key) => {
                self.error = Some(tr(key).into());
                cx.notify();
                return;
            }
        };
        if !self.kind.available() {
            return;
        }
        self.busy = true;
        self.error = None;
        let rx = super::native_create_entry::create(
            self.workspace.clone(),
            self.parent.clone(),
            name,
            self.kind,
        );
        cx.spawn(async move |this, cx| {
            if let Ok(result) = rx.recv().await {
                let _ = this.update(cx, |s, cx| {
                    s.busy = false;
                    match result {
                        Ok((path, nodes)) => cx.emit(CreateEvent::Created {
                            workspace: s.workspace.clone(),
                            parent: s.parent.clone(),
                            path,
                            folder: s.kind == Entry::Folder,
                            nodes,
                        }),
                        Err(e) => s.error = Some(e),
                    }
                    cx.notify()
                });
            }
        })
        .detach();
        cx.notify();
    }
}
impl Render for CreateEntryDialog {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.palette();
        // Catalog `…kind.<id>.title` ("Create folder"); kinds without one use "Create new".
        let title_key = self.kind.label_key().replace(".label", ".title");
        let title = match tr(&title_key) {
            text if text != title_key => text,
            _ => tr("workspace.node.createNew"),
        };
        v_flex()
            .size_full()
            .p(px(24.))
            .gap(px(12.))
            .child(
                div()
                    .text_size(px(crate::theme::ty().ui.title))
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(title),
            )
            .child(
                div()
                    .text_size(px(crate::theme::ty().ui.meta))
                    .text_color(t.muted)
                    .child(tf(
                        "workspace.node.kindName",
                        &[("kind", tr(self.kind.label_key()).into())],
                    )),
            )
            .child(self.input.clone())
            .when_some(self.error.clone(), |d, e| {
                d.child(
                    div()
                        .text_size(px(crate::theme::ty().ui.meta))
                        .text_color(t.danger)
                        .child(e),
                )
            })
            .child(
                h_flex()
                    .justify_end()
                    .gap(px(8.))
                    .child(
                        Button::new("cancel-create")
                            .label(tr("common.action.cancel"))
                            .disabled(self.busy)
                            .on_click(cx.listener(|s, _, _, cx| {
                                if !s.busy {
                                    cx.emit(CreateEvent::Cancel)
                                }
                            })),
                    )
                    .child(
                        Button::new("create-entry")
                            .variant(ButtonVariant::OutlinePrimary)
                            .label(tr(if self.busy {
                                "workspace.node.creating"
                            } else {
                                "workspace.node.create"
                            }))
                            .disabled(self.busy)
                            .on_click(cx.listener(|s, _, w, cx| s.create(w, cx))),
                    ),
            )
    }
}
