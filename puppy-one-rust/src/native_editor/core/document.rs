//! Semantic nodes and lossless source ownership. No parser or UI dependencies.
use super::text::Text;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Style {
    Paragraph,
    Heading(u8),
    Quote,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Item {
    pub checked: Option<bool>,
    pub text: Text,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Kind {
    Text(Style, Text),
    List {
        start: Option<u64>,
        items: Vec<Item>,
    },
    Table {
        align: Vec<String>,
        rows: Vec<Vec<Text>>,
    },
    Code {
        language: String,
        text: Text,
    },
    Raw(Text),
}
impl Kind {
    pub fn texts(&self) -> Vec<&Text> {
        match self {
            Self::Text(_, t) | Self::Code { text: t, .. } | Self::Raw(t) => vec![t],
            Self::List { items, .. } => items.iter().map(|i| &i.text).collect(),
            Self::Table { rows, .. } => rows.iter().flatten().collect(),
        }
    }
    pub fn text_mut(&mut self, index: usize) -> Option<&mut Text> {
        match self {
            Self::Text(_, t) | Self::Code { text: t, .. } | Self::Raw(t) => {
                (index == 0).then_some(t)
            }
            Self::List { items, .. } => items.get_mut(index).map(|i| &mut i.text),
            Self::Table { rows, .. } => rows.iter_mut().flatten().nth(index),
        }
    }
    pub fn rich(&self) -> bool {
        !matches!(self, Self::Raw(_) | Self::Code { .. })
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Block {
    pub leading: String,
    pub(in crate::native_editor) original: String,
    pub(in crate::native_editor) initial: Kind,
    pub kind: Kind,
}
impl Block {
    pub fn new(kind: Kind) -> Self {
        Self {
            leading: "\n\n".into(),
            original: String::new(),
            initial: Kind::Raw(Text::default()),
            kind,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Document {
    pub blocks: Vec<Block>,
    pub(in crate::native_editor) trailing: String,
}
impl Document {
    pub fn raw(source: &str) -> Self {
        let kind = Kind::Raw(Text::plain(source));
        Self {
            blocks: vec![Block {
                leading: String::new(),
                original: source.into(),
                initial: kind.clone(),
                kind,
            }],
            trailing: String::new(),
        }
    }
    pub fn text_mut(&mut self, key: (usize, usize)) -> Option<&mut Text> {
        self.blocks.get_mut(key.0)?.kind.text_mut(key.1)
    }
    pub fn remove_block(&mut self, index: usize) {
        let removed = self.blocks.remove(index);
        // Reference definitions and other parser gaps are not owned by the
        // adjacent rich block and must survive its deletion.
        if let Some(next) = self.blocks.get_mut(index) {
            next.leading = removed.leading + &next.leading;
        } else {
            self.trailing = removed.leading + &self.trailing;
        }
        if self.blocks.is_empty() {
            let trailing = std::mem::take(&mut self.trailing);
            *self = Self::raw(&trailing);
        }
    }
}
