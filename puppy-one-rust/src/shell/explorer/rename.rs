//! `DesktopNodeRenameDialog`; "Change file type" opens the same dialog
//! (`renameFocus: "type"`), where the extension is part of the name.
use super::*;
use crate::ui::{
    components::{Button, ButtonVariant, Dialog},
    form_input::{InputEvent, TextInput},
};

/// The rename dialog's state, held on the shell's modal layer.
pub(in crate::shell) struct Rename {
    path: PathBuf,
    input: Entity<TextInput>,
    change_type: bool,
}
impl Shell {
    pub(in crate::shell) fn begin_rename(
        &mut self,
        path: PathBuf,
        change_type: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
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
                s.submit_rename(w, cx)
            }
        })
        .detach();
        input.read(cx).focus_handle(cx).focus(window, cx);
        self.modals.open(Modal::Rename(Rename {
            path,
            input,
            change_type,
        }));
        cx.notify();
    }
    pub(in crate::shell) fn cancel_rename(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self
            .modals
            .remove(|m| matches!(m, Modal::Rename(_)))
            .is_some()
        {
            self.focus.focus(window, cx);
            cx.notify();
        }
    }
    fn submit_rename(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(Modal::Rename(Rename { path, input, .. })) =
            self.modals.remove(|m| matches!(m, Modal::Rename(_)))
        else {
            return;
        };
        let name = input.read(cx).text().trim().to_owned();
        if name.is_empty() {
            self.show_error(tr("workspace.node.error.nameRequired"));
        } else if name == "." || name == ".." || name.contains(['/', '\\']) {
            self.show_error(tr("workspace.node.error.nameInvalid"));
        } else {
            self.run_op(FileOp::Rename { path, name }, window, cx);
        }
        self.focus.focus(window, cx);
        cx.notify();
    }
    pub(in crate::shell) fn rename_dialog(
        &self,
        rename: &Rename,
        cx: &mut Context<Self>,
    ) -> Dialog {
        let t = cx.palette();
        let host = self.weak.clone();
        Dialog::new("rename-dialog")
            .width(400.)
            .title(tr(if rename.change_type {
                "workspace.node.changeType"
            } else {
                "workspace.node.rename"
            }))
            .on_close(move |w, cx| {
                let _ = host.update(cx, |s, cx| s.cancel_rename(w, cx));
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
                    .child(rename.input.clone()),
            )
            .footer(
                Button::new("cancel-rename")
                    .variant(ButtonVariant::Secondary)
                    .label(tr("common.action.cancel"))
                    .on_click(cx.listener(|s, _, w, cx| s.cancel_rename(w, cx))),
            )
            .footer(
                Button::new("save-rename")
                    .variant(ButtonVariant::Solid)
                    .label(tr("common.action.save"))
                    .on_click(cx.listener(|s, _, w, cx| s.submit_rename(w, cx))),
            )
    }
}
