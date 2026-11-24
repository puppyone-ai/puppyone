//! HTML block model and admission policy (`htmlBlockModel.ts`, `MA-04`: zero `gpui`).
use super::super::sanitize::{Node, has_blocked_root};
use crate::editor::markdown::platform::brokers::link::safe_href;
use std::ops::Range;

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub struct HtmlBlock {
    /// Whole source lines.
    pub range: Range<usize>,
    /// The HTML the surface renders.
    pub html: String,
    /// The page a lone `<iframe>` asks for.
    pub embed: Option<String>,
    /// Over the rich budget but within the deferred one: a card asks before
    /// the surface renders (`Large HTML preview is paused.`).
    pub deferred: bool,
}

/// Render a deferred block (the card's button).
#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub struct RenderDeferred(pub usize);

/// What `source` costs to render (`estimateHtmlBlockMetrics`): elements,
/// deepest nesting and media assets.
pub fn metrics(source: &str) -> (usize, usize, usize) {
    use super::super::tokenizer::{Token, tokens};
    let mut stack: Vec<String> = Vec::new();
    let (mut elements, mut depth, mut assets) = (0usize, 0usize, 0usize);
    for token in tokens(source).unwrap_or_default() {
        match token {
            Token::Close(tag) => {
                if let Some(i) = stack.iter().rposition(|t| *t == tag) {
                    stack.truncate(i);
                }
            }
            Token::Open { tag, void, .. } => {
                elements += 1;
                if matches!(tag.as_str(), "img" | "video" | "audio" | "source") {
                    assets += 1;
                }
                if !void {
                    stack.push(tag);
                    depth = depth.max(stack.len());
                }
            }
            Token::Text(_) => {}
        }
    }
    (elements * 2 + 1, depth, assets)
}

/// Reveal the block's source (the toolbar toggle).
#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub struct ShowSource(pub Range<usize>);

/// A reduced nested element cannot grant link navigation or hide a forbidden root.
pub fn admission_failure(html: &str, nodes: &[Node]) -> Option<&'static str> {
    if has_blocked_root(html) {
        return Some("htmlBlock.blocked-tag");
    }
    let mut pending: Vec<_> = nodes.iter().collect();
    while let Some(node) = pending.pop() {
        if let Node::Element(element) = node {
            if element.tag == "a"
                && let Some(href) = element.attribute("href")
                && safe_href(href).is_none()
            {
                return Some("htmlBlock.unsafe-href");
            }
            pending.extend(&element.children);
        }
    }
    None
}
