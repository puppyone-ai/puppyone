//! The Markdown blocks and inlines (`react-markdown` with `remark-gfm`):
//! headings, lists, tasks, quotes, code, aligned tables, footnotes, safe
//! links and bare-URL autolinks.
use super::*;

#[derive(Clone, Debug, PartialEq)]
pub(super) enum Inline {
    Text(String),
    Code(String),
    Strong(Vec<Inline>),
    Emphasis(Vec<Inline>),
    Strike(Vec<Inline>),
    Link(String, Vec<Inline>),
    Image(String),
    /// A footnote reference: its label while parsing, then its number.
    FootnoteRef(String),
    SoftBreak,
    HardBreak,
}

/// A table column's `:---`, `:---:` or `---:`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Align {
    None,
    Left,
    Center,
    Right,
}

#[derive(Clone, Debug, PartialEq)]
pub(super) enum Block {
    /// `tight`: a list item's bare text (no `<p>`, no margins, normal white-space).
    Paragraph {
        inlines: Vec<Inline>,
        tight: bool,
    },
    Heading(Vec<Inline>),
    List {
        start: Option<u64>,
        items: Vec<Item>,
        depth: usize,
    },
    Quote(Vec<Block>),
    Code {
        language: String,
        text: String,
    },
    Table {
        head: Vec<Vec<Inline>>,
        rows: Vec<Vec<Vec<Inline>>>,
        align: Vec<Align>,
    },
    Rule,
    /// A footnote's definition, while parsing.
    FootnoteDefinition(String, Vec<Block>),
    /// `section[data-footnotes]`: the referenced footnotes in the order
    /// they are first referenced.
    Footnotes(Vec<Vec<Block>>),
}

#[derive(Clone, Debug, PartialEq)]
pub(super) struct Item {
    pub(super) task: Option<bool>,
    pub(super) blocks: Vec<Block>,
}

pub(super) fn parse(text: &str) -> Vec<Block> {
    let options = Options::ENABLE_TABLES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_FOOTNOTES;
    let mut parser = Parser::new_ext(text, options).peekable();
    let mut blocks = blocks(&mut parser, None, 0);
    // Footnote definitions leave the flow; the referenced ones follow it,
    // numbered by their first reference (`remark-gfm`).
    let mut definitions = vec![];
    blocks.retain(|block| match block {
        Block::FootnoteDefinition(label, content) => {
            definitions.push((label.clone(), content.clone()));
            false
        }
        _ => true,
    });
    let mut order: Vec<String> = vec![];
    for block in &mut blocks {
        finish_block(block, &mut order);
    }
    let mut notes = vec![];
    for label in &order {
        if let Some((_, content)) = definitions.iter_mut().find(|(l, _)| l == label) {
            let mut content = std::mem::take(content);
            for block in &mut content {
                finish_block(block, &mut order.clone());
            }
            notes.push(content);
        }
    }
    if !notes.is_empty() {
        blocks.push(Block::Footnotes(notes));
    }
    blocks
}

/// Number `block`'s footnote references by first use and link its bare URLs.
fn finish_block(block: &mut Block, order: &mut Vec<String>) {
    match block {
        Block::Paragraph { inlines, .. } | Block::Heading(inlines) => {
            *inlines = finish_inlines(std::mem::take(inlines), order, true)
        }
        Block::List { items, .. } => items
            .iter_mut()
            .flat_map(|i| i.blocks.iter_mut())
            .for_each(|b| finish_block(b, order)),
        Block::Quote(children) | Block::FootnoteDefinition(_, children) => {
            children.iter_mut().for_each(|b| finish_block(b, order))
        }
        Block::Table { head, rows, .. } => {
            for cell in head.iter_mut().chain(rows.iter_mut().flatten()) {
                *cell = finish_inlines(std::mem::take(cell), order, true);
            }
        }
        Block::Footnotes(notes) => notes
            .iter_mut()
            .flatten()
            .for_each(|b| finish_block(b, order)),
        Block::Code { .. } | Block::Rule => {}
    }
}

fn finish_inlines(inlines: Vec<Inline>, order: &mut Vec<String>, link: bool) -> Vec<Inline> {
    let mut out = vec![];
    for inline in inlines {
        match inline {
            Inline::Text(text) if link => out.extend(autolink(&text)),
            Inline::FootnoteRef(label) => {
                let number = match order.iter().position(|l| *l == label) {
                    Some(index) => index + 1,
                    None => {
                        order.push(label);
                        order.len()
                    }
                };
                out.push(Inline::FootnoteRef(number.to_string()));
            }
            Inline::Strong(c) => out.push(Inline::Strong(finish_inlines(c, order, link))),
            Inline::Emphasis(c) => out.push(Inline::Emphasis(finish_inlines(c, order, link))),
            Inline::Strike(c) => out.push(Inline::Strike(finish_inlines(c, order, link))),
            // A link's own text is never linked again.
            Inline::Link(href, c) => out.push(Inline::Link(href, finish_inlines(c, order, false))),
            other => out.push(other),
        }
    }
    out
}

/// GFM's autolink literals: `https://`, `http://` and `www.` addresses and
/// e-mail addresses in text become links, without the trailing punctuation
/// a sentence puts after them.
pub(super) fn autolink(text: &str) -> Vec<Inline> {
    let mut out = vec![];
    let mut rest = text;
    let mut plain = String::new();
    while !rest.is_empty() {
        let boundary = plain
            .chars()
            .last()
            .is_none_or(|c| c.is_whitespace() || "*_~(".contains(c));
        let lower = rest.to_ascii_lowercase();
        let scheme = ["https://", "http://", "www."]
            .into_iter()
            .find(|p| lower.starts_with(p))
            .filter(|_| boundary);
        if let Some(prefix) = scheme
            && let Some(len) = url_length(rest, prefix.len())
        {
            if !plain.is_empty() {
                out.push(Inline::Text(std::mem::take(&mut plain)));
            }
            let (url, after) = rest.split_at(len);
            let href = if prefix == "www." {
                format!("http://{url}")
            } else {
                url.to_owned()
            };
            out.push(Inline::Link(href, vec![Inline::Text(url.to_owned())]));
            rest = after;
            continue;
        }
        if boundary && let Some(len) = email_length(rest) {
            if !plain.is_empty() {
                out.push(Inline::Text(std::mem::take(&mut plain)));
            }
            let (email, after) = rest.split_at(len);
            out.push(Inline::Link(
                format!("mailto:{email}"),
                vec![Inline::Text(email.to_owned())],
            ));
            rest = after;
            continue;
        }
        let c = rest.chars().next().unwrap_or_default();
        plain.push(c);
        rest = &rest[c.len_utf8()..];
    }
    if !plain.is_empty() {
        out.push(Inline::Text(plain));
    }
    out
}

/// The length of an address starting `text` (its scheme or `www.` is
/// `prefix` bytes): a valid domain, then anything to whitespace or `<`,
/// without trailing punctuation or an unbalanced `)`.
fn url_length(text: &str, prefix: usize) -> Option<usize> {
    let end = text
        .find(|c: char| c.is_whitespace() || c == '<')
        .unwrap_or(text.len());
    let candidate = &text[..end];
    let domain_end = candidate[prefix..]
        .find(['/', '?', '#'])
        .map_or(candidate.len(), |i| prefix + i);
    let domain = &candidate[prefix..domain_end];
    let labels: Vec<&str> = domain
        .trim_end_matches(['.', ',', '?', '!', ':'])
        .split('.')
        .collect();
    let valid = !labels.is_empty()
        && labels.iter().all(|l| {
            !l.is_empty()
                && l.chars()
                    .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
        })
        && labels.len() >= 2
        && labels.iter().rev().take(2).all(|l| !l.contains('_'));
    if !valid {
        return None;
    }
    let mut len = candidate.len();
    loop {
        let url = &candidate[..len];
        let last = url.chars().last()?;
        if "?!.,:*_~'\"".contains(last) {
            len -= last.len_utf8();
        } else if last == ')' && url.matches(')').count() > url.matches('(').count() {
            len -= 1;
        } else {
            break;
        }
    }
    (len > prefix).then_some(len)
}

/// The length of an e-mail address starting `text`.
fn email_length(text: &str) -> Option<usize> {
    let at = text.find('@')?;
    let local = &text[..at];
    if local.is_empty()
        || !local
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || ".-_+".contains(c))
    {
        return None;
    }
    let domain: String = text[at + 1..]
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || "-_.".contains(*c))
        .collect();
    let domain = domain.trim_end_matches(['.', '-', '_']);
    let labels: Vec<&str> = domain.split('.').collect();
    (labels.len() >= 2 && labels.iter().all(|l| !l.is_empty()) && !domain.ends_with('_'))
        .then_some(at + 1 + domain.len())
}

pub(super) fn blocks<'a>(
    events: &mut std::iter::Peekable<Parser<'a>>,
    until: Option<TagEnd>,
    depth: usize,
) -> Vec<Block> {
    let mut out = vec![];
    let mut loose: Vec<Inline> = vec![];
    let flush = |out: &mut Vec<Block>, loose: &mut Vec<Inline>| {
        if !loose.is_empty() {
            out.push(Block::Paragraph {
                inlines: std::mem::take(loose),
                tight: true,
            });
        }
    };
    while let Some(event) = events.next() {
        match event {
            Event::End(end) if Some(end) == until => break,
            Event::Start(Tag::Paragraph) => {
                flush(&mut out, &mut loose);
                out.push(Block::Paragraph {
                    inlines: inlines(events, TagEnd::Paragraph),
                    tight: false,
                });
            }
            Event::Start(Tag::Heading { level, .. }) => {
                flush(&mut out, &mut loose);
                out.push(Block::Heading(inlines(events, TagEnd::Heading(level))));
            }
            Event::Start(Tag::List(start)) => {
                flush(&mut out, &mut loose);
                let mut items = vec![];
                while let Some(event) = events.next() {
                    match event {
                        Event::Start(Tag::Item) => {
                            let mut task = None;
                            if let Some(Event::TaskListMarker(checked)) = events.peek() {
                                task = Some(*checked);
                                events.next();
                            }
                            items.push(Item {
                                task,
                                blocks: blocks(events, Some(TagEnd::Item), depth + 1),
                            });
                        }
                        Event::End(TagEnd::List(_)) => break,
                        _ => {}
                    }
                }
                out.push(Block::List {
                    start,
                    items,
                    depth: depth + 1,
                });
            }
            Event::Start(Tag::BlockQuote(_)) => {
                flush(&mut out, &mut loose);
                out.push(Block::Quote(blocks(
                    events,
                    Some(TagEnd::BlockQuote(None)),
                    depth,
                )));
            }
            Event::Start(Tag::CodeBlock(kind)) => {
                flush(&mut out, &mut loose);
                let language = match kind {
                    CodeBlockKind::Fenced(info) => {
                        info.split_whitespace().next().unwrap_or("").to_lowercase()
                    }
                    CodeBlockKind::Indented => String::new(),
                };
                let mut text = String::new();
                for event in events.by_ref() {
                    match event {
                        Event::Text(t) => text.push_str(&t),
                        Event::End(TagEnd::CodeBlock) => break,
                        _ => {}
                    }
                }
                out.push(Block::Code {
                    language,
                    text: text.trim_end_matches('\n').to_owned(),
                });
            }
            Event::Start(Tag::Table(alignments)) => {
                flush(&mut out, &mut loose);
                let align = alignments
                    .iter()
                    .map(|a| match a {
                        pulldown_cmark::Alignment::None => Align::None,
                        pulldown_cmark::Alignment::Left => Align::Left,
                        pulldown_cmark::Alignment::Center => Align::Center,
                        pulldown_cmark::Alignment::Right => Align::Right,
                    })
                    .collect();
                let (mut head, mut rows, mut row) = (vec![], vec![], vec![]);
                let mut in_head = false;
                while let Some(event) = events.next() {
                    match event {
                        Event::Start(Tag::TableHead) => in_head = true,
                        Event::End(TagEnd::TableHead) => {
                            in_head = false;
                            head = std::mem::take(&mut row);
                        }
                        Event::Start(Tag::TableCell) => {
                            row.push(inlines(events, TagEnd::TableCell))
                        }
                        Event::End(TagEnd::TableRow) if !in_head => {
                            rows.push(std::mem::take(&mut row))
                        }
                        Event::End(TagEnd::Table) => break,
                        _ => {}
                    }
                }
                out.push(Block::Table { head, rows, align });
            }
            Event::Rule => {
                flush(&mut out, &mut loose);
                out.push(Block::Rule);
            }
            Event::Start(Tag::FootnoteDefinition(label)) => {
                flush(&mut out, &mut loose);
                out.push(Block::FootnoteDefinition(
                    label.to_string(),
                    blocks(events, Some(TagEnd::FootnoteDefinition), depth),
                ));
            }
            Event::FootnoteReference(label) => loose.push(Inline::FootnoteRef(label.to_string())),
            // Raw HTML is shown as text (react-markdown does not render it).
            Event::Html(html) | Event::InlineHtml(html) => {
                loose.push(Inline::Text(html.to_string()))
            }
            Event::Text(t) => loose.push(Inline::Text(t.to_string())),
            Event::Code(c) => loose.push(Inline::Code(c.to_string())),
            Event::SoftBreak => loose.push(Inline::SoftBreak),
            Event::HardBreak => loose.push(Inline::HardBreak),
            Event::Start(
                tag @ (Tag::Strong
                | Tag::Emphasis
                | Tag::Strikethrough
                | Tag::Link { .. }
                | Tag::Image { .. }),
            ) => {
                loose.push(inline_container(events, tag));
            }
            _ => {}
        }
    }
    flush(&mut out, &mut loose);
    out
}

pub(super) fn inline_container<'a>(
    events: &mut std::iter::Peekable<Parser<'a>>,
    tag: Tag<'a>,
) -> Inline {
    match tag {
        Tag::Strong => Inline::Strong(inlines(events, TagEnd::Strong)),
        Tag::Emphasis => Inline::Emphasis(inlines(events, TagEnd::Emphasis)),
        Tag::Strikethrough => Inline::Strike(inlines(events, TagEnd::Strikethrough)),
        Tag::Link { dest_url, .. } => {
            Inline::Link(dest_url.to_string(), inlines(events, TagEnd::Link))
        }
        Tag::Image { .. } => {
            let alt = inlines(events, TagEnd::Image);
            Inline::Image(plain(&alt))
        }
        _ => Inline::Text(String::new()),
    }
}

pub(super) fn inlines<'a>(
    events: &mut std::iter::Peekable<Parser<'a>>,
    end: TagEnd,
) -> Vec<Inline> {
    let mut out = vec![];
    while let Some(event) = events.next() {
        match event {
            Event::End(e) if e == end => break,
            Event::Text(t) => out.push(Inline::Text(t.to_string())),
            Event::Code(c) => out.push(Inline::Code(c.to_string())),
            Event::Html(h) | Event::InlineHtml(h) => out.push(Inline::Text(h.to_string())),
            Event::SoftBreak => out.push(Inline::SoftBreak),
            Event::HardBreak => out.push(Inline::HardBreak),
            Event::FootnoteReference(label) => out.push(Inline::FootnoteRef(label.to_string())),
            Event::Start(tag) => out.push(inline_container(events, tag)),
            _ => {}
        }
    }
    out
}

pub(super) fn plain(inlines: &[Inline]) -> String {
    inlines
        .iter()
        .map(|i| match i {
            Inline::Text(t) | Inline::Code(t) | Inline::Image(t) | Inline::FootnoteRef(t) => {
                t.clone()
            }
            Inline::Strong(c) | Inline::Emphasis(c) | Inline::Strike(c) | Inline::Link(_, c) => {
                plain(c)
            }
            Inline::SoftBreak | Inline::HardBreak => " ".into(),
        })
        .collect()
}

/// Product link policy (`classifyAgentMarkdownHref`): only web and mail
/// links open, web links with a host and no credentials, each as its
/// normalized address (`url.href`).
pub(super) fn safe_href(url: &str) -> Option<SharedString> {
    let url = url::Url::parse(url.trim()).ok()?;
    let allowed = match url.scheme() {
        "http" | "https" => {
            url.host_str().is_some_and(|h| !h.is_empty())
                && url.username().is_empty()
                && url.password().is_none()
        }
        "mailto" => !url.path().is_empty(),
        _ => false,
    };
    allowed.then(|| url.to_string().into())
}
