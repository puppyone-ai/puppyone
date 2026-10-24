//! The Markdown presentation contract, one typed style per element type.
//! Every value is a product token (`--po-md-*`, editor/tokens.rs) resolved
//! for one appearance and text scale; lengths the product gives in `em` are
//! resolved against the font size of the element that consumes them.
//!
//! Core element styles live here (surface, body, heading, inline, quote,
//! list, block chrome); each feature owns its own style next to its widget
//! (`features/*/style.rs`). `cascade` applies the product's line CSS in
//! cascade order; `marks` maps inline classes onto Kit marks. To restyle one
//! element type, change its style module and the rules that read it.
mod block;
mod blockquote;
mod body;
pub mod cascade;
mod heading;
mod inline;
mod list;
pub mod marks;
mod surface;

pub use block::BlockStyle;
pub use blockquote::QuoteStyle;
pub use body::BodyStyle;
#[allow(unused_imports)]
pub use heading::{HeadingLevel, HeadingStyle};
pub use inline::InlineStyle;
pub use list::ListStyle;
pub use surface::SurfaceStyle;

use crate::{
    editor::{
        markdown::features::{code_block::style::CodeBlockStyle, rule::style::RuleStyle, table::style::TableStyle, task::style::TaskStyle},
        tokens::Tokens,
    },
    typography::Scale,
};

#[derive(Clone, Debug, PartialEq)]
pub struct MarkdownTheme {
    pub dark: bool,
    pub scale: Scale,
    pub surface: SurfaceStyle,
    pub body: BodyStyle,
    pub heading: HeadingStyle,
    pub inline: InlineStyle,
    pub quote: QuoteStyle,
    pub list: ListStyle,
    pub block: BlockStyle,
    pub task: TaskStyle,
    pub code_block: CodeBlockStyle,
    pub table: TableStyle,
    pub rule: RuleStyle,
}

impl MarkdownTheme {
    pub fn resolve(dark: bool, scale: Scale) -> Self {
        let t = Tokens::get(dark, scale);
        let size = t.len("--po-md-content-size", 16.);
        Self {
            dark,
            scale,
            surface: SurfaceStyle::resolve(t, size),
            body: BodyStyle::resolve(t, size),
            heading: HeadingStyle::resolve(t, size),
            inline: InlineStyle::resolve(t, size),
            quote: QuoteStyle::resolve(t, size),
            list: ListStyle::resolve(t, size),
            block: BlockStyle::resolve(t, size),
            task: TaskStyle::resolve(t, size),
            code_block: CodeBlockStyle::resolve(t, size),
            table: TableStyle::resolve(t, size),
            rule: RuleStyle::resolve(t, size),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::editor::view::style::{Align, Edges};

    #[test]
    fn resolves_the_measured_reference_geometry() {
        let t = MarkdownTheme::resolve(true, Scale::Medium);
        assert_eq!(t.body.text.size, 15.);
        assert!((t.body.text.line_height_px() - 26.25).abs() < 1e-4);
        assert!((t.body.source_line_gap - 3.75).abs() < 1e-4);
        let h1 = t.heading.level(1);
        assert_eq!((h1.size, h1.weight, h1.gap_before, h1.gap_after), (30., 650., 16., 10.));
        assert_eq!(t.heading.level(2).weight, 625.);
        // List rail at 15px: inset .25em + slot 1.25em + gap .375em.
        assert!((t.list.inset + t.list.marker_width + t.list.marker_gap - 28.125).abs() < 1e-4);
        assert!((t.list.indent_step - 22.5).abs() < 1e-4);
        assert_eq!(t.code_block.padding, Edges::new(12., 14., 12., 14.));
        assert_eq!(t.code_block.line_height, 20.);
        assert_eq!(t.inline.code_size, None);
        assert_eq!(t.list.ordered_align, Align::End);
        assert_eq!(t.block.selected_ring.a, 0.3);
        assert_eq!(MarkdownTheme::resolve(false, Scale::Large).body.text.size, 16.);
    }
}
