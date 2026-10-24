use super::layout::{Id, Layout};
use crate::agent::runtime::agent_runtime_registry::Runtime;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
#[derive(Clone, Serialize, Deserialize)]
pub enum RetainedItem {
    Launcher,
    Chat {
        runtime: Runtime,
        thread: Option<String>,
        title: String,
    },
    Terminal {
        title: String,
        /// CLI launched in the terminal (`launcherId`); `None` for the shell.
        #[serde(default)]
        runtime: Option<Runtime>,
    },
}
impl RetainedItem {
    pub fn title(&self) -> String {
        match self {
            Self::Launcher => crate::localization::t("workspace.workbench.newTab").into(),
            Self::Chat { title, .. } | Self::Terminal { title, .. } => title.clone(),
        }
    }
}
#[derive(Serialize, Deserialize)]
pub struct StoredProject {
    pub version: u8,
    pub layout: Layout,
    pub items: HashMap<Id, RetainedItem>,
}
impl StoredProject {
    pub fn validate(&self) -> bool {
        self.version == 1
            && self.layout.valid()
            && self.items.len() <= 64
            && self
                .layout
                .groups
                .values()
                .flat_map(|g| &g.tabs)
                .all(|id| self.items.contains_key(id))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stored_layout_rejects_orphan_tabs() {
        let mut layout = Layout::default();
        layout.add(0);
        let mut state = StoredProject {
            version: 1,
            layout,
            items: HashMap::new(),
        };
        assert!(!state.validate());
        state.items.insert(
            1,
            RetainedItem::Terminal {
                title: "shell".into(),
                runtime: None,
            },
        );
        assert!(state.validate());
    }
}
