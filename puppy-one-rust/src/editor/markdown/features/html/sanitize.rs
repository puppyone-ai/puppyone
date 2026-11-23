//! Sanitized HTML DOM tree types and policy-driven sanitization helpers
//! (`features/html/sanitize.rs`, TS `sanitizeHtml.ts`).
//!
//! Executable and embedding tag rules (`BLOCKED_TAGS`, `DROPPED_WITH_CONTENT`,
//! `MAX_HTML_DEPTH`) are sourced from `platform::policy` (`MA-14`).
use super::tokenizer::{Token, tokens};
pub use crate::editor::markdown::platform::policy::{
    BLOCKED_TAGS, DROPPED_WITH_CONTENT, MAX_HTML_DEPTH, is_blocked_tag,
};
use std::hash::{Hash, Hasher};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Node {
    Element(Element),
    Text(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Element {
    pub tag: String,
    pub attributes: Vec<(String, String)>,
    pub children: Vec<Node>,
}

impl Element {
    pub fn attribute(&self, name: &str) -> Option<&str> {
        self.attributes
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, v)| v.as_str())
    }

    /// Plain text of the subtree, collected iteratively so arbitrarily deep
    /// synthetic trees never overflow the call stack.
    pub fn text(&self) -> String {
        let mut out = String::new();
        let mut stack: Vec<&Node> = self.children.iter().rev().collect();
        while let Some(node) = stack.pop() {
            match node {
                Node::Text(t) => out.push_str(t),
                Node::Element(e) => stack.extend(e.children.iter().rev()),
            }
        }
        out
    }
}

/// Hashes `nodes` iteratively without recursive `Debug` formatting.
pub fn hash_nodes(nodes: &[Node], hasher: &mut impl Hasher) {
    let mut stack: Vec<(&Node, usize)> = nodes.iter().rev().map(|n| (n, 0)).collect();
    while let Some((node, depth)) = stack.pop() {
        depth.hash(hasher);
        match node {
            Node::Text(text) => {
                0u8.hash(hasher);
                text.hash(hasher);
            }
            Node::Element(el) => {
                1u8.hash(hasher);
                el.tag.hash(hasher);
                el.attributes.hash(hasher);
                el.children.len().hash(hasher);
                if depth < MAX_HTML_DEPTH {
                    stack.extend(el.children.iter().rev().map(|c| (c, depth + 1)));
                }
            }
        }
    }
}

/// Strips inline `on*` event handler attributes and presentation values the
/// policy omits (`align`, `width`, `valign`, `type`, `media`, ...) during DOM
/// sanitization; the element stays.
pub(crate) fn sanitize_attributes(
    tag: &str,
    attributes: Vec<(String, String)>,
) -> Vec<(String, String)> {
    use crate::editor::markdown::platform::policy::presentation::presentation_attribute;
    let mut kept: Vec<(String, String)> = attributes
        .into_iter()
        .filter(|(n, _)| !n.starts_with("on"))
        .filter_map(|(n, v)| presentation_attribute(tag, &n, &v).map(|v| (n, v)))
        .collect();
    // A legacy named anchor shares the id namespace; an explicit id wins.
    if tag == "a"
        && !kept.iter().any(|(n, _)| n == "id")
        && let Some(i) = kept.iter().position(|(n, _)| n == "name")
    {
        let (_, value) = kept.remove(i);
        kept.push(("id".into(), value));
    }
    kept
}

/// Inspect authored roots before sanitization drops executable elements.
/// Callers validate structure first; nested blocked payloads remain reducible.
pub fn has_blocked_root(source: &str) -> bool {
    let Some(tokens) = tokens(source) else {
        return false;
    };
    let mut depth = 0usize;
    for token in tokens {
        match token {
            Token::Open { tag, void, .. } => {
                if depth == 0 && is_blocked_tag(&tag) {
                    return true;
                }
                if !void {
                    depth += 1;
                }
            }
            Token::Close(_) => depth = depth.saturating_sub(1),
            Token::Text(_) => {}
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::super::structure::{Parsed, parse};
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn void_and_self_closing_blocked_tags_are_filtered() {
        let html = concat!(
            "<div>",
            "<embed src=\"x.swf\"/>",
            "<embed src=\"x.swf\">",
            "<base href=\"https://evil.example/\"/>",
            "<base href=\"https://evil.example/\">",
            "<link rel=\"stylesheet\" href=\"https://evil.example/x.css\"/>",
            "<meta http-equiv=\"refresh\" content=\"0;url=https://evil.example\"/>",
            "<input type=\"text\" value=\"secret\"/>",
            "<script src=\"x.js\"/>",
            "<iframe src=\"https://evil.example\"/>",
            "<p>safe<br/></p>",
            "</div>"
        );
        let Parsed::Complete(nodes) = parse(html) else {
            panic!("expected complete parse");
        };
        let Node::Element(root) = &nodes[0] else {
            panic!("expected root div");
        };
        assert_eq!(
            root.children.len(),
            1,
            "all blocked void/self-closing tags dropped: {root:?}"
        );
        let Node::Element(p) = &root.children[0] else {
            panic!("expected <p>");
        };
        assert_eq!(p.tag, "p");
        assert_eq!(p.text(), "safe");
    }

    #[test]
    fn deeply_nested_html_is_bounded_without_stack_overflow() {
        let deep = format!("{}leaf{}", "<div>".repeat(200), "</div>".repeat(200));
        assert_eq!(parse(&deep), Parsed::Unsupported);

        let within_cap = format!(
            "{}leaf{}",
            "<div>".repeat(MAX_HTML_DEPTH),
            "</div>".repeat(MAX_HTML_DEPTH)
        );
        assert!(matches!(parse(&within_cap), Parsed::Complete(_)));
    }

    #[test]
    fn html_policy_blocks_void_and_self_closing_tags_and_deep_trees() {
        for snippet in [
            "<div><embed src=\"a.swf\"/></div>",
            "<div><base href=\"https://evil.test/\"/></div>",
            "<div><link rel=\"stylesheet\" href=\"x.css\"/></div>",
            "<div><meta charset=\"utf-8\"/></div>",
            "<div><input value=\"x\"/></div>",
        ] {
            let Parsed::Complete(nodes) = parse(snippet) else {
                panic!("expected complete parse for {snippet}");
            };
            let Node::Element(div) = &nodes[0] else {
                panic!("expected div");
            };
            assert!(
                div.children.is_empty(),
                "blocked tag survived in {snippet}: {div:?}"
            );
        }

        let deep = format!("{}ok{}", "<div>".repeat(200), "</div>".repeat(200));
        assert_eq!(parse(&deep), Parsed::Unsupported);
    }
}
