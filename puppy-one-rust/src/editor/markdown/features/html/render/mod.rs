//! `.cm-md-html-rendered-surface` (`markdown-content.css`): renders sanitized
//! HTML DOM subtrees into GPUI elements with the product's prose roles, owned
//! by `features/html` and exposed to sibling features (such as MDX `<Tabs>`)
//! solely through `composition::preview` and the `shared::preview` port
//! (`MA-07`, `MA-12`, `R5`, `R13`).
mod blocks;
mod inline;
mod media;

#[cfg(test)]
pub(crate) use inline::resolved_strong_weight;
pub use media::{best_candidate, html_image_dimensions, serialize};

use super::sanitize::{Element, MAX_HTML_DEPTH, Node};
use crate::editor::{
    markdown::style::MarkdownTheme,
    registry::DocumentAssets,
    tokens::{Tokens, parse_css_color},
    view::{editor::EditorView, render::RenderCx, style::TextStyle, widget::BlockId},
};
use gpui::{prelude::*, *};
use std::path::Path;

/// Inherited text and inline decoration attributes of a DOM subtree.
#[derive(Clone)]
pub(super) struct Inherit {
    pub text: TextStyle,
    pub align: TextAlign,
    pub link: Option<String>,
    pub mono: bool,
    pub background: Option<Rgba>,
    pub underline: bool,
    pub strike: bool,
}

/// Inline formatting run or atom inside an inline formatting context.
pub(super) enum Piece {
    Text(String, Inherit),
    Break,
    Atom(AnyElement),
}

pub struct Surface<'s, 'r, 'a> {
    pub theme: &'s MarkdownTheme,
    pub document: &'s Path,
    pub assets: Option<&'s DocumentAssets>,
    pub view: WeakEntity<EditorView>,
    /// Stable view-scoped block identity for per-pane sessions (`disclosure`).
    pub block_id: BlockId,
    /// Block source start offset for element IDs and media player keys.
    pub block: usize,
    pub render: &'r mut RenderCx<'a>,
    pub(super) details: usize,
    pub(super) ids: usize,
    pub(super) media: usize,
}

pub(super) fn heading_level(tag: &str) -> Option<usize> {
    let b = tag.as_bytes();
    (b.len() == 2 && b[0] == b'h' && (b'1'..=b'6').contains(&b[1])).then(|| (b[1] - b'0') as usize)
}

pub(super) fn is_block(tag: &str) -> bool {
    heading_level(tag).is_some()
        || matches!(
            tag,
            "address"
                | "article"
                | "aside"
                | "blockquote"
                | "center"
                | "dd"
                | "details"
                | "div"
                | "dl"
                | "dt"
                | "fieldset"
                | "figcaption"
                | "figure"
                | "footer"
                | "header"
                | "hgroup"
                | "hr"
                | "li"
                | "main"
                | "nav"
                | "ol"
                | "p"
                | "pre"
                | "section"
                | "summary"
                | "table"
                | "ul"
                | "video"
                | "audio"
        )
}

pub(super) fn align_of(e: &Element, inherited: TextAlign) -> TextAlign {
    let style_align = e.attribute("style").and_then(|s| {
        s.split(';').find_map(|d| {
            let (k, v) = d.split_once(':')?;
            (k.trim().eq_ignore_ascii_case("text-align")).then(|| v.trim().to_ascii_lowercase())
        })
    });
    let value = style_align.or_else(|| e.attribute("align").map(str::to_ascii_lowercase));
    match value.as_deref() {
        Some("center") => TextAlign::Center,
        Some("right") => TextAlign::Right,
        Some("left") => TextAlign::Left,
        _ if e.tag == "center" => TextAlign::Center,
        _ => inherited,
    }
}

pub(super) fn style_color(e: &Element, property: &str) -> Option<Rgba> {
    let style = e.attribute("style")?;
    style.split(';').find_map(|d| {
        let (k, v) = d.split_once(':')?;
        if k.trim().eq_ignore_ascii_case(property) {
            parse_css_color(v)
        } else {
            None
        }
    })
}

impl<'s, 'r, 'a> Surface<'s, 'r, 'a> {
    pub fn new(
        theme: &'s MarkdownTheme,
        document: &'s Path,
        assets: Option<&'s DocumentAssets>,
        view: WeakEntity<EditorView>,
        block_id: BlockId,
        block: usize,
        render: &'r mut RenderCx<'a>,
    ) -> Self {
        Self {
            theme,
            document,
            assets,
            view,
            block_id,
            block,
            render,
            details: 0,
            ids: 0,
            media: 0,
        }
    }

    pub(super) fn id(&mut self, part: &'static str) -> ElementId {
        self.ids += 1;
        ElementId::NamedInteger(part.into(), (self.block as u64) << 20 | self.ids as u64)
    }

    pub(super) fn tokens(&self) -> &'static Tokens {
        Tokens::get(self.theme.dark, self.theme.scale)
    }

    /// Renders `nodes` into a vertical column of `width`.
    pub fn render(&mut self, nodes: &[Node], width: f32) -> AnyElement {
        let base = Inherit {
            text: self.theme.body.text.clone(),
            align: TextAlign::Left,
            link: None,
            mono: false,
            background: None,
            underline: false,
            strike: false,
        };
        let children = self.flow(nodes, &base, width, 0);
        let mut root = div()
            .debug_selector(|| "md-html-rendered-surface".into())
            .w(px(width))
            .flex()
            .flex_col();
        base.text.apply(root.style());
        root.children(children).into_any_element()
    }

    /// Renders block children in order, grouping runs of inline nodes into flows.
    /// Recursion is bounded by `MAX_HTML_DEPTH` (`TA-51`).
    pub(super) fn flow(
        &mut self,
        nodes: &[Node],
        inherit: &Inherit,
        width: f32,
        depth: usize,
    ) -> Vec<AnyElement> {
        if depth >= MAX_HTML_DEPTH {
            return Vec::new();
        }
        let mut out = Vec::new();
        let mut inline: Vec<Piece> = Vec::new();
        for node in nodes {
            match node {
                Node::Element(e) if is_block(&e.tag) => {
                    if !inline.is_empty() {
                        out.push(self.inline_flow(std::mem::take(&mut inline), inherit));
                    }
                    out.push(self.block_element(e, inherit, width, depth + 1));
                }
                _ => self.inline(node, inherit, &mut inline, width, depth + 1),
            }
        }
        if !inline.is_empty() {
            out.push(self.inline_flow(inline, inherit));
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use core::prelude::v1::test;

    /// `markdownHtmlConformance.test.ts`: `normalizes conventional README
    /// align attributes into safe presentation`; `reduces invalid legacy
    /// align values without changing block classification`.
    #[test]
    fn readme_align_attributes_become_alignment_and_invalid_ones_inherit() {
        use super::{Element, TextAlign, align_of};
        let element = |tag: &str, align: &str| Element {
            tag: tag.into(),
            attributes: vec![("align".into(), align.into())],
            children: vec![],
        };
        assert!(matches!(
            align_of(&element("div", "center"), TextAlign::Left),
            TextAlign::Center
        ));
        assert!(matches!(
            align_of(&element("p", "right"), TextAlign::Left),
            TextAlign::Right
        ));
        assert!(matches!(
            align_of(&element("div", "sideways"), TextAlign::Left),
            TextAlign::Left
        ));
        assert!(matches!(
            align_of(&element("div", "sideways"), TextAlign::Center),
            TextAlign::Center
        ));
    }
}
