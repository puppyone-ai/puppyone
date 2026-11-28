//! Footnotes feature slice (product `features/footnote/footnoteFeature.ts`):
//! `[^id]:` opening a paragraph or link reference definition defines a note,
//! and `[^id]` elsewhere refers to it.
pub mod model;
pub mod syntax;

use crate::editor::{
    markdown::core::{
        features::MarkdownFeature,
        syntax::{Element, Syntax},
    },
    text::buffer::Buffer,
};
use std::ops::Range;

pub struct FootnoteFeature;
pub static FEATURE: FootnoteFeature = FootnoteFeature;
pub const ID: &str = "footnote";

impl MarkdownFeature for FootnoteFeature {
    fn id(&self) -> &'static str {
        ID
    }

    fn collect_range(
        &self,
        doc: &Buffer,
        syntax: &Syntax,
        window: Range<usize>,
        out: &mut Vec<Element>,
    ) {
        model::collect_footnotes_in_range(doc, syntax, window, out);
    }
}
