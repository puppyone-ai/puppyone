//! Front matter (product features/front-matter): YAML metadata between
//! `---` lines at the very top reads as a table of keys and values. Its
//! source stays one click away: the table's source toggle shows the block
//! as source lines, with the caret on the first key, until the caret
//! leaves them.
mod widget;

use crate::editor::{
    markdown::core::{
        decorations::BlockDecoration,
        feature::{CompileCx, MarkdownFeature, WidgetFactoryCx},
        plans::{BlockEmbed, Plan, Presentation},
        state::PreviewState,
    },
    text::{
        buffer::Buffer,
        selection::Selection,
        state::{EditorState, Transaction},
    },
    view::{command::Command, widget::BlockWidget},
};
use std::{ops::Range, rc::Rc};
use widget::FrontMatterWidget;

pub struct FrontMatterFeature;
pub static FEATURE: FrontMatterFeature = FrontMatterFeature;
pub const ID: &str = "front-matter";
/// `FRONT_MATTER_MAX_LINES`.
const MAX_LINES: usize = 256;

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub struct FrontMatter {
    pub range: Range<usize>,
    pub entries: Vec<(String, String)>,
}

/// Show the block's source (the toolbar toggle).
#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub struct ShowSource(pub Range<usize>);

/// `parseMarkdownFrontMatter`: `key: value` lines; nested values and list
/// items continue their key; quotes around a value go.
pub fn entries(source: &str) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    for line in source.split('\n') {
        let pair = line.split_once(':').filter(|(key, _)| {
            key.chars()
                .next()
                .is_some_and(|c| !c.is_whitespace() && c != ':' && c != '#')
        });
        match pair {
            Some((key, value)) => {
                let value = value.trim();
                let unquoted = ['"', '\'']
                    .iter()
                    .find(|q| value.len() >= 2 && value.starts_with(**q) && value.ends_with(**q))
                    .map_or(value, |_| &value[1..value.len() - 1]);
                out.push((key.trim().to_owned(), unquoted.to_owned()));
            }
            None if !line.trim().is_empty() => {
                if let Some(last) = out.last_mut() {
                    let item = line.trim().trim_start_matches('-').trim_start();
                    last.1 = [last.1.as_str(), item]
                        .into_iter()
                        .filter(|s| !s.is_empty())
                        .collect::<Vec<_>>()
                        .join(", ");
                }
            }
            None => {}
        }
    }
    out
}
/// `getMarkdownFrontMatterEndLine`.
fn front_matter(doc: &Buffer) -> Option<FrontMatter> {
    if doc.line_count() < 2 || doc.line(0).trim_end() != "---" {
        return None;
    }
    let close = (1..doc.line_count().min(MAX_LINES)).find(|&l| doc.line(l).trim_end() == "---")?;
    // The metadata lines between the `---` lines.
    let content = doc.line_range(0).end + 1..doc.line_range(close).start.saturating_sub(1);
    let entries = entries(doc.slice(content.start..content.end.max(content.start)));
    (!entries.is_empty()).then(|| FrontMatter {
        range: 0..doc.line_range(close).end,
        entries,
    })
}

impl MarkdownFeature for FrontMatterFeature {
    fn id(&self) -> &'static str {
        ID
    }

    fn compile_blocks(&self, cx: &CompileCx, out: &mut Vec<Plan>) {
        if let Some(block) = front_matter(cx.doc) {
            out.push(Plan {
                element: None,
                source: block.range.clone(),
                presentation: Presentation::BlockAtom(BlockEmbed::new(ID, block)),
                delete_units: Vec::new(),
            });
        }
    }

    fn block_widget(
        &self,
        embed: &BlockEmbed,
        cx: &WidgetFactoryCx,
    ) -> Option<Rc<dyn BlockWidget>> {
        Some(Rc::new(FrontMatterWidget::new(
            embed.model::<FrontMatter>()?,
            cx.theme,
        )))
    }

    /// The block is one caret position while the table shows.
    fn decorate_block(&self, embed: &BlockEmbed, cx: &mut BlockDecoration) {
        if let Some(block) = embed.model::<FrontMatter>() {
            cx.atomic(block.range.clone());
        }
    }

    /// `markdownRevealedSourceEffect` with the caret after the opening
    /// `---` and its line break.
    fn view_command(
        &self,
        command: &Command,
        preview: &mut PreviewState,
        state: &EditorState,
    ) -> Option<Transaction> {
        let ShowSource(range) = command.payload::<ShowSource>()?;
        let range = range.start..range.end.min(state.doc.len());
        preview.revealed_source = Some(range.clone());
        Some(Transaction::select(Selection::cursor(
            (range.start + 4).min(range.end),
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn metadata_at_the_top_reads_as_a_table() {
        let doc = Buffer::new("---\ntitle: \"Plan\"\ntags:\n  - a\n  - b\n---\n# Body\n");
        let block = front_matter(&doc).unwrap();
        assert_eq!(
            block.entries,
            vec![
                ("title".to_owned(), "Plan".to_owned()),
                ("tags".to_owned(), "a, b".to_owned())
            ]
        );
        assert_eq!(
            &doc.as_str()[block.range.clone()],
            "---\ntitle: \"Plan\"\ntags:\n  - a\n  - b\n---"
        );
        // Only at the very top, and only with something to show.
        assert!(front_matter(&Buffer::new("x\n---\na: b\n---\n")).is_none());
        assert!(front_matter(&Buffer::new("---\n\n---\n")).is_none());
    }
}
