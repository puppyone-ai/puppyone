//! Port of features/create-new/createEntryMenuRegistry.ts. No UI or storage.
use serde::{Deserialize, Serialize};
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Entry {
    Folder,
    Markdown,
    Csv,
    Html,
    Whiteboard,
    ContextMap,
    Text,
    Json,
    Slides,
    App,
    Puppyflow,
    CustomFiles,
}
impl Entry {
    pub const ITEMS: [Self; 10] = [
        Self::Markdown,
        Self::ContextMap,
        Self::Text,
        Self::Json,
        Self::Csv,
        Self::Html,
        Self::Whiteboard,
        Self::Slides,
        Self::App,
        Self::Puppyflow,
    ];
    pub fn label_key(self) -> &'static str {
        match self {
            Self::Folder => "workspace.node.create.kind.folder.label",
            Self::Markdown => "workspace.node.create.kind.markdown.label",
            Self::Csv => "workspace.node.create.kind.csv.label",
            Self::Html => "workspace.node.create.kind.html.label",
            Self::Whiteboard => "workspace.node.create.kind.whiteboard.label",
            Self::ContextMap => "workspace.node.create.kind.contextMap.label",
            Self::Text => "workspace.node.create.kind.text.label",
            Self::Json => "workspace.node.create.kind.json.label",
            Self::Slides => "workspace.node.create.kind.slides.label",
            Self::App => "workspace.node.create.kind.app.label",
            Self::Puppyflow => "workspace.node.create.kind.puppyflow.label",
            Self::CustomFiles => "workspace.node.customFiles",
        }
    }
    pub fn extension(self) -> &'static str {
        match self {
            Self::Markdown => ".md",
            Self::Csv => ".csv",
            Self::Html => ".html",
            Self::Whiteboard => ".excalidraw",
            Self::ContextMap => ".contextmap",
            Self::Text => ".txt",
            Self::Json => ".json",
            Self::Slides | Self::App => ".puppyoneapp",
            Self::Puppyflow => ".puppyflow",
            _ => "",
        }
    }
    /// Admission is a native capability, separate from user menu placement.
    pub fn available(self) -> bool {
        matches!(
            self,
            Self::Folder
                | Self::Markdown
                | Self::Csv
                | Self::Html
                | Self::Whiteboard
                | Self::Text
                | Self::Json
        )
    }
    pub fn initial_text(self) -> &'static str {
        match self {
            Self::Json => "{}\n",
            // `getCreateEntryInitialContent`: an empty board.
            Self::Whiteboard => {
                "{\n  \"type\": \"excalidraw\",\n  \"version\": 2,\n  \"source\": \"https://excalidraw.com\",\n  \"elements\": [],\n  \"appState\": {\n    \"viewBackgroundColor\": \"#ffffff\"\n  },\n  \"files\": {}\n}\n"
            }
            Self::Csv => "Column 1,Column 2,Column 3\n,,\n,,\n",
            Self::Html => {
                "<!doctype html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n  <title>Untitled</title>\n</head>\n<body>\n\n</body>\n</html>\n"
            }
            _ => "",
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Placement {
    Main,
    Submenu,
    Hidden,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct MenuSettings {
    pub main: Vec<Entry>,
    pub submenu: Vec<Entry>,
    pub hidden: Vec<Entry>,
}
impl Default for MenuSettings {
    fn default() -> Self {
        Self {
            main: vec![
                Entry::Markdown,
                Entry::Csv,
                Entry::Html,
                Entry::Whiteboard,
                Entry::CustomFiles,
            ],
            submenu: vec![Entry::ContextMap],
            hidden: vec![
                Entry::Text,
                Entry::Json,
                Entry::Slides,
                Entry::App,
                Entry::Puppyflow,
            ],
        }
    }
}
impl MenuSettings {
    pub fn group(&self, p: Placement) -> &[Entry] {
        match p {
            Placement::Main => &self.main,
            Placement::Submenu => &self.submenu,
            Placement::Hidden => &self.hidden,
        }
    }
    fn group_mut(&mut self, p: Placement) -> &mut Vec<Entry> {
        match p {
            Placement::Main => &mut self.main,
            Placement::Submenu => &mut self.submenu,
            Placement::Hidden => &mut self.hidden,
        }
    }
    pub fn move_entry(&mut self, entry: Entry, target: Placement, index: usize) {
        if entry == Entry::Folder || (entry == Entry::CustomFiles && target != Placement::Main) {
            return;
        }
        let source = [Placement::Main, Placement::Submenu, Placement::Hidden]
            .into_iter()
            .find_map(|p| {
                self.group(p)
                    .iter()
                    .position(|e| *e == entry)
                    .map(|i| (p, i))
            });
        let Some((group, old)) = source else { return };
        self.group_mut(group).remove(old);
        let index = if group == target && old < index {
            index.saturating_sub(1)
        } else {
            index
        };
        let entries = self.group_mut(target);
        entries.insert(index.min(entries.len()), entry);
    }
    pub fn normalize(&mut self) {
        let mut seen = Vec::new();
        for p in [Placement::Main, Placement::Submenu, Placement::Hidden] {
            self.group_mut(p).retain(|e| {
                let valid = *e != Entry::Folder
                    && (*e != Entry::CustomFiles || p == Placement::Main)
                    && !seen.contains(e);
                if valid {
                    seen.push(*e)
                }
                valid
            });
        }
        if !seen.contains(&Entry::CustomFiles) {
            self.main.push(Entry::CustomFiles)
        }
        // A layout saved before an entry existed: Whiteboard joins the main
        // menu before Custom files (v0.4.4); any other new entry is hidden.
        for entry in Entry::ITEMS {
            if !seen.contains(&entry) {
                if entry == Entry::Whiteboard {
                    let at = self.main.iter().position(|e| *e == Entry::CustomFiles);
                    self.main.insert(at.unwrap_or(self.main.len()), entry);
                } else {
                    self.hidden.push(entry)
                }
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn move_preserves_exactly_one_owner_and_fixed_entries() {
        let mut m = MenuSettings::default();
        m.move_entry(Entry::Text, Placement::Main, 0);
        assert_eq!(m.main[0], Entry::Text);
        assert!(!m.hidden.contains(&Entry::Text));
        m.move_entry(Entry::CustomFiles, Placement::Hidden, 0);
        assert!(m.main.contains(&Entry::CustomFiles));
        m.main.push(Entry::Text);
        m.submenu.push(Entry::Folder);
        m.normalize();
        let all = m
            .main
            .iter()
            .chain(&m.submenu)
            .chain(&m.hidden)
            .collect::<Vec<_>>();
        assert_eq!(all.len(), 11);
        assert!(!all.contains(&&Entry::Folder));
    }
    #[test]
    fn a_layout_saved_before_the_whiteboard_offers_it_before_custom_files() {
        let mut saved: MenuSettings = serde_json::from_str(
            r#"{"main":["markdown","customFiles"],"submenu":[],"hidden":["csv"]}"#,
        )
        .unwrap();
        saved.normalize();
        assert_eq!(
            saved.main,
            [Entry::Markdown, Entry::Whiteboard, Entry::CustomFiles]
        );
        assert!(saved.hidden.contains(&Entry::Html));
        assert_eq!(MenuSettings::default().main[3], Entry::Whiteboard);
        // The empty board the product writes.
        let board: serde_json::Value =
            serde_json::from_str(Entry::Whiteboard.initial_text()).unwrap();
        assert_eq!(board["type"], "excalidraw");
        assert_eq!(board["version"], 2);
        assert_eq!(board["elements"], serde_json::json!([]));
        assert_eq!(board["files"], serde_json::json!({}));
        assert!(board["appState"]["viewBackgroundColor"].is_string());
    }
}
