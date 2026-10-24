//! Immutable user-selected reference snapshots. Providers cannot redirect their source paths.
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum ReferenceContent {
    Text(String),
    Image { mime: String, data: String },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Reference {
    pub id: String,
    pub name: String,
    pub source: String,
    pub content: ReferenceContent,
    pub bytes: usize,
}
#[derive(Clone, Debug, Default)]
pub struct Prompt {
    pub text: String,
    pub references: Vec<Reference>,
}
impl Prompt {
    pub fn text(text: String) -> Self {
        Self {
            text,
            references: vec![],
        }
    }
    pub fn display(&self) -> String {
        let names = self
            .references
            .iter()
            .map(|r| format!("📎 {}", r.name))
            .collect::<Vec<_>>()
            .join("\n");
        if names.is_empty() {
            self.text.clone()
        } else {
            format!("{}\n\n{}", self.text, names)
        }
    }
    pub fn text_with_references(&self) -> String {
        let mut out = self.text.clone();
        for r in &self.references {
            if let ReferenceContent::Text(text) = &r.content {
                out.push_str(&format!(
                    "\n\n<reference name={:?} source={:?}>\n{}\n</reference>",
                    r.name, r.source, text
                ));
            }
        }
        out
    }
}
