//! Sanitized HTML block DOM tree (`htmlTagTokenizer.ts`, `htmlBlockStructure.ts`):
//! a block renders only when its tags nest strictly as authored — anything a
//! browser would repair stays visible source. Executable and embedding tags
//! (`BLOCKED_TAGS`) are dropped in open/close, void, and self-closing forms,
//! `on*` event attributes are stripped, and nesting deeper than
//! `MAX_HTML_DEPTH` is refused (`TA-51`).
use std::hash::{Hash, Hasher};

/// Maximum HTML element nesting depth accepted by the parser and renderer (`TA-51`).
pub const MAX_HTML_DEPTH: usize = 64;

/// `BLOCKED_EXECUTABLE_TAGS`: dropped whether opened/closed, void, or self-closing.
pub const BLOCKED_TAGS: &[&str] = &[
    "base", "embed", "form", "iframe", "input", "link", "meta", "object", "script", "style",
    "template",
];

const VOID_TAGS: &[&str] = &[
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track",
    "wbr",
];

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

pub fn is_blocked_tag(tag: &str) -> bool {
    BLOCKED_TAGS.contains(&tag.to_ascii_lowercase().as_str())
}

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

/// `MarkdownHtmlBlockStatus`.
#[derive(Debug, PartialEq, Eq)]
pub enum Parsed {
    Complete(Vec<Node>),
    /// An element is still open (a cross-block flow may close it later).
    Incomplete(Vec<String>),
    Malformed,
    /// A comment, declaration, processing instruction, or depth-exceeded block.
    Unsupported,
}

enum Token {
    Open {
        tag: String,
        attributes: Vec<(String, String)>,
        void: bool,
    },
    Close(String),
    Text(String),
}

/// Decodes `&name;`, `&#n;` and `&#xh;` character references.
pub fn decode_entities(text: &str) -> String {
    if !text.contains('&') {
        return text.to_owned();
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        rest = &rest[at..];
        let end = rest[1..].find(';').map(|i| i + 1).filter(|&i| i <= 12);
        let decoded = end.and_then(|end| {
            let name = &rest[1..end];
            let c = if let Some(num) = name.strip_prefix('#') {
                let n = match num.strip_prefix(['x', 'X']) {
                    Some(hex) => u32::from_str_radix(hex, 16).ok()?,
                    None => num.parse().ok()?,
                };
                char::from_u32(n)?
            } else {
                match name {
                    "amp" => '&',
                    "lt" => '<',
                    "gt" => '>',
                    "quot" => '"',
                    "apos" => '\'',
                    "nbsp" => '\u{a0}',
                    "copy" => '©',
                    "reg" => '®',
                    "trade" => '™',
                    "hellip" => '…',
                    "mdash" => '—',
                    "ndash" => '–',
                    "middot" => '·',
                    "times" => '×',
                    "rarr" => '→',
                    "larr" => '←',
                    "laquo" => '«',
                    "raquo" => '»',
                    _ => return None,
                }
            };
            Some((c, end + 1))
        });
        match decoded {
            Some((c, len)) => {
                out.push(c);
                rest = &rest[len..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn attributes(mut text: &str) -> Option<Vec<(String, String)>> {
    let mut out = Vec::new();
    loop {
        text = text.trim_start();
        if text.is_empty() {
            return Some(out);
        }
        let end = text
            .find(|c: char| c.is_whitespace() || c == '=')
            .unwrap_or(text.len());
        let name = text[..end].to_ascii_lowercase();
        if name.is_empty() {
            return None;
        }
        text = text[end..].trim_start();
        let value = match text.strip_prefix('=') {
            Some(rest) => {
                let rest = rest.trim_start();
                let (value, after) = match rest.chars().next() {
                    Some(q @ ('"' | '\'')) => {
                        let close = rest[1..].find(q)?;
                        (&rest[1..1 + close], &rest[close + 2..])
                    }
                    _ => {
                        let close = rest.find(char::is_whitespace).unwrap_or(rest.len());
                        (&rest[..close], &rest[close..])
                    }
                };
                text = after;
                decode_entities(value)
            }
            None => String::new(),
        };
        if out.iter().any(|(n, _): &(String, String)| *n == name) {
            return None;
        }
        out.push((name, value));
    }
}

fn tag_end(source: &str) -> Option<usize> {
    let mut quote = None;
    for (i, c) in source.char_indices().skip(1) {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), _) => {}
            (None, '"' | '\'') => quote = Some(c),
            (None, '>') => return Some(i + 1),
            (None, '<') => return None,
            _ => {}
        }
    }
    None
}

fn tokens(source: &str) -> Option<Vec<Token>> {
    let mut out = Vec::new();
    let mut text = String::new();
    let mut rest = source;
    while let Some(at) = rest.find('<') {
        text.push_str(&rest[..at]);
        rest = &rest[at..];
        if let Some(comment) = rest.strip_prefix("<!--") {
            let end = comment.find("-->")?;
            rest = &comment[end + 3..];
            continue;
        }
        if rest.starts_with("<!") || rest.starts_with("<?") {
            let end = rest.find('>')?;
            rest = &rest[end + 1..];
            continue;
        }
        let closing = rest.starts_with("</");
        let name_start = if closing { 2 } else { 1 };
        let is_tag = rest[name_start..]
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic());
        let end = is_tag.then(|| tag_end(rest)).flatten();
        let Some(end) = end else {
            text.push('<');
            rest = &rest[1..];
            continue;
        };
        if !text.is_empty() {
            out.push(Token::Text(decode_entities(&std::mem::take(&mut text))));
        }
        let inner = &rest[name_start..end - 1];
        let (inner, self_closing) = match inner.strip_suffix('/') {
            Some(i) => (i, true),
            None => (inner, false),
        };
        let name_end = inner
            .find(|c: char| c.is_whitespace())
            .unwrap_or(inner.len());
        let tag = inner[..name_end].to_ascii_lowercase();
        if closing {
            out.push(Token::Close(tag));
        } else {
            let attributes = attributes(&inner[name_end..])?;
            let void = self_closing || VOID_TAGS.contains(&tag.as_str());
            out.push(Token::Open {
                tag,
                attributes,
                void,
            });
        }
        rest = &rest[end..];
    }
    text.push_str(rest);
    if !text.is_empty() {
        out.push(Token::Text(decode_entities(&text)));
    }
    Some(out)
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
        return Parsed::Unsupported;
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
                let attributes = attributes
                    .into_iter()
                    .filter(|(n, _)| !n.starts_with("on"))
                    .collect();
                let element = Element {
                    tag,
                    attributes,
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
                if !BLOCKED_TAGS.contains(&element.tag.as_str()) {
                    stack
                        .last_mut()
                        .unwrap()
                        .children
                        .push(Node::Element(element));
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
/// authored raw HTML for subsequent strict `dom::parse` sanitization.
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
}
