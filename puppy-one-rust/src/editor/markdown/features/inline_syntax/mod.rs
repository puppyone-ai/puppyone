//! Inline syntax feature slice (product `features/inline-syntax/`):
//! `==highlight==`, `%%comment%%`, and `:shortcode:` emoji recognition.
pub mod syntax;

use crate::editor::{
    markdown::core::{
        features::MarkdownFeature,
        syntax::{Element, Syntax},
    },
    text::buffer::Buffer,
};
use std::ops::Range;

pub struct InlineSyntaxFeature;
pub static FEATURE: InlineSyntaxFeature = InlineSyntaxFeature;
pub const ID: &str = "inline-syntax";

impl MarkdownFeature for InlineSyntaxFeature {
    fn id(&self) -> &'static str {
        ID
    }

    fn recognize_inline(&self, line_start: usize, line_text: &str, out: &mut Vec<Element>) {
        syntax::recognize_line(line_start, line_text, out);
    }

    fn collect_range(
        &self,
        doc: &Buffer,
        syntax: &Syntax,
        window: Range<usize>,
        out: &mut Vec<Element>,
    ) {
        syntax::collect_emoji_in_range(doc, syntax, window, out);
    }
}

#[cfg(test)]
mod tests {
    use super::FEATURE;
    use crate::editor::{
        markdown::core::{
            features::MarkdownFeature,
            syntax::{Kind, Syntax},
        },
        text::buffer::Buffer,
    };
    use core::prelude::v1::test;

    /// O-6: the product's inline projections — bare URLs are links, a single
    /// `~` strikes, `==` highlights, comments, link definitions, shortcodes and
    /// entities, and reference links open their definition.
    #[test]
    fn inline_syntax_projects_like_the_product() {
        static F: &[&dyn MarkdownFeature] = &[&FEATURE];
        let parse = |text: &str| {
            let doc = Buffer::new(text);
            let s = Syntax::parse_with(&doc, F);
            (doc, s)
        };
        let text = "see www.x.org and ~gone~ ==hot== %%note%% :smile: &amp; [r][d]\n\n[d]: https://d.example\n";
        let (_, s) = parse(text);
        let find = |kind: Kind| s.elements.iter().find(|e| e.kind == kind).unwrap();
        let bare = s
            .elements
            .iter()
            .find(|e| e.kind == Kind::Link && e.markers.is_empty())
            .unwrap();
        assert_eq!(&text[bare.range.clone()], "www.x.org");
        assert_eq!(bare.href.as_deref(), Some("https://www.x.org"));
        let strike = find(Kind::Strike);
        assert_eq!(&text[strike.content.clone().unwrap()], "gone");
        let highlight = find(Kind::Highlight);
        assert_eq!(&text[highlight.content.clone().unwrap()], "hot");
        assert_eq!(&text[find(Kind::Comment).range.clone()], "%%note%%");
        assert_eq!(find(Kind::Emoji).text.as_deref(), Some("😄"));
        let entity = find(Kind::Entity);
        assert_eq!(
            (&text[entity.range.clone()], entity.text.as_deref()),
            ("&amp;", Some("&"))
        );
        let reference = s
            .elements
            .iter()
            .find(|e| e.kind == Kind::Link && e.range.start == text.find("[r]").unwrap())
            .unwrap();
        assert_eq!(reference.href.as_deref(), Some("https://d.example"));
        let definition = find(Kind::LinkDefinition);
        assert_eq!(&text[definition.content.clone().unwrap()], "d");
        // Code keeps its source; a spaced single tilde is no strike.
        let (_, s) = parse("`==x==` ~a b~ <!-- c -->");
        assert!(!s.elements.iter().any(|e| e.kind == Kind::Highlight));
        assert!(!s.elements.iter().any(|e| e.kind == Kind::Strike));
        assert!(s.elements.iter().any(|e| e.kind == Kind::Comment));
    }
}
