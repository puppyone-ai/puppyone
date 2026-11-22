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
