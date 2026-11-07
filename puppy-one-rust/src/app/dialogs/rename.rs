//! `DesktopNodeRenameDialog`; "Change file type" opens the same dialog
//! (`renameFocus: "type"`), where the extension is part of the name. The
//! Explorer asks for it; the layer answers with the name
//! ([`DialogEvent::Rename`]) and the shell has the Explorer run it.
use super::*;
use crate::{
    theme,
    ui::{
        appearance::ActiveAppearance,
        components::{Button, Dialog},
        form_input::{InputEvent, TextInput},
    },
};

pub(in crate::app) struct RenameDialog {
    path: PathBuf,
    input: Entity<TextInput>,
    change_type: bool,
    layer: WeakEntity<DialogLayer>,
}

impl DialogLayer {
    /// Rename `path` (or change its type).
    pub fn rename(
        &mut self,
        path: PathBuf,
        change_type: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let layer = cx.weak_entity();
        let dialog = cx.new(|cx| RenameDialog::new(path, change_type, layer, window, cx));
        let (shown, dismissed) = (dialog.clone(), dialog.downgrade());
        self.open_owned(
            DialogKey::Rename,
            move |_, _, _| shown.clone().into_any_element(),
            move |window, cx| {
                let _ = dismissed.update(cx, |d, cx| d.cancel(window, cx));
            },
            cx,
        );
    }
}

impl RenameDialog {
    fn new(
        path: PathBuf,
        change_type: bool,
        layer: WeakEntity<DialogLayer>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let input = cx.new(|cx| {
            let mut input = TextInput::new("", false, 255, window, cx);
            input.submit_on_enter = true;
            input.set_text(name, cx);
            input
        });
        cx.subscribe_in(&input, window, |s, _, event, w, cx| {
            if matches!(event, InputEvent::Submit) {
                s.submit(w, cx)
            }
        })
        .detach();
        input.read(cx).focus_handle(cx).focus(window, cx);
        Self {
            path,
            input,
            change_type,
            layer,
        }
    }
    /// Closes the dialog and hands the layer's answer to the shell.
    fn answer(&self, event: Option<DialogEvent>, cx: &mut Context<Self>) {
        let _ = self.layer.update(cx, |layer, cx| {
            layer.close(DialogKey::Rename, cx);
            cx.emit(event.unwrap_or(DialogEvent::Closed));
        });
    }
    pub(in crate::app) fn cancel(&mut self, _: &mut Window, cx: &mut Context<Self>) {
        self.answer(None, cx);
    }
    fn submit(&mut self, _: &mut Window, cx: &mut Context<Self>) {
        let name = self.input.read(cx).text().trim().to_owned();
        let event = if name.is_empty() {
            DialogEvent::Error(tr("workspace.node.error.nameRequired").into())
        } else if name == "." || name == ".." || name.contains(['/', '\\']) {
            DialogEvent::Error(tr("workspace.node.error.nameInvalid").into())
        } else {
            DialogEvent::Rename {
                path: self.path.clone(),
                name,
            }
        };
        self.answer(Some(event), cx);
    }
}

impl Render for RenameDialog {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.palette();
        let dialog = cx.weak_entity();
        Dialog::new("rename-dialog")
            .width(400.)
            .title(tr(if self.change_type {
                "workspace.node.changeType"
            } else {
                "workspace.node.rename"
            }))
            .on_close(move |w, cx| {
                let _ = dialog.update(cx, |d, cx| d.cancel(w, cx));
            })
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(6.))
                    .child(
                        div()
                            .text_size(px(theme::ty().ui.meta))
                            .text_color(t.subtle)
                            .child(tr("workspace.node.name")),
                    )
                    .child(self.input.clone()),
            )
            .footer(
                Button::new("cancel-rename")
                    .variant(ButtonVariant::Secondary)
                    .label(tr("common.action.cancel"))
                    .on_click(cx.listener(|s, _, w, cx| s.cancel(w, cx))),
            )
            .footer(
                Button::new("save-rename")
                    .variant(ButtonVariant::Solid)
                    .label(tr("common.action.save"))
                    .on_click(cx.listener(|s, _, w, cx| s.submit(w, cx))),
            )
    }
}
