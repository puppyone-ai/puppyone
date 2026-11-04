//! Inline HTML (features/html/inlineHtmlModel.ts, the `inline-editable`
//! profile): an opening tag the profile allows and its closing tag in the
//! same paragraph style their content as the element would, and the tags
//! hide like Markdown delimiters. Anything else stays source.
use super::{Element, Kind, Span};

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
/// inline HTML) into elements.
pub(super) fn elements(source: &str, tags: &[Span]) -> Vec<Element> {
    let mut open: Vec<Tag> = Vec::new();
    let mut out = Vec::new();
    for range in tags {
        let Some(t) = tag(source, range.clone()) else {
            continue;
        };
        if t.void || !TAGS.contains(&t.name.as_str()) {
            continue;
        }
        if !t.closing {
            open.push(t);
            continue;
        }
        let Some(at) = open.iter().rposition(|o| o.name == t.name) else {
            continue;
        };
        let opening = open.remove(at);
        open.truncate(at);
        let content = opening.range.end..t.range.start;
        // One paragraph: no blank line between the tags.
        if source[content.clone()].contains("\n\n") {
            continue;
        }
        let attribute = |name: &str| {
            opening
                .attributes
                .iter()
                .find(|(n, _)| n == name)
                .map(|(_, v)| v.as_str())
        };
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
            vec![opening.range.clone(), t.range.clone()],
            Some(content),
        );
        e.href = html.href.clone();
        e.html = Some(Box::new(html));
        out.push(e);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn allowed_tags_pair_within_a_paragraph() {
        let source = "a <b>bold</b> <span style=\"color: red\">red</span> <a href=\"https://x.org\">x</a> <script>s</script> <i>open\n\n</i>";
        let tags: Vec<Span> = [
            "<b>",
            "</b>",
            "<span style=\"color: red\">",
            "</span>",
            "<a href=\"https://x.org\">",
            "</a>",
            "<script>",
            "</script>",
            "<i>",
            "</i>",
        ]
        .iter()
        .scan(0, |from, t| {
            let at = *from + source[*from..].find(t).unwrap();
            *from = at + t.len();
            Some(at..at + t.len())
        })
        .collect();
        let found = elements(source, &tags);
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
