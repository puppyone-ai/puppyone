//! `AgentCommandSuggestions`: commands matching a leading `/word`.
use super::{ComposerEvent, ComposerView};
use crate::ui::components::{Menu, MenuItem};
use gpui::*;

impl ComposerView {
    /// `AgentCommandSuggestions`: commands matching a leading `/word`.
    pub(super) fn render_commands(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let draft = &self.data.draft;
        if !draft.starts_with('/')
            || draft.contains(char::is_whitespace)
            || self.data.commands.is_empty()
        {
            return None;
        }
        let needle = draft.trim_start_matches('/').to_lowercase();
        let commands: Vec<(String, String)> = self
            .data
            .commands
            .iter()
            .map(|command| (command.name.clone(), command.description.clone()))
            .filter(|(name, _)| !name.is_empty() && name.to_lowercase().starts_with(&needle))
            .take(8)
            .collect();
        if commands.is_empty() {
            return None;
        }
        let host = cx.weak_entity();
        Some(
            Menu::new("agent-panel-commands")
                .items(commands.into_iter().map(|(name, description)| {
                    let host = host.clone();
                    MenuItem::new(format!("/{name}"))
                        .detail(description)
                        .on_click(move |_, cx| {
                            let _ = host.update(cx, |_, cx| {
                                cx.emit(ComposerEvent::Command(name.clone()));
                            });
                        })
                }))
                .into_any_element(),
        )
    }
}
