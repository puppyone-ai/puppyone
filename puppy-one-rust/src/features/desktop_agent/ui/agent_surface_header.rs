//! Session actions. The product's Chat panel has no visible session header —
//! identity and status live on the workbench tab — so these actions are offered
//! from the tab's context menu (`AgentSurfaceHeader` session menu: diagnostics,
//! compact context, close connection) plus native extensions (history, fork,
//! rename, copy). Model connections open in Settings.
use super::*;
use crate::{
    localization::t as tr,
    ui::components::{Button, ButtonVariant, Menu, MenuItem},
};
use gpui_kit::base::h_flex;

/// Raised to the workbench, which routes it to the shell.
#[derive(Clone, Debug)]
pub enum AgentChatEvent {
    OpenModelConnections,
    /// Resuming the History conversation `id` failed before it showed
    /// anything (`AuxiliaryWorkbenchCreationFailure`).
    ResumeFailed {
        id: String,
    },
}
impl EventEmitter<AgentChatEvent> for AgentChat {}

impl AgentChat {
    /// Fill a tab context menu with this session's actions.
    pub fn session_menu(chat: Entity<Self>, mut menu: Menu, cx: &App) -> Menu {
        let s = chat.read(cx);
        let caps = s.session.snapshot().capabilities.clone();
        let busy = s.session.busy();
        let puppyone = s.installation.runtime
            == crate::agent::runtime::agent_runtime_registry::Runtime::PuppyOne;
        let item = |label: &'static str, enabled: bool, action: u8| {
            let chat = chat.clone();
            MenuItem::new(tr(label))
                .disabled(!enabled)
                .on_click(move |window, cx| {
                    chat.update(cx, |s, cx| s.session_action(action, window, cx));
                })
        };
        menu = menu
            .item(item("agent.header.newChat", !busy, 0))
            .item(item("agent.history.openButton", caps.history && !busy, 1))
            .separator()
            .item(item("native.agent.copyConversation", true, 2));
        if caps.fork {
            menu = menu.item(item("native.agent.fork", !busy, 3));
        }
        if caps.rename {
            menu = menu.item(item("native.agent.renameConversation", !busy, 4));
        }
        if caps.compact {
            menu = menu.item(item("agent.header.compactContext", !busy, 5));
        }
        if puppyone {
            menu = menu
                .separator()
                .item(item("settings.modelConnections.title", true, 6));
        }
        menu.separator()
            .item(item("agent.header.closeConnection", true, 7))
    }
    fn session_action(&mut self, action: u8, window: &mut Window, cx: &mut Context<Self>) {
        match action {
            0 => self.session.new_thread(),
            1 => self.session.list_history(),
            2 => cx.write_to_clipboard(ClipboardItem::new_string(self.session.export())),
            3 => self.session.fork(),
            4 => {
                self.show_rename = true;
                let title = self.session.snapshot().title.clone();
                self.rename_input.update(cx, |i, cx| i.set_text(title, cx));
                self.rename_input
                    .read(cx)
                    .focus_handle(cx)
                    .focus(window, cx);
            }
            5 => self.session.compact(),
            6 => cx.emit(AgentChatEvent::OpenModelConnections),
            7 => {
                // `onCloseSession`: drop the live connection; history stays available.
                self.session.replace_client(native_agent_client::create(
                    self.installation.clone(),
                    self.root.clone(),
                    true,
                    self.wake.clone(),
                ));
                self.answers.clear();
            }
            _ => {}
        }
        cx.notify();
    }
    /// Inline rename bar shown only while renaming.
    pub(super) fn render_header(&mut self, cx: &mut Context<Self>) -> Option<Div> {
        if !self.show_rename {
            return None;
        }
        Some(
            h_flex()
                .flex_shrink_0()
                .px(px(12.))
                .pt(px(12.))
                .gap(px(6.))
                .child(div().flex_1().child(self.rename_input.clone()))
                .child(
                    Button::new("save-agent-name")
                        .variant(ButtonVariant::OutlinePrimary)
                        .label(tr("common.action.save"))
                        .on_click(cx.listener(|s, _, _, cx| {
                            s.session.rename(s.rename_input.read(cx).text().into());
                            s.show_rename = false;
                            cx.notify()
                        })),
                )
                .child(
                    Button::new("cancel-agent-name")
                        .label(tr("common.action.cancel"))
                        .on_click(cx.listener(|s, _, _, cx| {
                            s.show_rename = false;
                            cx.notify()
                        })),
                ),
        )
    }
}
