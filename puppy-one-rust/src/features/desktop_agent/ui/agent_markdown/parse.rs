//! The Markdown blocks and inlines (`react-markdown` with `remark-gfm`):
//! headings, lists, tasks, quotes, code, tables and safe links.
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
    SoftBreak,
    HardBreak,
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
    },
    Rule,
}

#[derive(Clone, Debug, PartialEq)]
pub(super) struct Item {
    pub(super) task: Option<bool>,
    pub(super) blocks: Vec<Block>,
}

pub(super) fn parse(text: &str) -> Vec<Block> {
    let options =
        Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS;
    let mut parser = Parser::new_ext(text, options).peekable();
    blocks(&mut parser, None, 0)
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
            Event::Start(Tag::Table(_alignments)) => {
                flush(&mut out, &mut loose);
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
                out.push(Block::Table { head, rows });
            }
            Event::Rule => {
                flush(&mut out, &mut loose);
                out.push(Block::Rule);
            }
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
            Inline::Text(t) | Inline::Code(t) | Inline::Image(t) => t.clone(),
            Inline::Strong(c) | Inline::Emphasis(c) | Inline::Strike(c) | Inline::Link(_, c) => {
                plain(c)
            }
            Inline::SoftBreak | Inline::HardBreak => " ".into(),
        })
        .collect()
}

/// Product link policy (`classifyAgentMarkdownHref`): only web and mail links open.
pub(super) fn safe_href(url: &str) -> Option<SharedString> {
    let lower = url.trim().to_lowercase();
    (lower.starts_with("https://") || lower.starts_with("http://") || lower.starts_with("mailto:"))
        .then(|| url.trim().to_owned().into())
}
