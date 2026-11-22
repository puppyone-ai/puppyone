//! Inline HTML (features/html/inlineHtmlModel.ts, the `inline-editable`
//! profile): an opening tag the profile allows and its closing tag in the
//! same paragraph style their content as the element would, and the tags
//! hide like Markdown delimiters. Anything else stays source.
use super::{Element, Kind, Span, Syntax};

/// `INLINE_EDITABLE_TAGS` with content (`br` is the profile's one void).
const TAGS: &[&str] = &[
    "a", "abbr", "b", "cite", "code", "del", "em", "i", "ins", "kbd", "mark", "q", "s", "samp",
    "small", "span", "strike", "strong", "sub", "sup", "time", "tt", "u", "var",
];

/// What an inline element shows: its tag, and the attributes that style it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct InlineTag {
    pub name: String,
    /// `a href` as authored (the URL policy applies when it is followed).
    pub href: Option<String>,
    /// `style` colours (`color`, `background-color`), as CSS colours.
    pub color: Option<String>,
    pub background: Option<String>,
}

/// One tag: `<name attrs>`, `</name>` or `<name/>`.
struct Tag {
    range: Span,
    name: String,
    closing: bool,
    void: bool,
    attributes: Vec<(String, String)>,
}

fn tag(source: &str, range: Span) -> Option<Tag> {
    let text = source[range.clone()].strip_prefix('<')?.strip_suffix('>')?;
    let (closing, text) = match text.strip_prefix('/') {
        Some(rest) => (true, rest),
        None => (false, text),
    };
    let (void, text) = match text.strip_suffix('/') {
        Some(rest) => (true, rest),
        None => (false, text),
    };
    let end = text.find(|c: char| c.is_whitespace()).unwrap_or(text.len());
    let name = &text[..end];
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return None;
    }
    Some(Tag {
        range,
        name: name.to_ascii_lowercase(),
        closing,
        void,
        attributes: attributes(&text[end..]),
    })
}

/// `name="v"`, `name='v'`, `name=v` and bare names, lowercased.
fn attributes(mut text: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    loop {
        text = text.trim_start();
        let end = text
            .find(|c: char| c.is_whitespace() || c == '=')
            .unwrap_or(text.len());
        if end == 0 {
            return out;
        }
        let name = text[..end].to_ascii_lowercase();
        text = text[end..].trim_start();
        let value = match text.strip_prefix('=') {
            Some(rest) => {
                let rest = rest.trim_start();
                let (value, after) = match rest.chars().next() {
                    Some(q @ ('"' | '\'')) => match rest[1..].find(q) {
                        Some(close) => (&rest[1..1 + close], &rest[close + 2..]),
                        None => (&rest[1..], ""),
                    },
                    _ => {
                        let close = rest.find(char::is_whitespace).unwrap_or(rest.len());
                        (&rest[..close], &rest[close..])
                    }
                };
                text = after;
                value.to_owned()
            }
            None => String::new(),
        };
        out.push((name, value));
    }
}

/// A `style` declaration's value (`isSafeStyleValue`: no functions but
/// colour ones, no escapes).
fn style_value(style: &str, property: &str) -> Option<String> {
    style.split(';').find_map(|declaration| {
        let (name, value) = declaration.split_once(':')?;
        let value = value.trim();
        (name.trim().eq_ignore_ascii_case(property)
            && !value.is_empty()
            && !value.contains(['\\', '<', '>'])
            && !value.to_ascii_lowercase().contains("url("))
        .then(|| value.to_owned())
    })
}

/// Pair the inline HTML tags of a document (sorted, from the parser's
/// inline HTML) into elements using `Buffer::slice_cow` without flattening
/// `doc.flat` (`TA-01`).
pub(super) fn elements_in_buffer(
    doc: &crate::editor::text::buffer::Buffer,
    syntax: &Syntax,
) -> Vec<Element> {
    let tags = &syntax.inline_tags;
    if tags.is_empty() {
        return Vec::new();
    }
    // The parser owns paragraph, heading and table-cell boundaries. Blank-line
    // text heuristics cannot distinguish adjacent tight list items.
    let mut containers: Vec<_> = syntax
        .paragraphs
        .iter()
        .map(|p| p.range.clone())
        .chain(
            syntax
                .elements
                .iter()
                .filter(|e| e.kind == Kind::Heading)
                .map(|e| e.range.clone()),
        )
        .chain(syntax.table_cells.iter().cloned())
        .collect();
    containers.sort_by_key(|r| (r.start, r.end));
    containers.dedup();
    let mut out = Vec::new();
    for container in containers {
        let first = tags.partition_point(|r| r.start < container.start);
        let last = tags.partition_point(|r| r.start < container.end);
        if first < last {
            out.extend(pair_container(doc, &tags[first..last], container.end));
        }
    }
    out
}

fn pair_container(
    doc: &crate::editor::text::buffer::Buffer,
    tags: &[Span],
    end: usize,
) -> Vec<Element> {
    let mut open: Vec<Tag> = Vec::new();
    let mut out = Vec::new();
    for range in tags {
        if range.end > end {
            continue;
        }
        let slice = doc.slice_cow(range.clone());
        let Some(mut t) = tag(&slice, 0..slice.len()) else {
            continue;
        };
        t.range = range.clone();
        if t.void || !TAGS.contains(&t.name.as_str()) {
            continue;
        }
        if !t.closing {
            open.push(t);
            continue;
        }
        // Only a matching stack top closes an element. A later unmatched
        // opening invalidates all completed descendants in that same container.
        if open.last().is_none_or(|o| o.name != t.name) {
            continue;
        }
        let opening = open.pop().unwrap();
        let content = opening.range.end..t.range.start;
        let attribute = |name: &str| {
            opening
                .attributes
                .iter()
                .find(|(n, _)| n == name)
                .map(|(_, v)| v.as_str())
        };
        // An anchor whose target the URL policy refuses stays source
        // (`compileInlineHtmlRenderPlan`: unsupported).
        if opening.name == "a"
            && attribute("href")
                .is_some_and(|h| crate::editor::markdown::platform::link::safe_href(h).is_none())
        {
            continue;
        }
        let style = attribute("style").unwrap_or_default();
        let html = InlineTag {
            href: (opening.name == "a")
                .then(|| attribute("href").map(|h| h.trim().to_owned()))
                .flatten()
                .filter(|h| !h.is_empty()),
            color: style_value(style, "color"),
            background: style_value(style, "background-color"),
            name: opening.name.clone(),
        };
        let mut e = Element::new(
            Kind::InlineHtml,
            opening.range.start..t.range.end,
            vec![opening.range, t.range],
            Some(content),
        );
        e.href = html.href.clone();
        e.html = Some(Box::new(html));
        out.push(e);
    }
    if let Some(unclosed) = open.first() {
        out.retain(|e| e.range.start < unclosed.range.start);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn quoted_attribute_tokens_preserve_greater_than_and_unquoted_url_slashes() {
        let source = "<span title=\"1 > 0\" data-url=https://example.com/a>";
        let token = tag(source, 0..source.len()).unwrap();
        assert_eq!(token.name, "span");
        assert!(!token.closing);
        assert!(!token.void);
        assert_eq!(
            token.attributes,
            vec![
                ("title".into(), "1 > 0".into()),
                ("data-url".into(), "https://example.com/a".into())
            ]
        );
    }

    #[test]
    fn allowed_tags_pair_within_a_paragraph() {
        let source = "a <b>bold</b> <span style=\"color: red\">red</span> <a href=\"https://x.org\">x</a> <script>s</script> <i>open\n\n</i>";
        let syntax = Syntax::parse(&crate::editor::text::buffer::Buffer::new(source));
        let found: Vec<_> = syntax
            .elements
            .iter()
            .filter(|e| e.kind == Kind::InlineHtml)
            .collect();
        let shown: Vec<_> = found
            .iter()
            .map(|e| {
                let h = e.html.as_ref().unwrap();
                (
                    h.name.as_str(),
                    &source[e.content.clone().unwrap()],
                    h.color.clone(),
                    h.href.clone(),
                )
            })
            .collect();
        assert_eq!(
            shown,
            vec![
                ("b", "bold", None, None),
                ("span", "red", Some("red".into()), None),
                ("a", "x", None, Some("https://x.org".into())),
            ]
        );
    }
}
