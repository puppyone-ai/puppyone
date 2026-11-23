//! Strict authored HTML block structure validation and cross-block flow
//! pairing (`features/html/structure.rs`, TS `htmlBlockStructure.ts`).
//!
//! A block renders only when its tags nest strictly as authored — anything a
//! browser would repair stays visible source.
use super::{
    sanitize::{
        BLOCKED_TAGS, DROPPED_WITH_CONTENT, Element, MAX_HTML_DEPTH, Node, sanitize_attributes,
    },
    tokenizer::{Token, tokens},
};

/// `P_IMPLICIT_CLOSE_START_TAGS`.
const CLOSES_P: &[&str] = &[
    "address",
    "article",
    "aside",
    "blockquote",
    "div",
    "dl",
    "fieldset",
    "footer",
    "form",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "hgroup",
    "hr",
    "main",
    "menu",
    "nav",
    "ol",
    "p",
    "pre",
    "section",
    "table",
    "ul",
];

/// `MarkdownHtmlBlockStatus`.
#[derive(Debug, PartialEq, Eq)]
pub enum Parsed {
    Complete(Vec<Node>),
    /// An element is still open (a cross-block flow may close it later).
    /// An empty stack denotes an unfinished special construct, not a flow.
    Incomplete(Vec<String>),
    Malformed,
    /// A comment, declaration, processing instruction, or depth-exceeded block.
    Unsupported,
}

fn repairs(parent: &str, child: &str) -> bool {
    let heading = |t: &str| t.len() == 2 && t.starts_with('h') && t.as_bytes()[1].is_ascii_digit();
    (parent == "p" && CLOSES_P.contains(&child))
        || (parent == "li" && child == "li")
        || (matches!(parent, "dt" | "dd") && matches!(child, "dt" | "dd"))
        || (parent == "tr" && child == "tr")
        || (matches!(parent, "td" | "th") && matches!(child, "td" | "th"))
        || (heading(parent) && heading(child))
        || (parent == "a" && child == "a")
}

fn invalid_table_child(parent: &str, child: &str) -> bool {
    match parent {
        "table" => !matches!(
            child,
            "caption" | "col" | "colgroup" | "thead" | "tbody" | "tfoot" | "tr"
        ),
        "thead" | "tbody" | "tfoot" => child != "tr",
        "tr" => !matches!(child, "td" | "th"),
        _ => false,
    }
}

/// `validateMarkdownHtmlBlockStructure` and the sanitized element tree it accepts.
pub fn parse(source: &str) -> Parsed {
    let trimmed = source.trim_start();
    if trimmed.starts_with("<!") || trimmed.starts_with("<?") {
        let closing = if trimmed.starts_with("<!--") {
            "-->"
        } else if trimmed.starts_with("<![CDATA[") {
            "]]>"
        } else if trimmed.starts_with("<?") {
            "?>"
        } else {
            ">"
        };
        return if trimmed.contains(closing) {
            Parsed::Unsupported
        } else {
            Parsed::Incomplete(Vec::new())
        };
    }
    let Some(tokens) = tokens(source) else {
        return Parsed::Malformed;
    };
    if !tokens.iter().any(|t| matches!(t, Token::Open { .. })) {
        return Parsed::Malformed;
    }
    let mut stack: Vec<Element> = vec![Element {
        tag: String::new(),
        attributes: Vec::new(),
        children: Vec::new(),
    }];
    for token in tokens {
        let parent = stack.last().map(|e| e.tag.clone()).unwrap_or_default();
        match token {
            Token::Text(text) => {
                if matches!(
                    parent.as_str(),
                    "table" | "thead" | "tbody" | "tfoot" | "tr"
                ) && !text.trim().is_empty()
                {
                    return Parsed::Malformed;
                }
                stack.last_mut().unwrap().children.push(Node::Text(text));
            }
            Token::Open {
                tag,
                attributes,
                void,
            } => {
                if repairs(&parent, &tag) || invalid_table_child(&parent, &tag) {
                    return Parsed::Malformed;
                }
                // `stack` holds 1 synthetic root + currently open ancestors.
                // Opening one more element brings nesting depth to `stack.len()`.
                if stack.len() > MAX_HTML_DEPTH {
                    return Parsed::Unsupported;
                }
                let element = Element {
                    attributes: sanitize_attributes(&tag, attributes),
                    tag,
                    children: Vec::new(),
                };
                if void {
                    if !BLOCKED_TAGS.contains(&element.tag.as_str()) {
                        stack
                            .last_mut()
                            .unwrap()
                            .children
                            .push(Node::Element(element));
                    }
                } else {
                    stack.push(element);
                }
            }
            Token::Close(tag) => {
                if stack.len() < 2 || stack.last().is_none_or(|e| e.tag != tag) {
                    return Parsed::Malformed;
                }
                let element = stack.pop().unwrap();
                let parent = &mut stack.last_mut().unwrap().children;
                if !BLOCKED_TAGS.contains(&element.tag.as_str()) {
                    parent.push(Node::Element(element));
                } else if !DROPPED_WITH_CONTENT.contains(&element.tag.as_str()) {
                    parent.extend(element.children);
                }
            }
        }
    }
    if stack.len() > 1 {
        return Parsed::Incomplete(stack[1..].iter().map(|e| e.tag.clone()).collect());
    }
    Parsed::Complete(stack.pop().unwrap().children)
}

/// Open tag balance across a cross-block HTML flow (`None` when mismatched or
/// deeper than `MAX_HTML_DEPTH`).
pub fn balance(source: &str, mut open: Vec<String>) -> Option<Vec<String>> {
    for token in tokens(source)? {
        match token {
            Token::Open { tag, void, .. } if !void => {
                if open.len() >= MAX_HTML_DEPTH {
                    return None;
                }
                open.push(tag);
            }
            Token::Close(tag) => {
                if open.last() != Some(&tag) {
                    return None;
                }
                open.pop();
            }
            _ => {}
        }
    }
    Some(open)
}

/// `renderMarkdownBlocksToHtml`: compiles Markdown to HTML while preserving
/// authored raw HTML for subsequent strict `parse` sanitization.
pub fn markdown_html(source: &str) -> String {
    use pulldown_cmark::{Options, Parser, html};
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);
    let mut out = String::new();
    html::push_html(&mut out, Parser::new_ext(source, options));
    out
}

/// Compiles Markdown prose (such as an MDX `<Tab>` panel) into sanitized DOM nodes.
pub fn markdown_nodes(source: &str) -> Vec<Node> {
    match parse(&markdown_html(source)) {
        Parsed::Complete(nodes) => nodes,
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn only_authored_nesting_is_accepted() {
        let Parsed::Complete(nodes) =
            parse("<div align=\"center\"><p>a &amp; <b>b</b><br></p><script>x</script></div>")
        else {
            panic!("complete")
        };
        let Node::Element(div) = &nodes[0] else {
            panic!()
        };
        assert_eq!(
            (div.tag.as_str(), div.attribute("align")),
            ("div", Some("center"))
        );
        assert_eq!(div.children.len(), 1, "the script is dropped");
        assert_eq!(div.text(), "a & b");
        assert_eq!(parse("<p><div>x</div></p>"), Parsed::Malformed);
        assert_eq!(parse("<b>x</i>"), Parsed::Malformed);
        assert_eq!(
            parse("<table>text<tr><td>x</td></tr></table>"),
            Parsed::Malformed
        );
        assert_eq!(
            parse("<details><summary>s</summary>"),
            Parsed::Incomplete(vec!["details".into()])
        );
        assert_eq!(parse("<!-- note -->"), Parsed::Unsupported);
        assert_eq!(balance("</details>", vec!["details".into()]), Some(vec![]));
    }
}
