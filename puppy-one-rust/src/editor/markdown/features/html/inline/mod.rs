//! Inline HTML pairing and policy (`features/html/inline/`, product
//! `features/html/inlineHtmlModel.ts`): an opening tag the `inline-editable`
//! profile allows and its closing tag in the same paragraph/heading/table cell
//! style their content as the element would, and the tags hide like Markdown
//! delimiters. Anything else stays source.
pub mod model;

use crate::editor::{
    markdown::core::syntax::{Element, Syntax},
    text::buffer::Buffer,
};
use std::ops::Range;

pub fn collect_range(doc: &Buffer, syntax: &Syntax, window: Range<usize>, out: &mut Vec<Element>) {
    out.extend(model::elements_in_window(doc, syntax, window));
}
