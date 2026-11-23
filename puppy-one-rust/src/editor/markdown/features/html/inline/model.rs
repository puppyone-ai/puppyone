//! Inline HTML tag pairing (`features/html/inlineHtmlModel.ts`, the
//! `inline-editable` profile).
use super::super::tokenizer::VOID_TAGS;
use crate::editor::markdown::platform::policy::html_profiles::BLOCKED_TAGS;
use crate::editor::{
    markdown::core::syntax::{Element, InlineTag, Kind, Span, Syntax},
    text::buffer::Buffer,
};
use std::ops::Range;

/// `INLINE_EDITABLE_TAGS` with content (`br` is the profile's one void).
const TAGS: &[&str] = &[
    "a", "abbr", "b", "cite", "code", "del", "em", "i", "ins", "kbd", "mark", "q", "s", "samp",
    "small", "span", "strike", "strong", "sub", "sup", "time", "tt", "u", "var",
];

/// One tag: `<name attrs>`, `</name>` or `<name/>`.
pub(in crate::editor::markdown::features::html) struct Tag {
    pub range: Span,
    pub name: String,
    pub closing: bool,
    pub void: bool,
    pub attributes: Vec<(String, String)>,
}

impl Tag {
    pub fn attribute(&self, name: &str) -> Option<&str> {
        self.attributes
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, v)| v.as_str())
    }

    /// `<img>` or `<x/>`: an element without content (`selfClosing`).
    fn self_closing(&self) -> bool {
        !self.closing && (self.void || VOID_TAGS.contains(&self.name.as_str()))
    }
}

/// The tag at `range` of `doc`, its range in the document.
pub(in crate::editor::markdown::features::html) fn tag_at(
    doc: &Buffer,
    range: Span,
) -> Option<Tag> {
    let slice = doc.slice_cow(range.clone());
    let mut t = tag(&slice, 0..slice.len())?;
    t.range = range;
    Some(t)
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
            && !value.contains('\\')
            && crate::editor::markdown::platform::policy::presentation::is_safe_style_value(
                property, value,
            ))
        .then(|| {
            crate::editor::markdown::platform::policy::presentation::color_fallback(value)
                .map(str::to_owned)
        })
        .flatten()
    })
}

/// Pair the inline HTML tags of a parsed window (sorted, from the parser's
/// inline HTML) into `Kind::InlineHtml` elements without flattening `doc.flat`
/// (`TA-01`). Enforces table-cell containment so paired tags cannot span cells.
pub(super) fn elements_in_window(
    doc: &Buffer,
    syntax: &Syntax,
    window: Range<usize>,
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
        .chain(syntax.marker_html.iter().cloned())
        .filter(|r| r.end > window.start && r.start < window.end)
        .collect();
    containers.sort_by_key(|r| (r.start, r.end));
    containers.dedup();
    let mut out = Vec::new();
    for container in containers {
        let first = tags.partition_point(|r| r.start < container.start);
        let last = tags.partition_point(|r| r.start < container.end);
        if first >= last {
            continue;
        }
        let runs = runs(doc, &tags[first..last], container.clone());
        let rest: Vec<Span> = tags[first..last]
            .iter()
            .filter(|t| {
                !runs
                    .iter()
                    .any(|r| r.range.start <= t.start && t.end <= r.range.end)
            })
            .cloned()
            .collect();
        for element in runs
            .into_iter()
            .chain(pair_container(doc, &rest, container.end))
        {
            // Inline HTML may span soft line breaks in a paragraph, but a
            // table cell is its own inline context. Any tag pair touching a
            // cell must fit wholly inside that one cell.
            let index = syntax
                .table_cells
                .partition_point(|cell| cell.end <= element.range.start);
            let fits_cell = syntax.table_cells.get(index).is_none_or(|cell| {
                cell.start >= element.range.end
                    || (cell.start <= element.range.start && cell.end >= element.range.end)
            });
            if fits_cell {
                out.push(element);
            }
        }
    }
    out.sort_by_key(|e| (e.range.start, std::cmp::Reverse(e.range.end)));
    out
}

/// One element of a container's tag pairing (`MarkdownInlineHtml`).
struct Paired {
    range: Span,
    name: String,
    /// Opening tag (or the only tag) and closing tag, as indexes into the tags.
    open: usize,
    content: Option<Span>,
    complete: bool,
}

/// `pairInlineHtmlContainer` + `assignInlineHtmlRuns`: pairs every tag of
/// a container and keeps the groups (a root and the elements inside it) that
/// must render as one run. Classification covers the whole container, so a
/// run keeps one projection however a window slices it.
fn runs(doc: &Buffer, spans: &[Span], container: Span) -> Vec<Element> {
    let tags: Vec<Tag> = spans
        .iter()
        .filter(|r| r.end <= container.end)
        .filter_map(|r| tag_at(doc, r.clone()))
        .collect();
    let mut paired: Vec<Paired> = Vec::new();
    let mut stack: Vec<usize> = Vec::new();
    let mut invalid: Vec<Span> = Vec::new();
    for (i, t) in tags.iter().enumerate() {
        if t.self_closing() {
            paired.push(Paired {
                range: t.range.clone(),
                name: t.name.clone(),
                open: i,
                content: None,
                complete: true,
            });
        } else if !t.closing {
            stack.push(i);
        } else if stack.last().is_some_and(|&o| tags[o].name == t.name) {
            let o = stack.pop().unwrap();
            paired.push(Paired {
                range: tags[o].range.start..t.range.end,
                name: t.name.clone(),
                open: o,
                content: Some(tags[o].range.end..t.range.start),
                complete: true,
            });
        } else {
            invalid.push(t.range.clone());
            paired.push(Paired {
                range: t.range.clone(),
                name: t.name.clone(),
                open: i,
                content: None,
                complete: false,
            });
        }
    }
    for o in stack {
        invalid.push(tags[o].range.start..container.end);
        paired.push(Paired {
            range: tags[o].range.start..container.end,
            name: tags[o].name.clone(),
            open: o,
            content: None,
            complete: false,
        });
    }
    for p in &mut paired {
        if invalid
            .iter()
            .any(|r| r.start <= p.range.start && p.range.end <= r.end && *r != p.range)
        {
            p.complete = false;
        }
    }
    paired.sort_by(|a, b| {
        a.range
            .start
            .cmp(&b.range.start)
            .then(b.range.end.cmp(&a.range.end))
            .then(a.name.cmp(&b.name))
    });
    let mut out = Vec::new();
    let mut i = 0;
    while i < paired.len() {
        let root = &paired[i];
        let mut end = i + 1;
        while end < paired.len() && paired[end].range.end <= root.range.end {
            end += 1;
        }
        let group = &paired[i..end];
        if requires_run(group, &tags) {
            let markers: Vec<Span> = tags
                .iter()
                .filter(|t| root.range.start <= t.range.start && t.range.end <= root.range.end)
                .map(|t| t.range.clone())
                .collect();
            let mut e = Element::new(Kind::HtmlRun, root.range.clone(), markers, None);
            e.text = Some(run_source(&doc.slice_cow(root.range.clone())));
            e.html = Some(Box::new(InlineTag {
                name: root.name.clone(),
                href: None,
                color: None,
                background: None,
            }));
            out.push(e);
        }
        i = end;
    }
    out
}

/// `requiresInlineHtmlRun`: a complete group whose root is not executable,
/// with no anchor the URL policy refuses, and with an element the
/// inline-editable profile cannot style (or an empty one it would hide).
fn requires_run(group: &[Paired], tags: &[Tag]) -> bool {
    let root = &group[0];
    if BLOCKED_TAGS.contains(&root.name.as_str()) || group.iter().any(|p| !p.complete) {
        return false;
    }
    let unsafe_href = |p: &Paired| {
        p.name == "a"
            && tags[p.open].attribute("href").is_some_and(|h| {
                crate::editor::markdown::platform::brokers::link::safe_href(h).is_none()
            })
    };
    if group.iter().any(unsafe_href) {
        return false;
    }
    group.iter().any(|p| {
        let mark = TAGS.contains(&p.name.as_str()) && !BLOCKED_TAGS.contains(&p.name.as_str());
        match &p.content {
            None => p.name != "br",
            Some(_) if !mark => true,
            Some(content) => {
                content.is_empty() && !(p.name == "a" && tags[p.open].attribute("id").is_some())
            }
        }
    })
}

/// `readMarkdownInlineHtmlRunSource`: continuation lines keep their list or
/// quote prefix in the document only.
pub fn run_source(source: &str) -> String {
    let mut out = String::with_capacity(source.len());
    for (i, line) in source.split('\n').enumerate() {
        if i > 0 {
            out.push('\n');
            let mut rest = line.trim_start_matches([' ', '\t']);
            while let Some(after) = rest.strip_prefix('>') {
                rest = after.strip_prefix([' ', '\t']).unwrap_or(after);
            }
            out.push_str(rest);
        } else {
            out.push_str(line);
        }
    }
    out
}

fn pair_container(doc: &Buffer, tags: &[Span], end: usize) -> Vec<Element> {
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
            && attribute("href").is_some_and(|h| {
                crate::editor::markdown::platform::brokers::link::safe_href(h).is_none()
            })
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
    use crate::editor::markdown::{core::features::MarkdownFeature, features::html::FEATURE};
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
        static F: &[&dyn MarkdownFeature] = &[&FEATURE];
        let syntax = Syntax::parse_with(&Buffer::new(source), F);
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
